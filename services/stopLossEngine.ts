import { ConfirmedSwingPoint } from '@/types/strategyA';
import { SignalDirection } from '@/types/simulation';

export interface SwingStopLossResult {
  stopLossPrice: number;
  distancePips: number;
  referenceSwing: ConfirmedSwingPoint | null;
  bufferPips: number;
}

export interface AtrStopLossResult {
  stopLossPrice: number;
  distancePips: number;
  atrValue: number;
  multiplier: number;
}

/**
 * Calculates a swing-based stop loss using strictly confirmed swing points visible at signal time.
 * BUY: places SL below the most recent confirmed swing low minus safety buffer.
 * SELL: places SL above the most recent confirmed swing high plus safety buffer.
 * Enforces configurable minimum stop-loss distance.
 */
export function calculateSwingStopLoss(params: {
  direction: SignalDirection;
  entryPrice: number;
  swings: ConfirmedSwingPoint[];
  signalCandleIndex: number;
  bufferPips: number;
  pipSize: number;
  digits: number;
  minStopLossPips?: number;
}): SwingStopLossResult {
  const {
    direction,
    entryPrice,
    swings,
    signalCandleIndex,
    bufferPips,
    pipSize,
    digits,
    minStopLossPips = 5.0,
  } = params;

  const minDistancePrice = minStopLossPips * pipSize;
  const bufferPrice = bufferPips * pipSize;

  // Only consider swing points that were confirmed at or before signalCandleIndex (no lookahead)
  const validSwings = swings.filter((s) => s.confirmedAtIndex <= signalCandleIndex);

  let referenceSwing: ConfirmedSwingPoint | null = null;
  let rawSlPrice: number;

  if (direction === 'BUY') {
    // Find confirmed swing lows
    const swingLows = validSwings.filter((s) => s.type === 'LOW');
    if (swingLows.length > 0) {
      // Pick the most recent confirmed swing low
      referenceSwing = swingLows[swingLows.length - 1];
      rawSlPrice = referenceSwing.price - bufferPrice;
    } else {
      // Fallback if no swing low exists in history
      rawSlPrice = entryPrice - minDistancePrice;
    }

    // Enforce that SL is below entry and satisfies min distance
    if (entryPrice - rawSlPrice < minDistancePrice) {
      rawSlPrice = entryPrice - minDistancePrice;
    }
  } else {
    // SELL: Find confirmed swing highs
    const swingHighs = validSwings.filter((s) => s.type === 'HIGH');
    if (swingHighs.length > 0) {
      // Pick the most recent confirmed swing high
      referenceSwing = swingHighs[swingHighs.length - 1];
      rawSlPrice = referenceSwing.price + bufferPrice;
    } else {
      // Fallback if no swing high exists in history
      rawSlPrice = entryPrice + minDistancePrice;
    }

    // Enforce that SL is above entry and satisfies min distance
    if (rawSlPrice - entryPrice < minDistancePrice) {
      rawSlPrice = entryPrice + minDistancePrice;
    }
  }

  const stopLossPrice = Number(rawSlPrice.toFixed(digits));
  const distancePips = Number((Math.abs(entryPrice - stopLossPrice) / pipSize).toFixed(1));

  return {
    stopLossPrice,
    distancePips,
    referenceSwing,
    bufferPips,
  };
}

/**
 * Calculates an ATR-based stop loss using the ATR value available at signal time.
 * BUY: SL = Entry Price - (ATR * Multiplier)
 * SELL: SL = Entry Price + (ATR * Multiplier)
 * Multipliers typically: 1.0, 1.5, 2.0.
 */
export function calculateAtrStopLoss(params: {
  direction: SignalDirection;
  entryPrice: number;
  atrValue: number;
  multiplier: number;
  pipSize: number;
  digits: number;
  minStopLossPips?: number;
}): AtrStopLossResult {
  const {
    direction,
    entryPrice,
    atrValue,
    multiplier,
    pipSize,
    digits,
    minStopLossPips = 5.0,
  } = params;

  if (!atrValue || isNaN(atrValue) || atrValue <= 0) {
    throw new Error(`Invalid ATR value provided for stop loss calculation: ${atrValue}`);
  }

  const minDistancePrice = minStopLossPips * pipSize;
  const atrDistance = atrValue * multiplier;

  let rawSlPrice: number;
  if (direction === 'BUY') {
    rawSlPrice = entryPrice - atrDistance;
    if (entryPrice - rawSlPrice < minDistancePrice) {
      rawSlPrice = entryPrice - minDistancePrice;
    }
  } else {
    rawSlPrice = entryPrice + atrDistance;
    if (rawSlPrice - entryPrice < minDistancePrice) {
      rawSlPrice = entryPrice + minDistancePrice;
    }
  }

  const stopLossPrice = Number(rawSlPrice.toFixed(digits));
  const distancePips = Number((Math.abs(entryPrice - stopLossPrice) / pipSize).toFixed(1));

  return {
    stopLossPrice,
    distancePips,
    atrValue,
    multiplier,
  };
}
