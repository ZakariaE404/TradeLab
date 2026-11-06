export type ForexSymbol =
  | 'XAUUSDm'
  | 'EUR/USD'
  | 'GBP/USD'
  | 'USD/JPY'
  | 'AUD/USD'
  | 'USD/CAD'
  | 'USD/CHF'
  | 'NZD/USD'
  | 'XAU/USD';

export type DataSourceMode = 'DEMO' | 'REAL';

export interface RealDataState {
  provider: 'Twelve Data';
  instrument: string;
  symbol?: string;
  timeframe: Timeframe;
  candleCount: number;
  lastUpdated: number | null; // epoch ms
  isCurrentCandleForming: boolean;
  formingCandle?: Candle | null;
  closedCandlesCount?: number;
  outputsize: number;
  startDate?: string;
  endDate?: string;
  isLoading: boolean;
  error: string | null;
  errorCode?: string;
  missingGapsCount: number;
}

export interface SymbolMeta {
  symbol: ForexSymbol;
  name: string;
  category: 'Forex Major' | 'Forex Commodity' | 'Precious Metal';
  basePrice: number;
  digits: number;
  pipMultiplier: number;
  pipSize: number;
  typicalSpreadPips: number;
}

export type Timeframe = '1m' | '5m' | '15m' | '1h' | '4h' | '1D';

export interface TimeframeMeta {
  id: Timeframe;
  label: string;
  seconds: number;
  barCount: number;
}

export interface Candle {
  time: number; // Unix timestamp in seconds
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

export interface IndicatorEnrichedCandle extends Candle {
  ema50?: number | null;
  ema200?: number | null;
  atr14?: number | null;
}

export interface HistoricalDataConfig {
  symbol: ForexSymbol;
  mode: DataSourceMode;
  m15Bars?: number;
  h1Bars?: number;
  h1WarmupTarget?: number;
  apiKey?: string;
  forceRefresh?: boolean;
}

export interface HistoricalDataset {
  symbol: ForexSymbol;
  mode: DataSourceMode;
  m15Candles: Candle[];
  h1Candles: Candle[];
  m15Enriched: IndicatorEnrichedCandle[];
  h1Enriched: IndicatorEnrichedCandle[];
  m15Ema50Map: Map<number, number>;
  m15Ema200Map: Map<number, number>;
  m15Atr14Map: Map<number, number>;
  h1Ema50Map: Map<number, number>;
  h1Ema200Map: Map<number, number>;
  h1Atr14Map: Map<number, number>;
  h1Adx14Map?: Map<number, number>;
  m15Adx14Map?: Map<number, number>;
  evaluationStartIndex: number;
  m15WarmupBarsCount: number;
  h1WarmupBarsCount: number;
  m15Gaps: Array<{ expectedTime: number; gapDurationSeconds: number; missingBarsCount: number }>;
  h1Gaps: Array<{ expectedTime: number; gapDurationSeconds: number; missingBarsCount: number }>;
  isRealData: boolean;
}

export type TradeDirection = 'LONG' | 'SHORT' | 'BUY' | 'SELL';
export type TradeStatus = 'WIN' | 'LOSS' | 'BREAKEVEN' | 'UNRESOLVED' | 'OPEN';
export type ExitReason =
  | 'TP'
  | 'SL'
  | 'TRAILING_STOP'
  | 'SIGNAL_CLOSE'
  | 'UNRESOLVED'
  | 'MAX_BARS'
  | 'OPEN';

export interface Trade {
  id: string;
  index: number;
  symbol: ForexSymbol;
  timeframe: Timeframe;
  direction: TradeDirection;
  signalTime?: number;
  signalIndex?: number;
  entryTime: number;
  entryPrice: number;
  entryIndex: number;
  exitTime: number;
  exitPrice: number;
  exitIndex: number;
  stopLoss: number;
  takeProfit: number;
  initialRiskPips: number;
  status: TradeStatus;
  exitReason: ExitReason;
  pnlPips: number;
  pnlCurrency: number;
  pnlR: number; // e.g. +2.0 or -1.0
  holdingBars: number;
  riskAmount: number;
  // Strategy & Signal details for chart markers & inspection
  signalReason?: string;
  h1Bias?: string;
  m15Confirmation?: string;
  riskRewardRatio?: number;
  simultaneousTouchResolvedToSL?: boolean;
}

export type StrategyType =
  | 'tradelab_strategy'
  | 'strategy_a'
  | 'ema_pullback'
  | 'breakout_retest'
  | 'rsi_mean_reversion'
  | 'macd_momentum';

export interface StrategyParameters {
  strategyType: StrategyType;
  // EMAs
  fastEma: number;
  slowEma: number;
  trendEma: number;
  // RSI
  rsiPeriod: number;
  rsiOverbought: number;
  rsiOversold: number;
  // ATR & Risk:Reward
  atrPeriod: number;
  atrStopMultiplier: number;
  riskRewardRatio: number; // e.g. 2.0 for 1:2
  useTrailingStop: boolean;
  trailingStopTriggerR: number; // when to activate trailing stop, e.g. at 1.0R
  // Account & Execution
  accountBalance: number;
  riskPercent: number; // e.g. 1.0%
  includeSpread: boolean;
  spreadPips: number;
  commissionPerLot?: number; // e.g. $7 per standard round-turn lot
  slippagePips?: number; // e.g. 0.5 pips execution slippage
  // Strategy A specific configuration (optional)
  strategyA?: import('./strategyA').StrategyAParameters;
  // TradeLab Phase 3 Strategy Configuration (optional)
  tradeLabConfig?: Partial<import('../services/strategy/types').StrategyConfiguration>;
}

export interface MonthlyPerformance {
  monthKey: string; // e.g. '2024-10'
  label: string; // e.g. 'Oct 2024'
  tradesCount: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  netR: number;
  profitCurrency: number;
}

export interface BacktestResult {
  trades: Trade[];
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  breakevenTrades: number;
  unresolvedTrades?: number;
  winRate: number; // 0 - 100%
  profitFactor: number;
  netR: number;
  grossSimulatedR?: number;
  isGrossSimulated?: boolean;
  totalPnlCurrency: number;
  maxDrawdownR: number;
  maxDrawdownPercent: number;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  avgWinR: number;
  avgLossR: number;
  expectancyR: number;
  longTradesCount: number;
  longWinRate: number;
  shortTradesCount: number;
  shortWinRate: number;
  equityCurve: EquityPoint[];
  monthlyPerformance?: MonthlyPerformance[];
  assumptions?: string[];
  costModel?: {
    spreadPips: number;
    commissionPerLot: number;
    slippagePips: number;
  };
  simulationResult?: import('./simulation').SimulationResult;
  diagnosticsSnapshots?: import('../services/strategy/types').CandleDiagnosticSnapshot[];
  experiments?: import('../services/strategy/experimentRunner').StrategyExperimentResult[];
  activeExperimentId?: string;
}

export interface EquityPoint {
  time: number;
  tradeIndex: number;
  equity: number;
  cumulativeR: number;
  drawdownPercent: number;
  drawdownR: number;
}

export interface IndicatorConfig {
  showEma50: boolean;
  showEma200: boolean;
  showFastEma: boolean;
  showSlowEma: boolean;
  showTrendEma: boolean;
  showBollingerBands: boolean;
  showVolume: boolean;
  showMarkers: boolean;
}
