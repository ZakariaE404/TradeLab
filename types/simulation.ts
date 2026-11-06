import { Candle, ForexSymbol, HistoricalDataset } from './trading';
import { ConfirmedSwingPoint } from './strategyA';

export type SignalDirection = 'BUY' | 'SELL';
export type StopLossMethod = 'SWING' | 'ATR';
export type TakeProfitMethod = 'RR' | 'SUPPORT_RESISTANCE';

export type SimulationTradeStatus = 'WIN' | 'LOSS' | 'BREAKEVEN' | 'OPEN';
export type SimulationExitReason = 'TP' | 'SL' | 'END_OF_TEST' | 'OPEN';
export type EndOfTestPolicy = 'CLOSE_AT_LAST_BAR' | 'LEAVE_OPEN';
export type WarmUpConfidence = 'STABILIZED' | 'REDUCED_CONFIDENCE' | 'INSUFFICIENT';

export interface ProposedStopLoss {
  method: StopLossMethod;
  price?: number;
  bufferPips?: number;
  atrMultiplier?: number; // 1.0, 1.5, 2.0
  swingReferencePrice?: number;
  minStopLossPips?: number;
}

export interface ProposedTakeProfit {
  method: TakeProfitMethod;
  price?: number;
  riskRewardRatio?: number; // 1.0, 1.5, 2.0
  targetZonePrice?: number;
}

/**
 * Signal Engine Output.
 * Represents a confirmed trading signal detected at the close of candle signalCandleIndex.
 * Crucial rule: Does NOT execute trades inside the signal module.
 */
export interface TradingSignal {
  id: string;
  direction: SignalDirection;
  signalTime: number; // Unix epoch seconds of confirmation candle
  signalCandleIndex: number; // Index in M15 array of confirmation candle
  confirmationCandleClose: number; // Confirmation bar close price
  proposedStopLoss: ProposedStopLoss;
  proposedTakeProfit: ProposedTakeProfit;
  signalType: string;
  marketRegime?: string;
  metadata?: Record<string, any>;
  indicatorsAtSignal?: {
    ema50?: number | null;
    ema200?: number | null;
    atr14?: number | null;
    h1Ema50?: number | null;
    h1Ema200?: number | null;
    [key: string]: any;
  };
}

/**
 * Market context passed chronologically to SignalGenerator.
 * Strictly strictly zero-lookahead: contains only bars up to currentIndex.
 */
export interface SignalEvaluationContext {
  m15Candles: Candle[];
  currentIndex: number; // current confirmation candidate bar
  currentCandle: Candle;
  completedH1Candle: Candle | null;
  completedH1Index: number;
  m15Indicators: {
    ema50?: number | null;
    ema200?: number | null;
    atr14?: number | null;
  };
  h1Indicators: {
    ema50?: number | null;
    ema200?: number | null;
    atr14?: number | null;
  };
  h1Candles?: Candle[];
  h1Ema50Map?: Map<number, number>;
  h1Ema200Map?: Map<number, number>;
  h1Adx14Map?: Map<number, number>;
  confirmedSwings: ConfirmedSwingPoint[];
  symbol: ForexSymbol;
}

export interface SignalGenerator {
  readonly id: string;
  readonly name: string;
  generateSignal(context: SignalEvaluationContext): TradingSignal | null;
}

export interface ExecutionCostConfig {
  spreadPips: number;
  slippagePips: number;
  commissionPerLot: number; // e.g. $7 per standard round-turn lot
}

export interface PositionSizingConfig {
  method: 'FIXED_RISK_PERCENT' | 'FIXED_LOTS' | 'FIXED_RISK_AMOUNT';
  value: number; // e.g. 1.0 for 1%, or 1.0 for 1 lot, or 100 for $100
}

export interface SimulationConfig {
  initialBalance: number;
  sizing: PositionSizingConfig;
  costs: ExecutionCostConfig;
  endOfTestPolicy: EndOfTestPolicy;
  minStopLossPips?: number;
  maxHoldingBars?: number;
  allowMinimumWarmup?: boolean; // if true, allows running with 300 <= warmup < 1000 bars
}

export interface InstrumentCostModel {
  symbol: ForexSymbol;
  name: string;
  pipSize: number;
  pipMultiplier: number;
  contractSize: number;
  digits: number;
  isKnownInstrument: boolean;
}

/**
 * Complete trade execution record required by Section 8.
 */
export interface SimulationTradeRecord {
  id: string;
  direction: SignalDirection;
  entryTime: number;
  entryPrice: number;
  entryIndex: number;
  exitTime: number | null;
  exitPrice: number | null;
  exitIndex: number | null;
  stopLoss: number;
  takeProfit: number;
  initialRisk: number; // Absolute price distance |entry - SL|
  initialRiskPips: number;
  riskAmountCurrency: number;
  positionUnits: number;
  positionLots: number;
  grossPnl: number;
  totalExecutionCosts: number;
  spreadCost: number;
  slippageCost: number;
  commissionCost: number;
  netPnl: number;
  resultInR: number; // netPnl / riskAmountCurrency
  grossResultInR: number; // grossPnl / riskAmountCurrency
  exitReason: SimulationExitReason;
  status: SimulationTradeStatus;
  signalType: string;
  marketRegime: string;
  stopLossMethod: StopLossMethod;
  takeProfitMethod: TakeProfitMethod;
  relevantIndicatorValuesAtEntry: Record<string, number | null | undefined>;
  simultaneousTouchResolvedToSL: boolean;
  holdingBars: number;
}

export interface EquitySnapshot {
  time: number;
  barIndex: number;
  balance: number;
  equity: number;
  realizedPnl: number;
  unrealizedPnl: number;
  peakEquity: number;
  drawdownCurrency: number;
  drawdownPercent: number;
  drawdownR: number;
  cumulativeR: number;
}

export interface SimulationPerformanceMetrics {
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  breakevenTrades: number;
  openTrades: number;
  winRate: number; // 0 - 100%
  profitFactor: number;
  netR: number;
  grossR: number;
  totalGrossPnl: number;
  totalExecutionCosts: number;
  totalNetPnl: number;
  maxDrawdownCurrency: number;
  maxDrawdownPercent: number;
  maxDrawdownR: number;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  avgWinR: number;
  avgLossR: number;
  expectancyR: number;
  longTradesCount: number;
  longWinRate: number;
  shortTradesCount: number;
  shortWinRate: number;
  avgHoldingBars: number;
}

export interface SimulationDiagnostics {
  warmUpConfidence: WarmUpConfidence;
  warnings: string[];
  assumptions: string[];
  totalBarsEvaluated: number;
  totalSignalsGenerated: number;
  totalTradesExecuted: number;
  rejectedSignalsCount: number;
  unexecutedFinalBarSignalsCount: number;
  openTradesAtEndCount: number;
  simultaneousTouchCount: number;
  instrumentMetadata: InstrumentCostModel;
  evaluationStartTime: number;
  evaluationEndTime: number;
}

export interface SimulationResult {
  trades: SimulationTradeRecord[];
  equityCurve: EquitySnapshot[];
  performance: SimulationPerformanceMetrics;
  diagnostics: SimulationDiagnostics;
}
