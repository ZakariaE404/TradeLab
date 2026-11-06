import { Candle } from '@/types/trading';
import { ConfirmedSwingPoint } from '@/types/strategyA';
import { StopLossMethod, TakeProfitMethod } from '@/types/simulation';

export type StrategyRegimeOption = 'TRENDING' | 'RANGING' | 'BOTH';
export type StrategyPatternOption = 'REJECTION' | 'ENGULFING' | 'BOTH';
export type StrategyDirectionOption = 'BUY' | 'SELL' | 'BOTH';

export type H1TrendBias = 'BULLISH' | 'BEARISH' | 'NEUTRAL';
export type MarketRegimeType = 'TRENDING' | 'RANGING' | 'TRANSITION';

export type RejectionReasonCode =
  | 'NONE'
  | 'ERR_H1_TREND_NEUTRAL'
  | 'ERR_H1_TREND_MISMATCH'
  | 'ERR_REGIME_MISMATCH'
  | 'ERR_NO_ZONE_FOUND'
  | 'ERR_NO_ZONE_INTERACTION'
  | 'ERR_NO_CANDLE_PATTERN'
  | 'ERR_M15_EMA_FILTER'
  | 'ERR_INVALID_SL_TP'
  | 'ERR_ALREADY_IN_POSITION';

export interface StrategyConfiguration {
  id?: string;
  name?: string;
  // Regimes & Entry Rules
  regime: StrategyRegimeOption;
  pattern: StrategyPatternOption;
  direction: StrategyDirectionOption;

  // H1 Trend Analysis Settings
  slopeLookbackBars: number; // default 3 bars
  emaSlopeLookback: number; // alias
  requirePriceAboveEmaForBullish: boolean; // default true
  requirePriceBelowEmaForBearish: boolean; // default true

  // ADX & Regime Settings
  adxPeriod: number; // default 14
  adxTrendingThreshold: number; // default 25
  adxRangingThreshold: number; // default 20

  // Support & Resistance Settings
  swingLeftBars: number; // default 3
  swingRightBars: number; // default 3
  zoneTolerancePips: number; // default 3.0 pips

  // M15 Candle Pattern Settings
  minWickToBodyRatio: number; // default 2.0
  minRejectionWickRatio: number; // alias
  closePositionThreshold: number; // default 0.50 (upper/lower half)
  requireM15EmaFilter: boolean; // default true
  m15EmaTolerancePips: number; // default 2.0 pips

  // Stop Loss & Take Profit Settings
  stopLossMethod: StopLossMethod;
  atrMultiplier: number; // 1.0, 1.5, 2.0
  stopLossBufferPips: number; // default 2.0 pips
  minStopLossPips: number; // default 5.0 pips

  takeProfitMethod: TakeProfitMethod;
  riskRewardRatio: number; // 1.0, 1.5, 2.0
  minRiskRewardRatio?: number; // for S/R targets, e.g. 1.0
  allowMultiplePositions: boolean; // default false
}

export const DEFAULT_STRATEGY_CONFIG: StrategyConfiguration = {
  regime: 'TRENDING',
  pattern: 'BOTH',
  direction: 'BOTH',

  slopeLookbackBars: 3,
  emaSlopeLookback: 3,
  requirePriceAboveEmaForBullish: true,
  requirePriceBelowEmaForBearish: true,

  adxPeriod: 14,
  adxTrendingThreshold: 25.0,
  adxRangingThreshold: 20.0,

  swingLeftBars: 3,
  swingRightBars: 3,
  zoneTolerancePips: 3.0,

  minWickToBodyRatio: 2.0,
  minRejectionWickRatio: 2.0,
  closePositionThreshold: 0.50,
  requireM15EmaFilter: true,
  m15EmaTolerancePips: 2.0,

  stopLossMethod: 'SWING',
  atrMultiplier: 1.5,
  stopLossBufferPips: 2.0,
  minStopLossPips: 5.0,

  takeProfitMethod: 'RR',
  riskRewardRatio: 2.0,
  minRiskRewardRatio: 1.0,
  allowMultiplePositions: false,
};

export interface PriceZone {
  id: string;
  type: 'SUPPORT' | 'RESISTANCE';
  minPrice: number;
  maxPrice: number;
  centerPrice: number;
  swings: ConfirmedSwingPoint[];
  confirmedAtIndex: number;
  confirmedAtTime: number;
  distancePips: number;
  isValid: boolean;
}

export interface H1TrendAnalysisResult {
  bias: H1TrendBias;
  ema50: number | null;
  ema200: number | null;
  ema50Slope: number;
  slopeLookback: number;
  emaAlignment: 'BULLISH' | 'BEARISH' | 'NEUTRAL';
  priceAboveEma50: boolean;
  priceAboveEma200: boolean;
  reasons: string[];
}

export interface MarketRegimeResult {
  regime: MarketRegimeType;
  adx: number | null;
  adxThresholdTrending: number;
  adxThresholdRanging: number;
  trendBias: H1TrendBias;
  reasons: string[];
}

export interface CandlePatternResult {
  isBullishRejection: boolean;
  isBearishRejection: boolean;
  isBullishEngulfing: boolean;
  isBearishEngulfing: boolean;
  wickToBodyRatio: number;
  bodySize: number;
  lowerWick: number;
  upperWick: number;
  candleRange: number;
  closePositionRatio: number;
}

export interface CandleDiagnosticSnapshot {
  time: number;
  index: number;
  h1Trend: H1TrendAnalysisResult;
  regime: MarketRegimeResult;
  supportZoneFound: boolean;
  resistanceZoneFound: boolean;
  priceInteractedWithZone: boolean;
  pattern: CandlePatternResult;
  m15EmaFilterSatisfied: boolean;
  signalGenerated: boolean;
  rejectionReason: RejectionReasonCode;
  rejectionMessage?: string;
}
