import { ParameterDefinition } from '../../core/StrategyTypes';

export interface Strategy001Parameters {
  // H1 Trend Filter
  h1FastEmaPeriod: number;
  h1SlowEmaPeriod: number;
  h1SwingLookback: number;
  requireH1Structure: boolean;

  // M15 Entry
  m15FastEmaPeriod: number;
  m15SlowEmaPeriod: number;
  m15SwingLookback: number;
  minRejectionWickRatio: number;
  zoneTolerancePips: number;
  requireM15EmaFilter: boolean;

  // Risk & Trade Management
  riskRewardRatio: number;
  stopLossBufferPips: number;
  minStopLossPips: number;
  maxHoldingBars: number;
  allowMultiplePositions: boolean;
}

export const STRATEGY_001_DEFAULTS: Strategy001Parameters = {
  h1FastEmaPeriod: 50,
  h1SlowEmaPeriod: 200,
  h1SwingLookback: 3,
  requireH1Structure: true,

  m15FastEmaPeriod: 50,
  m15SlowEmaPeriod: 200,
  m15SwingLookback: 3,
  minRejectionWickRatio: 0.35,
  zoneTolerancePips: 3.0,
  requireM15EmaFilter: true,

  riskRewardRatio: 2.0,
  stopLossBufferPips: 2.0,
  minStopLossPips: 5.0,
  maxHoldingBars: 200,
  allowMultiplePositions: false,
};

export const STRATEGY_001_SCHEMA: ParameterDefinition[] = [
  {
    key: 'riskRewardRatio',
    label: 'Risk-to-Reward Ratio (RR)',
    type: 'number',
    defaultValue: 2.0,
    min: 1.0,
    max: 5.0,
    step: 0.5,
    category: 'risk',
    description: 'Target Take-Profit distance relative to initial Stop-Loss distance.',
  },
  {
    key: 'minRejectionWickRatio',
    label: 'Min Rejection Wick Ratio',
    type: 'number',
    defaultValue: 0.35,
    min: 0.2,
    max: 0.6,
    step: 0.05,
    category: 'entry',
    description: 'Minimum wick percentage of total bar range to qualify as a valid rejection candle.',
  },
  {
    key: 'zoneTolerancePips',
    label: 'S/R Zone Tolerance (Pips)',
    type: 'number',
    defaultValue: 3.0,
    min: 0.5,
    max: 10.0,
    step: 0.5,
    category: 'entry',
    description: 'Tolerance distance in pips around S/R level or EMA 50 for zone reach.',
  },
  {
    key: 'requireH1Structure',
    label: 'Require H1 Swing Structure',
    type: 'boolean',
    defaultValue: true,
    category: 'trend',
    description: 'Enforce Higher Highs & Higher Lows for BUY, Lower Highs & Lower Lows for SELL.',
  },
  {
    key: 'requireM15EmaFilter',
    label: 'Require M15 EMA 50/200 Filter',
    type: 'boolean',
    defaultValue: true,
    category: 'entry',
    description: 'Reject BUY signals if M15 EMA 50 is below M15 EMA 200.',
  },
  {
    key: 'stopLossBufferPips',
    label: 'Stop-Loss Buffer (Pips)',
    type: 'number',
    defaultValue: 2.0,
    min: 0.5,
    max: 10.0,
    step: 0.5,
    category: 'risk',
    description: 'Cushion added beyond the confirmed swing extreme.',
  },
  {
    key: 'minStopLossPips',
    label: 'Minimum Stop-Loss (Pips)',
    type: 'number',
    defaultValue: 5.0,
    min: 2.0,
    max: 20.0,
    step: 1.0,
    category: 'risk',
    description: 'Floor to prevent dangerously tight stop-losses on small bars.',
  },
];
