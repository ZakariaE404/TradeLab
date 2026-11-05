import { Candle, IndicatorEnrichedCandle } from '@/types/trading';

export interface IndicatorPoint {
  time: number;
  value: number;
}

export interface BollingerBandsPoint {
  time: number;
  upper: number;
  middle: number;
  lower: number;
}

/**
 * Calculate Simple Moving Average
 */
export function calculateSMA(candles: Candle[], period: number): IndicatorPoint[] {
  const result: IndicatorPoint[] = [];
  if (!candles || candles.length < period || period <= 0) return result;

  let sum = 0;
  for (let i = 0; i < candles.length; i++) {
    sum += candles[i].close;
    if (i >= period) {
      sum -= candles[i - period].close;
    }
    if (i >= period - 1) {
      result.push({
        time: candles[i].time,
        value: Number((sum / period).toFixed(5)),
      });
    }
  }
  return result;
}

/**
 * Calculate Exponential Moving Average (Indicator Points starting at period - 1)
 */
export function calculateEMA(candles: Candle[], period: number): IndicatorPoint[] {
  const result: IndicatorPoint[] = [];
  if (!candles || candles.length < period || period <= 0) return result;

  const multiplier = 2 / (period + 1);

  // Initial SMA for first period
  let initialSum = 0;
  for (let i = 0; i < period; i++) {
    initialSum += candles[i].close;
  }
  let prevEma = initialSum / period;

  result.push({
    time: candles[period - 1].time,
    value: Number(prevEma.toFixed(5)),
  });

  for (let i = period; i < candles.length; i++) {
    const currentPrice = candles[i].close;
    const currentEma = (currentPrice - prevEma) * multiplier + prevEma;
    result.push({
      time: candles[i].time,
      value: Number(currentEma.toFixed(5)),
    });
    prevEma = currentEma;
  }

  return result;
}

/**
 * Calculates sequential Exponential Moving Average where every candle receives its own historical EMA value.
 * - Candles prior to index (period - 1) receive `null` (warming up).
 * - Candle at index (period - 1) receives initial SMA of the first `period` closes.
 * - Each subsequent candle i receives EMA_i = (Close_i * Multiplier) + (Previous EMA * (1 - Multiplier))
 *   where Multiplier = 2 / (period + 1).
 * - Causal, zero-lookahead, and deterministic: appending future candles never changes past historical values.
 */
export function calculateSequentialEMA(candles: Candle[], period: number): (number | null)[] {
  if (!candles || candles.length === 0 || period <= 0) return [];
  const result: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length < period) return result;

  const multiplier = 2 / (period + 1);

  // Initial SMA for first period
  let initialSum = 0;
  for (let i = 0; i < period; i++) {
    initialSum += candles[i].close;
  }
  let prevEma = initialSum / period;
  result[period - 1] = Number(prevEma.toFixed(5));

  for (let i = period; i < candles.length; i++) {
    const currentPrice = candles[i].close;
    const currentEma = currentPrice * multiplier + prevEma * (1 - multiplier);
    result[i] = Number(currentEma.toFixed(5));
    prevEma = currentEma;
  }

  return result;
}

/**
 * Returns a fast Map of timestamp -> EMA value for O(1) lookup
 */
export function calculateSequentialEMAMap(candles: Candle[], period: number): Map<number, number> {
  const map = new Map<number, number>();
  if (!candles || candles.length < period || period <= 0) return map;

  const sequential = calculateSequentialEMA(candles, period);
  for (let i = period - 1; i < candles.length; i++) {
    const val = sequential[i];
    if (val !== null) {
      map.set(candles[i].time, val);
    }
  }

  return map;
}

/**
 * Calculate Average True Range (ATR) with Wilder's Smoothing
 */
export function calculateATR(candles: Candle[], period: number = 14): number[] {
  if (!candles || candles.length === 0 || period <= 0) return [];
  const tr: number[] = [];
  if (candles.length < 2) return candles.map(() => 0);

  tr.push(candles[0].high - candles[0].low);

  for (let i = 1; i < candles.length; i++) {
    const current = candles[i];
    const prevClose = candles[i - 1].close;
    const hl = current.high - current.low;
    const hpc = Math.abs(current.high - prevClose);
    const lpc = Math.abs(current.low - prevClose);
    tr.push(Math.max(hl, hpc, lpc));
  }

  const atr: number[] = new Array(candles.length).fill(0);
  if (candles.length < period) return atr;

  // Initial SMA of TR
  let trSum = 0;
  for (let i = 0; i < period; i++) {
    trSum += tr[i];
  }
  let prevAtr = trSum / period;
  atr[period - 1] = prevAtr;

  // Wilder's smoothing
  for (let i = period; i < candles.length; i++) {
    const currentAtr = (prevAtr * (period - 1) + tr[i]) / period;
    atr[i] = currentAtr;
    prevAtr = currentAtr;
  }

  return atr;
}

/**
 * Calculates sequential Average True Range (ATR) using true range and Wilder smoothing.
 * - Candles prior to index (period - 1) receive `null`.
 * - Candle at index (period - 1) receives initial SMA of the first `period` true ranges.
 * - Each subsequent candle i receives:
 *     ATR_i = (Previous ATR * (period - 1) + TR_i) / period
 *           = (TR_i * (1 / period)) + (Previous ATR * (1 - 1 / period))
 * - Causal, zero-lookahead: appending future candles never alters historical values.
 */
export function calculateSequentialATR(candles: Candle[], period: number = 14): (number | null)[] {
  if (!candles || candles.length === 0 || period <= 0) return [];
  const result: (number | null)[] = new Array(candles.length).fill(null);
  if (candles.length < 2) return result;

  const tr: number[] = new Array(candles.length);
  tr[0] = candles[0].high - candles[0].low;

  for (let i = 1; i < candles.length; i++) {
    const current = candles[i];
    const prevClose = candles[i - 1].close;
    const hl = current.high - current.low;
    const hpc = Math.abs(current.high - prevClose);
    const lpc = Math.abs(current.low - prevClose);
    tr[i] = Math.max(hl, hpc, lpc);
  }

  if (candles.length < period) return result;

  // Initial SMA of TR for first `period` bars
  let trSum = 0;
  for (let i = 0; i < period; i++) {
    trSum += tr[i];
  }
  let prevAtr = trSum / period;
  result[period - 1] = Number(prevAtr.toFixed(5));

  // Wilder's smoothing recurrence
  for (let i = period; i < candles.length; i++) {
    const currentAtr = (prevAtr * (period - 1) + tr[i]) / period;
    result[i] = Number(currentAtr.toFixed(5));
    prevAtr = currentAtr;
  }

  return result;
}

/**
 * Returns ATR as IndicatorPoint[] array suitable for charting
 */
export function calculateATRPoints(candles: Candle[], period: number = 14): IndicatorPoint[] {
  const result: IndicatorPoint[] = [];
  const seq = calculateSequentialATR(candles, period);
  for (let i = 0; i < candles.length; i++) {
    const val = seq[i];
    if (val !== null) {
      result.push({
        time: candles[i].time,
        value: val,
      });
    }
  }
  return result;
}

/**
 * Returns a fast Map of timestamp -> ATR value for O(1) lookup
 */
export function calculateSequentialATRMap(candles: Candle[], period: number = 14): Map<number, number> {
  const map = new Map<number, number>();
  const seq = calculateSequentialATR(candles, period);
  for (let i = 0; i < candles.length; i++) {
    const val = seq[i];
    if (val !== null) {
      map.set(candles[i].time, val);
    }
  }
  return map;
}

/**
 * Enriches candles with historical sequential indicator values
 */
export function enrichCandlesWithIndicators(
  candles: Candle[],
  options: {
    fastEmaPeriod?: number;
    slowEmaPeriod?: number;
    atrPeriod?: number;
  } = {}
): IndicatorEnrichedCandle[] {
  const fastPeriod = options.fastEmaPeriod || 50;
  const slowPeriod = options.slowEmaPeriod || 200;
  const atrPeriod = options.atrPeriod || 14;

  const fastEma = calculateSequentialEMA(candles, fastPeriod);
  const slowEma = calculateSequentialEMA(candles, slowPeriod);
  const atr = calculateSequentialATR(candles, atrPeriod);

  return candles.map((c, i) => ({
    ...c,
    ema50: fastEma[i] ?? null,
    ema200: slowEma[i] ?? null,
    atr14: atr[i] ?? null,
  }));
}

/**
 * Calculate Relative Strength Index (RSI)
 */
export function calculateRSI(candles: Candle[], period: number = 14): IndicatorPoint[] {
  const result: IndicatorPoint[] = [];
  if (!candles || candles.length <= period || period <= 0) return result;

  let gains = 0;
  let losses = 0;

  for (let i = 1; i <= period; i++) {
    const change = candles[i].close - candles[i - 1].close;
    if (change >= 0) gains += change;
    else losses += Math.abs(change);
  }

  let avgGain = gains / period;
  let avgLoss = losses / period;

  const firstRs = avgLoss === 0 ? 100 : avgGain / avgLoss;
  const firstRsi = avgLoss === 0 ? 100 : 100 - 100 / (1 + firstRs);

  result.push({
    time: candles[period].time,
    value: Number(firstRsi.toFixed(2)),
  });

  for (let i = period + 1; i < candles.length; i++) {
    const change = candles[i].close - candles[i - 1].close;
    const currentGain = change > 0 ? change : 0;
    const currentLoss = change < 0 ? Math.abs(change) : 0;

    avgGain = (avgGain * (period - 1) + currentGain) / period;
    avgLoss = (avgLoss * (period - 1) + currentLoss) / period;

    let rsi = 100;
    if (avgLoss > 0) {
      const rs = avgGain / avgLoss;
      rsi = 100 - 100 / (1 + rs);
    }

    result.push({
      time: candles[i].time,
      value: Number(rsi.toFixed(2)),
    });
  }

  return result;
}

/**
 * Calculate Bollinger Bands (upper, middle, lower)
 */
export function calculateBollingerBands(
  candles: Candle[],
  period: number = 20,
  stdDevMultiplier: number = 2.0
): BollingerBandsPoint[] {
  const result: BollingerBandsPoint[] = [];
  if (!candles || candles.length < period || period <= 0) return result;

  for (let i = period - 1; i < candles.length; i++) {
    let sum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      sum += candles[j].close;
    }
    const middle = sum / period;

    let varianceSum = 0;
    for (let j = i - period + 1; j <= i; j++) {
      varianceSum += Math.pow(candles[j].close - middle, 2);
    }
    const stdDev = Math.sqrt(varianceSum / period);

    const upper = middle + stdDevMultiplier * stdDev;
    const lower = middle - stdDevMultiplier * stdDev;

    result.push({
      time: candles[i].time,
      middle: Number(middle.toFixed(5)),
      upper: Number(upper.toFixed(5)),
      lower: Number(lower.toFixed(5)),
    });
  }

  return result;
}
