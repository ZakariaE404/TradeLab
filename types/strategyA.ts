import { Candle, ForexSymbol } from './trading';

export type TrendBias = 'BUY' | 'SELL' | 'NEUTRAL';
export type StructureType = 'BULLISH' | 'BEARISH' | 'NEUTRAL';
export type RejectionType = 'BULLISH_REJECTION' | 'BEARISH_REJECTION' | 'NONE';
export type ZoneType = 'SUPPORT' | 'RESISTANCE' | 'NONE';

export interface ConfirmedSwingPoint {
  index: number;
  time: number;
  price: number;
  type: 'HIGH' | 'LOW';
  confirmedAtIndex: number; // The exact bar index at which this swing point was confirmed
  confirmedAtTime: number;
}

export interface H1TrendState {
  bias: TrendBias;
  ema50: number;
  ema200: number;
  emaConditionMet: boolean;
  closeConditionMet: boolean;
  structure: StructureType;
  lastSwingHighs: [number, number] | null; // [previous, latest]
  lastSwingLows: [number, number] | null;
  latestClosedH1Time: number;
}

export interface M15EntrySignal {
  signalIndex: number;
  signalTime: number;
  direction: 'BUY' | 'SELL';
  h1Bias: TrendBias;
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  riskPips: number;
  rewardPips: number;
  riskRewardRatio: number;
  rejectionWickRatio: number;
  m15Ema50: number;
  m15Ema200: number;
  confirmedSwingPrice: number;
  zonePrice: number;
  rationale: string;
}

export type SimulatedTradeStatus = 'WIN' | 'LOSS' | 'BREAKEVEN' | 'UNRESOLVED';
export type ExitReasonType = 'TP' | 'SL' | 'UNRESOLVED' | 'MAX_BARS';

export interface SimulatedTrade {
  id: string;
  index: number;
  symbol: ForexSymbol;
  direction: 'BUY' | 'SELL';
  signalTime: number;
  signalIndex: number;
  entryTime: number;
  entryIndex: number;
  entryPrice: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  exitTime: number | null;
  exitIndex: number | null;
  exitPrice: number | null;
  exitReason: ExitReasonType;
  status: SimulatedTradeStatus;
  riskAmount: number;
  riskPips: number;
  rewardPips: number;
  realizedPnlPips: number;
  realizedR: number; // e.g. +2.0R or -1.0R
  holdingBars: number;
  simultaneousTouchResolvedToSL: boolean;
}

export interface StrategyAParameters {
  // H1 Trend Parameters
  h1FastEmaPeriod: number; // default 50
  h1SlowEmaPeriod: number; // default 200
  h1SwingLookback: number; // bars each side for confirmed swing (default 3)
  requireH1Structure: boolean; // require HH+HL or LH+LL (default true)

  // M15 Entry Parameters
  m15FastEmaPeriod: number; // default 50
  m15SlowEmaPeriod: number; // default 200
  m15SwingLookback: number; // bars for M15 swing level stop-loss (default 3)
  minRejectionWickRatio: number; // minimum wick / total range ratio (default 0.35 = 35%)
  zoneTolerancePips: number; // pips buffer around EMA 50 / swing support zone (default 3.0)
  requireM15EmaFilter: boolean; // M15 EMA 50/200 agreement (default true)

  // Risk & Trade Management
  riskRewardRatio: number; // default 2.0 (2:1 reward:risk)
  stopLossBufferPips: number; // buffer beyond swing low/high in pips (default 2.0)
  minStopLossPips: number; // minimum SL in pips (default 5.0)
  maxHoldingBars: number; // max bars before unresolved close (default 200)
  allowMultiplePositions: boolean; // prevent duplicate open trades (default false)

  // Account
  accountCapital: number; // default $10,000
  riskPercent: number; // default 1.0%
}

export interface StrategyABacktestResult {
  signals: M15EntrySignal[];
  trades: SimulatedTrade[];
  totalSignals: number;
  totalTrades: number;
  wins: number;
  losses: number;
  breakevens: number;
  unresolved: number;
  winRate: number; // 0-100%
  profitFactor: number;
  netR: number;
  totalPnlCurrency: number;
  maxDrawdownR: number;
  maxDrawdownPercent: number;
  avgWinR: number;
  avgLossR: number;
  expectancyR: number;
  longCount: number;
  longWins: number;
  shortCount: number;
  shortWins: number;
  assumptions: string[];
}
