import { Candle } from '@/types/trading';
import { DukascopyPriceType, DukascopyTimeframe } from '@/types/historicalData';
import { DUKASCOPY_TIMEFRAMES } from './dukascopyCatalog';

export interface RawDukascopyCandle {
  timestamp: number | string; // ms epoch or ISO date string
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface NormalizationReport {
  totalReceived: number;
  validCandles: number;
  duplicateTimestampsRemoved: number;
  invalidOhlcFiltered: number;
  startTime: number | null; // epoch sec
  endTime: number | null; // epoch sec
  missingGapsCount: number;
  isMarketClosedWeekendDetected: boolean;
}

export interface NormalizedResult {
  candles: Candle[];
  report: NormalizationReport;
}

/**
 * Normalizes raw Dukascopy candle objects into TradeLab's internal Candle format.
 * - Converts milliseconds timestamps to UTC seconds
 * - Filters malformed quotes (high < low, negative prices, non-finite values)
 * - Removes duplicate timestamps
 * - Sorts strictly chronologically (ascending)
 * - Identifies missing intervals without inventing synthetic replacement candles
 */
export function normalizeDukascopyCandles(
  rawCandles: RawDukascopyCandle[],
  timeframe: DukascopyTimeframe = 'm1'
): NormalizedResult {
  if (!rawCandles || !Array.isArray(rawCandles) || rawCandles.length === 0) {
    return {
      candles: [],
      report: {
        totalReceived: 0,
        validCandles: 0,
        duplicateTimestampsRemoved: 0,
        invalidOhlcFiltered: 0,
        startTime: null,
        endTime: null,
        missingGapsCount: 0,
        isMarketClosedWeekendDetected: false,
      },
    };
  }

  const seenTimestamps = new Set<number>();
  const sanitized: Candle[] = [];
  let duplicateCount = 0;
  let invalidOhlcCount = 0;

  for (const raw of rawCandles) {
    if (!raw) continue;

    // 1. Parse timestamp to seconds UTC
    let timeSec = 0;
    if (typeof raw.timestamp === 'number') {
      // Dukascopy returns millisecond epoch
      timeSec = raw.timestamp > 1e11 ? Math.floor(raw.timestamp / 1000) : Math.floor(raw.timestamp);
    } else if (typeof raw.timestamp === 'string') {
      const ms = Date.parse(raw.timestamp);
      if (!isNaN(ms)) {
        timeSec = Math.floor(ms / 1000);
      }
    }

    if (!timeSec || timeSec <= 0 || isNaN(timeSec)) {
      invalidOhlcCount++;
      continue;
    }

    // 2. Deduplicate timestamps
    if (seenTimestamps.has(timeSec)) {
      duplicateCount++;
      continue;
    }
    seenTimestamps.add(timeSec);

    // 3. Parse and validate OHLC
    const open = Number(raw.open);
    const high = Number(raw.high);
    const low = Number(raw.low);
    const close = Number(raw.close);
    const volume = Number(raw.volume || 0);

    // Filter non-finite or non-positive
    if (
      !Number.isFinite(open) ||
      !Number.isFinite(high) ||
      !Number.isFinite(low) ||
      !Number.isFinite(close) ||
      open <= 0 ||
      high <= 0 ||
      low <= 0 ||
      close <= 0
    ) {
      invalidOhlcCount++;
      continue;
    }

    // Strict OHLC boundary: high must be >= open, close, low; low must be <= open, close, high
    if (high < low || high < open || high < close || low > open || low > close) {
      invalidOhlcCount++;
      continue;
    }

    sanitized.push({
      time: timeSec,
      open,
      high,
      low,
      close,
      volume: volume >= 0 ? volume : 100,
    });
  }

  // 4. Chronological sort (oldest to newest)
  sanitized.sort((a, b) => a.time - b.time);

  // 5. Gap detection & weekend awareness
  const tfConfig = DUKASCOPY_TIMEFRAMES.find((t) => t.id === timeframe);
  const expectedStep = tfConfig ? tfConfig.seconds : 60;
  let missingGaps = 0;
  let weekendDetected = false;

  for (let i = 1; i < sanitized.length; i++) {
    const diff = sanitized[i].time - sanitized[i - 1].time;
    if (diff > expectedStep * 1.5) {
      missingGaps++;
      const prevDate = new Date(sanitized[i - 1].time * 1000);
      const dayOfWeek = prevDate.getUTCDay();
      // Friday evening (day 5) to Sunday evening (day 0)
      if (dayOfWeek === 5 || dayOfWeek === 6 || dayOfWeek === 0) {
        weekendDetected = true;
      }
    }
  }

  const startTime = sanitized.length > 0 ? sanitized[0].time : null;
  const endTime = sanitized.length > 0 ? sanitized[sanitized.length - 1].time : null;

  return {
    candles: sanitized,
    report: {
      totalReceived: rawCandles.length,
      validCandles: sanitized.length,
      duplicateTimestampsRemoved: duplicateCount,
      invalidOhlcFiltered: invalidOhlcCount,
      startTime,
      endTime,
      missingGapsCount: missingGaps,
      isMarketClosedWeekendDetected: weekendDetected,
    },
  };
}

/**
 * Converts normalized candles into downloadable CSV format
 */
export function exportCandlesToCSV(
  candles: Candle[],
  meta: {
    symbol: string;
    timeframe: string;
    priceType: DukascopyPriceType;
  }
): string {
  const header = `Timestamp_UTC,Datetime_UTC,Open,High,Low,Close,Volume\n`;
  const rows = candles.map((c) => {
    const iso = new Date(c.time * 1000).toISOString().replace('.000Z', 'Z');
    return `${c.time},${iso},${c.open},${c.high},${c.low},${c.close},${c.volume}`;
  });

  return `# Dukascopy Export | Symbol: ${meta.symbol} | Timeframe: ${meta.timeframe} | Price: ${meta.priceType}\n` + header + rows.join('\n');
}

/**
 * Parses Dukascopy exported CSV back into Candles
 */
export function parseDukascopyCSV(csvContent: string): Candle[] {
  if (!csvContent || typeof csvContent !== 'string') return [];

  const lines = csvContent.split('\n');
  const rawCandles: RawDukascopyCandle[] = [];

  for (const rawLine of lines) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const parts = line.split(/[,\t;]/).map((p) => p.trim());
    // Skip header line
    if (parts[0]?.toLowerCase().includes('time') || parts[0]?.toLowerCase().includes('date')) {
      continue;
    }

    if (parts.length >= 5) {
      let timeVal: number | string = parts[0];
      let oIdx = 1;
      let hIdx = 2;
      let lIdx = 3;
      let cIdx = 4;
      let vIdx = 5;

      // Check if line has both epoch timestamp and ISO datetime (e.g. 1730000000, 2024-10-27T00:00:00Z, ...)
      if (parts.length >= 7 && !isNaN(Number(parts[0])) && parts[1].includes('-')) {
        timeVal = Number(parts[0]);
        oIdx = 2;
        hIdx = 3;
        lIdx = 4;
        cIdx = 5;
        vIdx = 6;
      }

      rawCandles.push({
        timestamp: timeVal,
        open: parseFloat(parts[oIdx]),
        high: parseFloat(parts[hIdx]),
        low: parseFloat(parts[lIdx]),
        close: parseFloat(parts[cIdx]),
        volume: parts[vIdx] ? parseFloat(parts[vIdx]) : 100,
      });
    }
  }

  return normalizeDukascopyCandles(rawCandles).candles;
}
