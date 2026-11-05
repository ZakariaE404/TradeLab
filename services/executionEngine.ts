import { Candle } from '@/types/trading';
import { ConfirmedSwingPoint } from '@/types/strategyA';
import {
  EquitySnapshot,
  ExecutionCostConfig,
  InstrumentCostModel,
  PositionSizingConfig,
  SimulationConfig,
  SimulationTradeRecord,
  TradingSignal,
} from '@/types/simulation';
import {
  calculateEntryFill,
  calculateExitFill,
  calculateTradeExecutionCosts,
} from './costEngine';
import { calculateAtrStopLoss, calculateSwingStopLoss } from './stopLossEngine';
import {
  calculateRiskRewardTakeProfit,
  calculateSupportResistanceTakeProfit,
} from './takeProfitEngine';

export interface PositionState {
  activeTrade: SimulationTradeRecord | null;
  currentBalance: number;
  peakEquity: number;
  trades: SimulationTradeRecord[];
  equityCurve: EquitySnapshot[];
  cumulativeR: number;
  simultaneousTouchCount: number;
}

/**
 * Initializes position and equity tracking state.
 */
export function initializePositionState(initialBalance: number): PositionState {
  return {
    activeTrade: null,
    currentBalance: initialBalance,
    peakEquity: initialBalance,
    trades: [],
    equityCurve: [],
    cumulativeR: 0,
    simultaneousTouchCount: 0,
  };
}

/**
 * Calculates position size in units and lots based on configured sizing method and risk.
 */
export function calculatePositionUnits(params: {
  balance: number;
  entryPrice: number;
  stopLossPrice: number;
  sizing: PositionSizingConfig;
  instrument: InstrumentCostModel;
}): { positionUnits: number; positionLots: number; riskAmountCurrency: number } {
  const { balance, entryPrice, stopLossPrice, sizing, instrument } = params;

  const riskPerUnit = Math.abs(entryPrice - stopLossPrice);
  if (riskPerUnit <= 0) {
    throw new Error('Risk per unit is zero or negative: stopLoss cannot equal entryPrice.');
  }

  let riskAmountCurrency: number;
  let positionUnits: number;
  let positionLots: number;

  switch (sizing.method) {
    case 'FIXED_RISK_PERCENT': {
      riskAmountCurrency = Number((balance * (sizing.value / 100)).toFixed(2));
      positionUnits = Number((riskAmountCurrency / riskPerUnit).toFixed(4));
      positionLots = Number((positionUnits / instrument.contractSize).toFixed(4));
      break;
    }
    case 'FIXED_RISK_AMOUNT': {
      riskAmountCurrency = Number(sizing.value.toFixed(2));
      positionUnits = Number((riskAmountCurrency / riskPerUnit).toFixed(4));
      positionLots = Number((positionUnits / instrument.contractSize).toFixed(4));
      break;
    }
    case 'FIXED_LOTS': {
      positionLots = sizing.value;
      positionUnits = Number((positionLots * instrument.contractSize).toFixed(4));
      riskAmountCurrency = Number((positionUnits * riskPerUnit).toFixed(2));
      break;
    }
    default:
      throw new Error(`Unsupported position sizing method: ${(sizing as any).method}`);
  }

  return { positionUnits, positionLots, riskAmountCurrency };
}

/**
 * Opens a trade at next candle OPEN following a confirmed signal.
 * Never uses confirmation candle close as fill price.
 */
export function executeOpenTrade(params: {
  signal: TradingSignal;
  nextCandle: Candle;
  nextCandleIndex: number;
  config: SimulationConfig;
  instrument: InstrumentCostModel;
  currentBalance: number;
  swings: ConfirmedSwingPoint[];
  atrValueAtSignal?: number;
}): SimulationTradeRecord {
  const {
    signal,
    nextCandle,
    nextCandleIndex,
    config,
    instrument,
    currentBalance,
    swings,
    atrValueAtSignal,
  } = params;

  // 1. Calculate Entry Fill at next candle OPEN with spread and slippage
  const entryFill = calculateEntryFill(
    signal.direction,
    nextCandle.open,
    config.costs,
    instrument
  );
  const executedEntryPrice = entryFill.executionPrice;

  // 2. Resolve Stop Loss from executed entry price
  let stopLossPrice: number;
  const slMethod = signal.proposedStopLoss.method;

  if (slMethod === 'SWING') {
    const swingSl = calculateSwingStopLoss({
      direction: signal.direction,
      entryPrice: executedEntryPrice,
      swings,
      signalCandleIndex: signal.signalCandleIndex,
      bufferPips: signal.proposedStopLoss.bufferPips ?? 2.0,
      pipSize: instrument.pipSize,
      digits: instrument.digits,
      minStopLossPips: signal.proposedStopLoss.minStopLossPips ?? config.minStopLossPips ?? 5.0,
    });
    stopLossPrice = swingSl.stopLossPrice;
  } else {
    // ATR-based Stop Loss
    const atr = atrValueAtSignal ?? signal.indicatorsAtSignal?.atr14 ?? 1.0;
    const atrSl = calculateAtrStopLoss({
      direction: signal.direction,
      entryPrice: executedEntryPrice,
      atrValue: atr,
      multiplier: signal.proposedStopLoss.atrMultiplier ?? 1.5,
      pipSize: instrument.pipSize,
      digits: instrument.digits,
      minStopLossPips: signal.proposedStopLoss.minStopLossPips ?? config.minStopLossPips ?? 5.0,
    });
    stopLossPrice = atrSl.stopLossPrice;
  }

  // 3. Resolve Take Profit from executed entry price and resolved stop loss
  let takeProfitPrice: number;
  const tpMethod = signal.proposedTakeProfit.method;

  if (tpMethod === 'RR') {
    const rrTp = calculateRiskRewardTakeProfit({
      direction: signal.direction,
      entryPrice: executedEntryPrice,
      stopLossPrice,
      ratio: signal.proposedTakeProfit.riskRewardRatio ?? 2.0,
      pipSize: instrument.pipSize,
      digits: instrument.digits,
    });
    takeProfitPrice = rrTp.takeProfitPrice;
  } else {
    // S/R-based Take Profit
    const targetZone = signal.proposedTakeProfit.targetZonePrice;
    if (!targetZone) {
      throw new Error('Proposed S/R take profit requires targetZonePrice.');
    }
    const srTp = calculateSupportResistanceTakeProfit({
      direction: signal.direction,
      entryPrice: executedEntryPrice,
      targetZonePrice: targetZone,
      stopLossPrice,
      pipSize: instrument.pipSize,
      digits: instrument.digits,
    });
    takeProfitPrice = srTp.takeProfitPrice;
  }

  const initialRisk = Number(Math.abs(executedEntryPrice - stopLossPrice).toFixed(instrument.digits));
  const initialRiskPips = Number((initialRisk / instrument.pipSize).toFixed(1));

  // 4. Position Sizing
  const { positionUnits, positionLots, riskAmountCurrency } = calculatePositionUnits({
    balance: currentBalance,
    entryPrice: executedEntryPrice,
    stopLossPrice,
    sizing: config.sizing,
    instrument,
  });

  const trade: SimulationTradeRecord = {
    id: `trade_${signal.id}_idx_${nextCandleIndex}`,
    direction: signal.direction,
    entryTime: nextCandle.time,
    entryPrice: executedEntryPrice,
    entryIndex: nextCandleIndex,
    exitTime: null,
    exitPrice: null,
    exitIndex: null,
    stopLoss: stopLossPrice,
    takeProfit: takeProfitPrice,
    initialRisk,
    initialRiskPips,
    riskAmountCurrency,
    positionUnits,
    positionLots,
    grossPnl: 0,
    totalExecutionCosts: 0,
    spreadCost: 0,
    slippageCost: 0,
    commissionCost: 0,
    netPnl: 0,
    resultInR: 0,
    grossResultInR: 0,
    exitReason: 'OPEN',
    status: 'OPEN',
    signalType: signal.signalType,
    marketRegime: signal.marketRegime || 'NORMAL',
    stopLossMethod: slMethod,
    takeProfitMethod: tpMethod,
    relevantIndicatorValuesAtEntry: signal.indicatorsAtSignal || {},
    simultaneousTouchResolvedToSL: false,
    holdingBars: 0,
  };

  return trade;
}

export interface CandleEvaluationResult {
  tradeClosed: boolean;
  closedTrade: SimulationTradeRecord | null;
}

/**
 * Evaluates an active trade against a candle's price range.
 * Intrabar Rule: If both SL and TP are touched in the same candle,
 * conservatively evaluates Stop Loss first to avoid optimistic bias.
 */
export function evaluateActiveTradeOnCandle(params: {
  trade: SimulationTradeRecord;
  candle: Candle;
  candleIndex: number;
  costs: ExecutionCostConfig;
  instrument: InstrumentCostModel;
}): CandleEvaluationResult {
  const { trade, candle, candleIndex, costs, instrument } = params;

  trade.holdingBars++;

  const isBuy = trade.direction === 'BUY';
  let isSlHit = false;
  let isTpHit = false;

  if (isBuy) {
    isSlHit = candle.low <= trade.stopLoss;
    isTpHit = candle.high >= trade.takeProfit;
  } else {
    isSlHit = candle.high >= trade.stopLoss;
    isTpHit = candle.low <= trade.takeProfit;
  }

  // Intrabar resolution: if both hit, SL wins (conservative)
  if (isSlHit && isTpHit) {
    trade.simultaneousTouchResolvedToSL = true;
    isSlHit = true;
    isTpHit = false;
  }

  if (!isSlHit && !isTpHit) {
    return { tradeClosed: false, closedTrade: null };
  }

  // Finalize trade closure
  const targetExitPrice = isSlHit ? trade.stopLoss : trade.takeProfit;
  const exitReason = isSlHit ? 'SL' : 'TP';
  const status = isSlHit ? 'LOSS' : 'WIN';

  const exitFill = calculateExitFill(trade.direction, targetExitPrice, costs, instrument);
  trade.exitPrice = exitFill.executionPrice;
  trade.exitTime = candle.time;
  trade.exitIndex = candleIndex;
  trade.exitReason = exitReason;
  trade.status = status;

  // Calculate gross PnL
  let grossPriceDiff: number;
  if (isBuy) {
    grossPriceDiff = targetExitPrice - trade.entryPrice;
  } else {
    grossPriceDiff = trade.entryPrice - targetExitPrice;
  }
  trade.grossPnl = Number((grossPriceDiff * trade.positionUnits).toFixed(2));

  // Calculate execution costs
  const costBreakdown = calculateTradeExecutionCosts(
    trade.positionUnits,
    trade.positionLots,
    costs,
    instrument
  );
  trade.spreadCost = costBreakdown.spreadCost;
  trade.slippageCost = costBreakdown.slippageCost;
  trade.commissionCost = costBreakdown.commissionCost;
  trade.totalExecutionCosts = costBreakdown.totalExecutionCosts;

  // Net PnL = Gross PnL - Total Costs
  trade.netPnl = Number((trade.grossPnl - trade.totalExecutionCosts).toFixed(2));

  // PnL in R
  trade.resultInR = Number((trade.netPnl / trade.riskAmountCurrency).toFixed(2));
  trade.grossResultInR = Number((trade.grossPnl / trade.riskAmountCurrency).toFixed(2));

  return { tradeClosed: true, closedTrade: trade };
}

/**
 * Handles trade closure at the end of the backtest if a trade remains open.
 */
export function finalizeOpenTradeAtEndOfTest(params: {
  trade: SimulationTradeRecord;
  lastCandle: Candle;
  lastCandleIndex: number;
  costs: ExecutionCostConfig;
  instrument: InstrumentCostModel;
  policy: 'CLOSE_AT_LAST_BAR' | 'LEAVE_OPEN';
}): SimulationTradeRecord {
  const { trade, lastCandle, lastCandleIndex, costs, instrument, policy } = params;

  if (policy === 'LEAVE_OPEN') {
    // Keep trade as OPEN, do not fill exit
    trade.status = 'OPEN';
    trade.exitReason = 'OPEN';
    return trade;
  }

  // Close at last bar close
  const exitFill = calculateExitFill(trade.direction, lastCandle.close, costs, instrument);
  trade.exitPrice = exitFill.executionPrice;
  trade.exitTime = lastCandle.time;
  trade.exitIndex = lastCandleIndex;
  trade.exitReason = 'END_OF_TEST';

  let grossPriceDiff: number;
  if (trade.direction === 'BUY') {
    grossPriceDiff = lastCandle.close - trade.entryPrice;
  } else {
    grossPriceDiff = trade.entryPrice - lastCandle.close;
  }
  trade.grossPnl = Number((grossPriceDiff * trade.positionUnits).toFixed(2));

  const costBreakdown = calculateTradeExecutionCosts(
    trade.positionUnits,
    trade.positionLots,
    costs,
    instrument
  );
  trade.spreadCost = costBreakdown.spreadCost;
  trade.slippageCost = costBreakdown.slippageCost;
  trade.commissionCost = costBreakdown.commissionCost;
  trade.totalExecutionCosts = costBreakdown.totalExecutionCosts;

  trade.netPnl = Number((trade.grossPnl - trade.totalExecutionCosts).toFixed(2));
  trade.resultInR = Number((trade.netPnl / trade.riskAmountCurrency).toFixed(2));
  trade.grossResultInR = Number((trade.grossPnl / trade.riskAmountCurrency).toFixed(2));

  if (trade.netPnl > 0) {
    trade.status = 'WIN';
  } else if (trade.netPnl < 0) {
    trade.status = 'LOSS';
  } else {
    trade.status = 'BREAKEVEN';
  }

  return trade;
}

/**
 * Computes unrealized mark-to-market PnL for an open trade on candle.
 */
export function calculateUnrealizedPnL(
  trade: SimulationTradeRecord,
  candle: Candle,
  commissionCost: number
): number {
  let priceDiff: number;
  if (trade.direction === 'BUY') {
    priceDiff = candle.close - trade.entryPrice;
  } else {
    priceDiff = trade.entryPrice - candle.close;
  }
  return Number((priceDiff * trade.positionUnits - commissionCost).toFixed(2));
}
