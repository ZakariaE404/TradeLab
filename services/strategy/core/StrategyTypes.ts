import { Candle, ForexSymbol, Timeframe, TradeDirection } from '@/types/trading';

export interface StrategySignal {
  direction: 'BUY' | 'SELL';
  signalTime: number;       // Epoch seconds of candle close generating signal
  entryTime?: number;       // Epoch seconds of expected execution entry (next bar open)
  entryPrice?: number;
  stopLossPrice: number;
  takeProfitPrice: number;
  riskPips: number;
  rewardPips: number;
  riskRewardRatio: number;
  signalReason: string;
  h1Bias?: string;
  m15Confirmation?: string;
  metadata?: Record<string, unknown>;
}

export type ParameterType = 'number' | 'boolean' | 'string' | 'select';

export interface ParameterOption {
  label: string;
  value: string | number;
}

export interface ParameterDefinition<T = unknown> {
  key: string;
  label: string;
  type: ParameterType;
  defaultValue: T;
  options?: ParameterOption[];
  min?: number;
  max?: number;
  step?: number;
  description?: string;
  category?: 'trend' | 'entry' | 'risk' | 'execution';
}

export interface StrategyMetadata {
  id: string;
  name: string;
  version: string;
  description: string;
  primaryTimeframe: Timeframe;
  requiredTimeframes: Timeframe[];
  timeframeDescription?: string; // e.g. "M15 Entry + H1 Trend"
  tags?: string[];
}
