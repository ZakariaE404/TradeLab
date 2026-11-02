import { Candle } from '@/types/trading';

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
  if (candles.length < period) return result;

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
 * Calculate Exponential Moving Average
 */
export function calculateEMA(candles: Candle[], period: number): IndicatorPoint[] {
  const result: IndicatorPoint[] = [];
  if (candles.length < period) return result;

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
 * Calculate Average True Range (ATR)
 */
export function calculateATR(candles: Candle[], period: number = 14): number[] {
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
 * Calculate Relative Strength Index (RSI)
 */
export function calculateRSI(candles: Candle[], period: number = 14): IndicatorPoint[] {
  const result: IndicatorPoint[] = [];
  if (candles.length <= period) return result;

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
  if (candles.length < period) return result;

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
