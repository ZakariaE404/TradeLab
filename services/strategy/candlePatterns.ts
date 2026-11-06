import { Candle } from '@/types/trading';
import { CandlePatternResult, PriceZone, StrategyConfiguration } from './types';
import { doesCandleInteractWithResistance, doesCandleInteractWithSupport } from './supportResistance';

/**
 * Evaluates candlestick geometry for rejection and engulfing patterns.
 * Gracefully handles zero-body candles, micro bodies, zero-range bars, and bad data.
 */
export function evaluateCandlePattern(params: {
  currentCandle: Candle;
  prevCandle?: Candle | null;
  supportZones: PriceZone[];
  resistanceZones: PriceZone[];
  config: StrategyConfiguration;
  pipSize: number;
}): CandlePatternResult {
  const { currentCandle, prevCandle, supportZones, resistanceZones, config, pipSize } = params;

  const minWickRatio = config.minWickToBodyRatio ?? 2.0;
  const closePositionThreshold = config.closePositionThreshold ?? 0.5;
  const tolerancePrice = (config.zoneTolerancePips || 3.0) * pipSize;

  const open = Number(currentCandle.open);
  const high = Number(currentCandle.high);
  const low = Number(currentCandle.low);
  const close = Number(currentCandle.close);

  const candleRange = Math.max(0, high - low);
  const bodySize = Math.abs(close - open);
  const lowerWick = Math.max(0, Math.min(open, close) - low);
  const upperWick = Math.max(0, high - Math.max(open, close));

  // Position of close relative to total range (0.0 at low, 1.0 at high)
  const closePositionRatio = candleRange > 0 ? (close - low) / candleRange : 0.5;

  // Safe wick-to-body calculation avoiding division by zero
  const effectiveBody = Math.max(bodySize, candleRange * 0.05); // Floor small bodies to 5% of range
  const lowerWickRatio = effectiveBody > 0 ? lowerWick / effectiveBody : 0;
  const upperWickRatio = effectiveBody > 0 ? upperWick / effectiveBody : 0;

  // S/R interaction
  const interactsWithSupport = supportZones.some((z) =>
    doesCandleInteractWithSupport(currentCandle, z, tolerancePrice)
  );
  const interactsWithResistance = resistanceZones.some((z) =>
    doesCandleInteractWithResistance(currentCandle, z, tolerancePrice)
  );

  // 1. Bullish Rejection
  // - Lower wick >= minWickRatio * body
  // - Close in upper half of range
  // - Interacts with valid support zone
  const isBullishWick = bodySize === 0 ? lowerWick > 0 && upperWick <= lowerWick * 0.35 : lowerWickRatio >= minWickRatio;
  const isBullishClose = closePositionRatio >= closePositionThreshold;
  const isBullishRejection = candleRange > 0 && isBullishWick && isBullishClose && interactsWithSupport;

  // 2. Bearish Rejection
  // - Upper wick >= minWickRatio * body
  // - Close in lower half of range
  // - Interacts with valid resistance zone
  const isBearishWick = bodySize === 0 ? upperWick > 0 && lowerWick <= upperWick * 0.35 : upperWickRatio >= minWickRatio;
  const isBearishClose = closePositionRatio <= 1.0 - closePositionThreshold;
  const isBearishRejection = candleRange > 0 && isBearishWick && isBearishClose && interactsWithResistance;

  // 3. Engulfing Evaluation
  let isBullishEngulfing = false;
  let isBearishEngulfing = false;

  if (prevCandle) {
    const prevOpen = Number(prevCandle.open);
    const prevClose = Number(prevCandle.close);
    const prevBody = Math.abs(prevClose - prevOpen);

    const prevIsBearish = prevClose < prevOpen;
    const prevIsBullish = prevClose > prevOpen;

    const currIsBullish = close > open;
    const currIsBearish = close < open;

    // Bullish Engulfing:
    // - Prev candle bearish
    // - Current candle bullish
    // - Current real body engulfs previous real body
    // - Interacts with support zone
    if (
      prevIsBearish &&
      currIsBullish &&
      open <= prevClose &&
      close >= prevOpen &&
      bodySize >= prevBody &&
      interactsWithSupport
    ) {
      isBullishEngulfing = true;
    }

    // Bearish Engulfing:
    // - Prev candle bullish
    // - Current candle bearish
    // - Current real body engulfs previous real body
    // - Interacts with resistance zone
    if (
      prevIsBullish &&
      currIsBearish &&
      open >= prevClose &&
      close <= prevOpen &&
      bodySize >= prevBody &&
      interactsWithResistance
    ) {
      isBearishEngulfing = true;
    }
  }

  return {
    isBullishRejection,
    isBearishRejection,
    isBullishEngulfing,
    isBearishEngulfing,
    wickToBodyRatio: Number(Math.max(lowerWickRatio, upperWickRatio).toFixed(2)),
    bodySize: Number(bodySize.toFixed(5)),
    lowerWick: Number(lowerWick.toFixed(5)),
    upperWick: Number(upperWick.toFixed(5)),
    candleRange: Number(candleRange.toFixed(5)),
    closePositionRatio: Number(closePositionRatio.toFixed(2)),
  };
}
