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

export type TradeDirection = 'LONG' | 'SHORT';
export type TradeStatus = 'WIN' | 'LOSS' | 'BREAKEVEN' | 'OPEN';
export type ExitReason = 'TP' | 'SL' | 'TRAILING_STOP' | 'SIGNAL_CLOSE' | 'OPEN';

export interface Trade {
  id: string;
  index: number;
  symbol: ForexSymbol;
  timeframe: Timeframe;
  direction: TradeDirection;
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
}

export type StrategyType =
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
  // Strategy A specific configuration (optional)
  strategyA?: import('./strategyA').StrategyAParameters;
}

export interface BacktestResult {
  trades: Trade[];
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  breakevenTrades: number;
  winRate: number; // 0 - 100%
  profitFactor: number;
  netR: number;
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
  assumptions?: string[];
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
