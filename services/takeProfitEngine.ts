import { SignalDirection } from '@/types/simulation';

export interface RiskRewardTakeProfitResult {
  takeProfitPrice: number;
  rewardDistancePips: number;
  ratio: number;
}

export interface SupportResistanceTakeProfitResult {
  takeProfitPrice: number;
  rewardDistancePips: number;
  effectiveRiskRewardRatio: number;
  targetZonePrice: number;
}

/**
 * Calculates Take Profit using fixed Risk-to-Reward ratio (e.g. 1:1, 1:1.5, 1:2).
 * Target is calculated from the actual executed entry price and actual stop loss distance.
 * Strictly validates that TP is on the profitable side of the trade.
 */
export function calculateRiskRewardTakeProfit(params: {
  direction: SignalDirection;
  entryPrice: number;
  stopLossPrice: number;
  ratio: number; // e.g. 1.0, 1.5, 2.0
  pipSize: number;
  digits: number;
}): RiskRewardTakeProfitResult {
  const { direction, entryPrice, stopLossPrice, ratio, pipSize, digits } = params;

  if (ratio <= 0) {
    throw new Error(`Invalid Risk-Reward ratio: ${ratio}. Must be strictly positive.`);
  }

  const riskDistance = Math.abs(entryPrice - stopLossPrice);
  if (riskDistance <= 0) {
    throw new Error('Stop loss price cannot be identical to entry price.');
  }

  let rawTpPrice: number;
  if (direction === 'BUY') {
    if (stopLossPrice >= entryPrice) {
      throw new Error(`Invalid BUY setup: stopLoss (${stopLossPrice}) must be strictly below entryPrice (${entryPrice}).`);
    }
    rawTpPrice = entryPrice + riskDistance * ratio;
  } else {
    if (stopLossPrice <= entryPrice) {
      throw new Error(`Invalid SELL setup: stopLoss (${stopLossPrice}) must be strictly above entryPrice (${entryPrice}).`);
    }
    rawTpPrice = entryPrice - riskDistance * ratio;
  }

  const takeProfitPrice = Number(rawTpPrice.toFixed(digits));
  const rewardDistancePips = Number((Math.abs(takeProfitPrice - entryPrice) / pipSize).toFixed(1));

  return {
    takeProfitPrice,
    rewardDistancePips,
    ratio,
  };
}

/**
 * Calculates Take Profit using opposing Support or Resistance zones.
 * BUY: targets opposing resistance zone above entry.
 * SELL: targets opposing support zone below entry.
 * Rejects invalid targets on the wrong side of the entry.
 */
export function calculateSupportResistanceTakeProfit(params: {
  direction: SignalDirection;
  entryPrice: number;
  targetZonePrice: number;
  stopLossPrice: number;
  pipSize: number;
  digits: number;
  minRiskRewardRatio?: number;
}): SupportResistanceTakeProfitResult {
  const {
    direction,
    entryPrice,
    targetZonePrice,
    stopLossPrice,
    pipSize,
    digits,
    minRiskRewardRatio,
  } = params;

  if (direction === 'BUY') {
    if (targetZonePrice <= entryPrice) {
      throw new Error(
        `Invalid BUY resistance target: targetZonePrice (${targetZonePrice}) must be strictly greater than entryPrice (${entryPrice}).`
      );
    }
  } else {
    if (targetZonePrice >= entryPrice) {
      throw new Error(
        `Invalid SELL support target: targetZonePrice (${targetZonePrice}) must be strictly less than entryPrice (${entryPrice}).`
      );
    }
  }

  const riskDistance = Math.abs(entryPrice - stopLossPrice);
  const rewardDistance = Math.abs(targetZonePrice - entryPrice);

  const effectiveRiskRewardRatio = Number((rewardDistance / riskDistance).toFixed(2));

  if (minRiskRewardRatio && effectiveRiskRewardRatio < minRiskRewardRatio) {
    throw new Error(
      `Support/Resistance target provides RR of 1:${effectiveRiskRewardRatio}, which is below required minimum 1:${minRiskRewardRatio}.`
    );
  }

  const takeProfitPrice = Number(targetZonePrice.toFixed(digits));
  const rewardDistancePips = Number((rewardDistance / pipSize).toFixed(1));

  return {
    takeProfitPrice,
    rewardDistancePips,
    effectiveRiskRewardRatio,
    targetZonePrice,
  };
}
