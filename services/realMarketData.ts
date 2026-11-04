import { Candle, ForexSymbol, Timeframe } from '@/types/trading';
import { TIMEFRAMES, validateCandles } from './marketData';
import { getCachedRealCandles, setCachedRealCandles } from './cacheService';

export interface MissingDataGap {
  expectedTime: number;
  gapDurationSeconds: number;
  missingBarsCount: number;
}

export interface RealMarketDataFetchResult {
  success: boolean;
  candles: Candle[];
  closedCandles: Candle[];
  formingCandle: Candle | null;
  meta: {
    provider: 'Twelve Data';
    instrument: string;
    timeframe: Timeframe;
    count: number;
    lastUpdated: number;
    isCurrentCandleForming: boolean;
    missingGaps: MissingDataGap[];
  };
  error?: string;
  errorCode?: string;
}

export interface FetchRealCandlesOptions {
  outputsize?: number;
  startDate?: string;
  endDate?: string;
  forceRefresh?: boolean;
}

/**
 * Parses Twelve Data UTC datetime string "YYYY-MM-DD HH:mm:ss" into Unix epoch seconds.
 * Strictly parses as UTC to avoid local timezone skew.
 */
export function parseTwelveDataTimestamp(datetimeStr: string): number {
  if (!datetimeStr) return 0;
  // If format already has 'Z' or 'T'
  const isoStr = datetimeStr.includes('T')
    ? (datetimeStr.endsWith('Z') ? datetimeStr : datetimeStr + 'Z')
    : datetimeStr.replace(' ', 'T') + 'Z';

  const ms = Date.parse(isoStr);
  if (!isNaN(ms)) {
    return Math.floor(ms / 1000);
  }

  // Fallback explicit UTC breakdown
  const [datePart, timePart = ''] = datetimeStr.split(' ');
  const [y, m, d] = (datePart || '').split('-').map(Number);
  const [hh = 0, mm = 0, ss = 0] = timePart.split(':').map(Number);
  return Math.floor(Date.UTC(y, (m || 1) - 1, d || 1, hh, mm, ss) / 1000);
}

/**
 * Detects gaps between consecutive candlestick bars
 */
export function detectCandleGaps(candles: Candle[], expectedIntervalSeconds: number): MissingDataGap[] {
  const gaps: MissingDataGap[] = [];
  if (!candles || candles.length < 2) return gaps;

  for (let i = 1; i < candles.length; i++) {
    const diff = candles[i].time - candles[i - 1].time;
    // If diff is greater than 1.5x expected interval
    if (diff > expectedIntervalSeconds * 1.5) {
      const missingCount = Math.max(1, Math.round(diff / expectedIntervalSeconds) - 1);
      gaps.push({
        expectedTime: candles[i - 1].time + expectedIntervalSeconds,
        gapDurationSeconds: diff,
        missingBarsCount: missingCount,
      });
    }
  }

  return gaps;
}

/**
 * Sanitizes, de-duplicates, and chronologically sorts raw Twelve Data bars
 */
export function processRawTwelveDataCandles(
  rawValues: Array<{
    datetime: string;
    open: string;
    high: string;
    low: string;
    close: string;
    volume?: string;
  }>,
  timeframe: Timeframe
): {
  candles: Candle[];
  closedCandles: Candle[];
  formingCandle: Candle | null;
  isCurrentCandleForming: boolean;
  missingGaps: MissingDataGap[];
} {
  const parsedCandles: Candle[] = [];
  const seenTimestamps = new Set<number>();

  for (const item of rawValues) {
    const time = parseTwelveDataTimestamp(item.datetime);
    if (!time || isNaN(time)) continue;

    // Remove duplicates
    if (seenTimestamps.has(time)) continue;
    seenTimestamps.add(time);

    const open = parseFloat(item.open);
    const high = parseFloat(item.high);
    const low = parseFloat(item.low);
    const close = parseFloat(item.close);
    const volume = parseFloat(item.volume || '0') || 100;

    if (!Number.isFinite(open) || !Number.isFinite(high) || !Number.isFinite(low) || !Number.isFinite(close)) {
      continue;
    }

    // Filter out malformed OHLC bars (e.g. high < low or negative quotes)
    if (high < low || high < open || high < close || low > open || low > close || open <= 0 || low <= 0) {
      continue;
    }

    parsedCandles.push({
      time,
      open,
      high,
      low,
      close,
      volume,
    });
  }

  // Sort ascending chronologically (oldest first)
  parsedCandles.sort((a, b) => a.time - b.time);

  // Validate OHLC bounds
  const validation = validateCandles(parsedCandles);
  if (!validation.isValid && validation.invalidCandlesCount > parsedCandles.length / 2) {
    throw new Error('Downloaded market data failed OHLC boundary integrity checks.');
  }

  // Detect missing data gaps
  const expectedSeconds = TIMEFRAMES[timeframe]?.seconds || 900;
  const missingGaps = detectCandleGaps(parsedCandles, expectedSeconds);

  // Check if latest candle is currently forming
  const nowSec = Math.floor(Date.now() / 1000);
  const lastCandle = parsedCandles[parsedCandles.length - 1];
  const isCurrentCandleForming = lastCandle
    ? nowSec < lastCandle.time + expectedSeconds
    : false;

  const formingCandle = isCurrentCandleForming ? lastCandle : null;
  const closedCandles = isCurrentCandleForming
    ? parsedCandles.slice(0, -1)
    : parsedCandles;

  return {
    candles: parsedCandles,
    closedCandles,
    formingCandle,
    isCurrentCandleForming,
    missingGaps,
  };
}

/**
 * Fetches real historical market data from Twelve Data via server-side API route.
 * Handles caching, validation, de-duplication, and errors.
 * NEVER generates synthetic data on failure.
 */
export async function fetchTwelveDataCandles(
  symbol: ForexSymbol,
  timeframe: Timeframe,
  options: FetchRealCandlesOptions = {}
): Promise<RealMarketDataFetchResult> {
  const outputsize = options.outputsize || 500;
  const startDate = options.startDate;
  const endDate = options.endDate;
  const forceRefresh = options.forceRefresh || false;

  const providerInstrument = symbol === 'XAUUSDm' || symbol === 'XAU/USD' ? 'XAU/USD' : symbol;
  const cacheKey = `real_v1_twelvedata_${providerInstrument}_${timeframe}_${outputsize}_${startDate || ''}_${endDate || ''}`;

  // 1. Try local IndexedDB cache first unless forceRefresh is true
  if (!forceRefresh) {
    try {
      const cached = await getCachedRealCandles(cacheKey);
      if (cached && cached.length > 0) {
        const expectedSeconds = TIMEFRAMES[timeframe]?.seconds || 900;
        const nowSec = Math.floor(Date.now() / 1000);
        const lastCandle = cached[cached.length - 1];
        const isCurrentCandleForming = lastCandle
          ? nowSec < lastCandle.time + expectedSeconds
          : false;

        return {
          success: true,
          candles: cached,
          closedCandles: isCurrentCandleForming ? cached.slice(0, -1) : cached,
          formingCandle: isCurrentCandleForming ? lastCandle : null,
          meta: {
            provider: 'Twelve Data',
            instrument: providerInstrument,
            timeframe,
            count: cached.length,
            lastUpdated: Date.now(),
            isCurrentCandleForming,
            missingGaps: detectCandleGaps(cached, expectedSeconds),
          },
        };
      }
    } catch {
      // IndexedDB read failure fallback to network
    }
  }

  // 2. Query Server-Side Next.js API Route
  try {
    const queryParams = new URLSearchParams({
      symbol: providerInstrument,
      interval: timeframe,
      outputsize: outputsize.toString(),
    });

    if (startDate) queryParams.set('start_date', startDate);
    if (endDate) queryParams.set('end_date', endDate);

    const response = await fetch(`/api/market-data?${queryParams.toString()}`, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
    });

    const data = await response.json();

    if (!response.ok || !data.success) {
      return {
        success: false,
        candles: [],
        closedCandles: [],
        formingCandle: null,
        meta: {
          provider: 'Twelve Data',
          instrument: providerInstrument,
          timeframe,
          count: 0,
          lastUpdated: Date.now(),
          isCurrentCandleForming: false,
          missingGaps: [],
        },
        error: data.error || `HTTP error ${response.status}`,
        errorCode: data.code || `HTTP_${response.status}`,
      };
    }

    // 3. Process, sanitize, de-duplicate, and sort
    const processed = processRawTwelveDataCandles(data.values, timeframe);

    // 4. Save to IndexedDB cache
    if (processed.candles.length > 0) {
      await setCachedRealCandles(cacheKey, processed.candles);
    }

    return {
      success: true,
      candles: processed.candles,
      closedCandles: processed.closedCandles,
      formingCandle: processed.formingCandle,
      meta: {
        provider: 'Twelve Data',
        instrument: providerInstrument,
        timeframe,
        count: processed.candles.length,
        lastUpdated: Date.now(),
        isCurrentCandleForming: processed.isCurrentCandleForming,
        missingGaps: processed.missingGaps,
      },
    };
  } catch (err: any) {
    return {
      success: false,
      candles: [],
      closedCandles: [],
      formingCandle: null,
      meta: {
        provider: 'Twelve Data',
        instrument: providerInstrument,
        timeframe,
        count: 0,
        lastUpdated: Date.now(),
        isCurrentCandleForming: false,
        missingGaps: [],
      },
      error: err.message || 'Failed to connect to the market data service.',
      errorCode: 'NETWORK_ERROR',
    };
  }
}
