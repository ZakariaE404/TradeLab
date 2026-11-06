import { Candle, DataSourceMode, ForexSymbol, HistoricalDataConfig, HistoricalDataset, IndicatorEnrichedCandle } from '@/types/trading';
import {
  calculateSequentialEMAMap,
  calculateSequentialATRMap,
  calculateSequentialADXMap,
  enrichCandlesWithIndicators,
} from './indicators';
import { fetchTwelveDataCandles, detectCandleGaps, MissingDataGap } from './realMarketData';
import { generateForexCandles } from './marketData';
import { getLatestClosedH1Index } from './multiTimeframeSync';
import { aggregateM15ToH1 } from './strategyA';

export const HISTORICAL_WARMUP_REQUIREMENTS = {
  TARGET_H1_WARMUP_BARS: 1000,
  MIN_H1_WARMUP_BARS: 300,
  TARGET_M15_WARMUP_BARS: 500,
  MIN_M15_WARMUP_BARS: 200,
};

/**
 * Sanitizes, validates, removes duplicates, and chronologically sorts candle arrays.
 * Handles out-of-order data, malformed quotes, and duplicate timestamps safely.
 */
export function sanitizeAndSortCandles(rawCandles: Candle[]): Candle[] {
  if (!rawCandles || rawCandles.length === 0) return [];

  const seenTimes = new Set<number>();
  const sanitized: Candle[] = [];

  for (const c of rawCandles) {
    if (!c || typeof c.time !== 'number' || isNaN(c.time) || c.time <= 0) continue;

    const open = Number(c.open);
    const high = Number(c.high);
    const low = Number(c.low);
    const close = Number(c.close);
    const volume = Number(c.volume || 0);

    // Validate finite non-negative numbers
    if (
      !Number.isFinite(open) ||
      !Number.isFinite(high) ||
      !Number.isFinite(low) ||
      !Number.isFinite(close) ||
      open <= 0 ||
      low <= 0 ||
      high <= 0 ||
      close <= 0
    ) {
      continue;
    }

    // Strict OHLC boundary checks
    if (high < low || high < open || high < close || low > open || low > close) {
      continue;
    }

    // Deduplicate timestamps
    if (seenTimes.has(c.time)) {
      continue;
    }
    seenTimes.add(c.time);

    sanitized.push({
      time: Math.floor(c.time),
      open,
      high,
      low,
      close,
      volume: volume >= 0 ? volume : 100,
    });
  }

  // Sort ascending chronologically (oldest first)
  sanitized.sort((a, b) => a.time - b.time);

  return sanitized;
}

export interface HistoricalLoadResult {
  success: boolean;
  dataset?: HistoricalDataset;
  error?: string;
  errorCode?: string;
}

/**
 * Loads a multi-timeframe historical dataset with dedicated warm-up history and sequential indicators.
 * - M15 candles for entry evaluation
 * - H1 candles for trend analysis with up to 1000 warm-up bars for EMA 200 stability
 * - Pre-computes sequential EMA 50, EMA 200, ATR 14 without lookahead
 * - NEVER silently replaces real market data with synthetic data
 */
export async function loadHistoricalDataset(
  config: HistoricalDataConfig
): Promise<HistoricalLoadResult> {
  const { symbol, mode, forceRefresh, apiKey } = config;
  const targetH1Bars = config.h1Bars || HISTORICAL_WARMUP_REQUIREMENTS.TARGET_H1_WARMUP_BARS;
  const targetM15Bars = config.m15Bars || 2000;

  let rawM15: Candle[] = [];
  let rawH1: Candle[] = [];

  if (mode === 'REAL') {
    // 1. Fetch real H1 candles from Twelve Data
    const h1Result = await fetchTwelveDataCandles(symbol, '1h', {
      outputsize: Math.min(Math.max(targetH1Bars, 300), 5000),
      forceRefresh,
      apiKey,
    });

    if (!h1Result.success || h1Result.candles.length === 0) {
      return {
        success: false,
        error: h1Result.error || `Failed to fetch real H1 historical data for ${symbol}.`,
        errorCode: h1Result.errorCode || 'H1_FETCH_FAILED',
      };
    }

    // 2. Fetch real M15 candles from Twelve Data
    const m15Result = await fetchTwelveDataCandles(symbol, '15m', {
      outputsize: Math.min(Math.max(targetM15Bars, 500), 5000),
      forceRefresh,
      apiKey,
    });

    if (!m15Result.success || m15Result.candles.length === 0) {
      return {
        success: false,
        error: m15Result.error || `Failed to fetch real M15 historical data for ${symbol}.`,
        errorCode: m15Result.errorCode || 'M15_FETCH_FAILED',
      };
    }

    rawH1 = h1Result.candles;
    rawM15 = m15Result.candles;
  } else {
    // DEMO mode: Generate synthetic candles with ample warm-up bars
    rawH1 = generateForexCandles(symbol, '1h', 42, targetH1Bars, 'mixed');
    rawM15 = generateForexCandles(symbol, '15m', 42, targetM15Bars, 'mixed');
  }

  // 3. Sanitize, deduplicate, and sort
  const m15Candles = sanitizeAndSortCandles(rawM15);
  const h1Candles = sanitizeAndSortCandles(rawH1);

  if (m15Candles.length < HISTORICAL_WARMUP_REQUIREMENTS.MIN_M15_WARMUP_BARS) {
    return {
      success: false,
      error: `Insufficient M15 candle count (${m15Candles.length}). Required minimum: ${HISTORICAL_WARMUP_REQUIREMENTS.MIN_M15_WARMUP_BARS}.`,
      errorCode: 'INSUFFICIENT_M15_CANDLES',
    };
  }

  if (h1Candles.length < HISTORICAL_WARMUP_REQUIREMENTS.MIN_H1_WARMUP_BARS) {
    return {
      success: false,
      error: `Insufficient H1 candle count (${h1Candles.length}). Required minimum for EMA 200 stability: ${HISTORICAL_WARMUP_REQUIREMENTS.MIN_H1_WARMUP_BARS}.`,
      errorCode: 'INSUFFICIENT_H1_CANDLES',
    };
  }

  // 4. Pre-calculate sequential indicators on complete series (causal, zero lookahead)
  const h1Ema50Map = calculateSequentialEMAMap(h1Candles, 50);
  const h1Ema200Map = calculateSequentialEMAMap(h1Candles, 200);
  const h1Atr14Map = calculateSequentialATRMap(h1Candles, 14);
  const h1Adx14Map = calculateSequentialADXMap(h1Candles, 14);
  const h1Enriched = enrichCandlesWithIndicators(h1Candles, { fastEmaPeriod: 50, slowEmaPeriod: 200, atrPeriod: 14 });

  const m15Ema50Map = calculateSequentialEMAMap(m15Candles, 50);
  const m15Ema200Map = calculateSequentialEMAMap(m15Candles, 200);
  const m15Atr14Map = calculateSequentialATRMap(m15Candles, 14);
  const m15Adx14Map = calculateSequentialADXMap(m15Candles, 14);
  const m15Enriched = enrichCandlesWithIndicators(m15Candles, { fastEmaPeriod: 50, slowEmaPeriod: 200, atrPeriod: 14 });

  // 5. Detect missing data gaps
  const m15Gaps = detectCandleGaps(m15Candles, 900);
  const h1Gaps = detectCandleGaps(h1Candles, 3600);

  // 6. Find earliest M15 evaluation index where both M15 EMA 200 and H1 EMA 200 are available
  let evaluationStartIndex = 200;
  for (let i = 200; i < m15Candles.length; i++) {
    const h1Idx = getLatestClosedH1Index(m15Candles[i].time, h1Candles, 900, 'close');
    if (h1Idx >= 199) {
      evaluationStartIndex = i;
      break;
    }
  }

  const dataset: HistoricalDataset = {
    symbol,
    mode,
    m15Candles,
    h1Candles,
    m15Enriched,
    h1Enriched,
    m15Ema50Map,
    m15Ema200Map,
    m15Atr14Map,
    h1Ema50Map,
    h1Ema200Map,
    h1Atr14Map,
    h1Adx14Map,
    m15Adx14Map,
    evaluationStartIndex,
    m15WarmupBarsCount: evaluationStartIndex,
    h1WarmupBarsCount: Math.min(200, h1Candles.length),
    m15Gaps,
    h1Gaps,
    isRealData: mode === 'REAL',
  };

  return {
    success: true,
    dataset,
  };
}

/**
 * Creates a complete HistoricalDataset synchronously from already available M15 and H1 candles.
 * Aggregates M15 to H1 if H1 is not provided, and pre-computes sequential EMA 50, EMA 200, ATR 14, and ADX 14.
 */
export function createHistoricalDatasetFromCandles(
  rawM15: Candle[],
  rawH1?: Candle[] | null,
  symbol: ForexSymbol = 'XAUUSDm',
  mode: DataSourceMode = 'DEMO'
): HistoricalDataset {
  const m15Candles = sanitizeAndSortCandles(rawM15);
  let h1Candles = rawH1 && rawH1.length > 0 ? sanitizeAndSortCandles(rawH1) : [];

  if (h1Candles.length === 0 && m15Candles.length > 0) {
    h1Candles = aggregateM15ToH1(m15Candles);
  }

  // Pre-calculate sequential indicators on complete series (causal, zero lookahead)
  const h1Ema50Map = calculateSequentialEMAMap(h1Candles, 50);
  const h1Ema200Map = calculateSequentialEMAMap(h1Candles, 200);
  const h1Atr14Map = calculateSequentialATRMap(h1Candles, 14);
  const h1Adx14Map = calculateSequentialADXMap(h1Candles, 14);
  const h1Enriched = enrichCandlesWithIndicators(h1Candles, { fastEmaPeriod: 50, slowEmaPeriod: 200, atrPeriod: 14 });

  const m15Ema50Map = calculateSequentialEMAMap(m15Candles, 50);
  const m15Ema200Map = calculateSequentialEMAMap(m15Candles, 200);
  const m15Atr14Map = calculateSequentialATRMap(m15Candles, 14);
  const m15Adx14Map = calculateSequentialADXMap(m15Candles, 14);
  const m15Enriched = enrichCandlesWithIndicators(m15Candles, { fastEmaPeriod: 50, slowEmaPeriod: 200, atrPeriod: 14 });

  const m15Gaps = detectCandleGaps(m15Candles, 900);
  const h1Gaps = detectCandleGaps(h1Candles, 3600);

  let evaluationStartIndex = Math.min(200, Math.max(0, m15Candles.length - 1));
  if (m15Candles.length >= 200 && h1Candles.length >= 50) {
    for (let i = 200; i < m15Candles.length; i++) {
      const h1Idx = getLatestClosedH1Index(m15Candles[i].time, h1Candles, 900, 'close');
      if (h1Idx >= 49) {
        evaluationStartIndex = i;
        break;
      }
    }
  } else {
    // For smaller fixtures, set start index reasonably
    evaluationStartIndex = Math.min(30, Math.floor(m15Candles.length / 2));
  }

  return {
    symbol,
    mode,
    m15Candles,
    h1Candles,
    m15Enriched,
    h1Enriched,
    m15Ema50Map,
    m15Ema200Map,
    m15Atr14Map,
    h1Ema50Map,
    h1Ema200Map,
    h1Atr14Map,
    h1Adx14Map,
    m15Adx14Map,
    evaluationStartIndex,
    m15WarmupBarsCount: evaluationStartIndex,
    h1WarmupBarsCount: Math.min(200, h1Candles.length),
    m15Gaps,
    h1Gaps,
    isRealData: mode === 'REAL',
  };
}
