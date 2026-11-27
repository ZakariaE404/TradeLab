import { ParameterDefinition } from '../../core/StrategyTypes';

export type SmcFibExecutionTiming = 'next_open' | 'close';

export interface SmcFibParameters {
  swingLength: number;
  fibStart: number;
  fibEnd: number;
  atrLength: number;
  slAtrMultiplier: number;
  riskPercent: number; // Percentage, e.g. 0.5 for 0.5%
  rrTarget: number; // e.g. 15 for 15R
  initialCapital: number; // e.g. 100000
  executionTiming: SmcFibExecutionTiming;
  isCrypto?: boolean;
}

export const SMC_FIB_4H_V1_DEFAULTS: SmcFibParameters = {
  swingLength: 10,
  fibStart: 0.60,
  fibEnd: 0.70,
  atrLength: 14,
  slAtrMultiplier: 2.0,
  riskPercent: 0.5,
  rrTarget: 15.0,
  initialCapital: 100000,
  executionTiming: 'next_open',
};

export const SMC_FIB_4H_V1_SCHEMA: ParameterDefinition[] = [
  {
    key: 'swingLength',
    label: 'Swing Length',
    type: 'number',
    defaultValue: 10,
    min: 2,
    max: 30,
    step: 1,
    category: 'trend',
    description: 'Pivot swing lookback/lookforward length (default 10, matching QC/Pine).',
  },
  {
    key: 'fibStart',
    label: 'Fib Zone Start',
    type: 'number',
    defaultValue: 0.60,
    min: 0.1,
    max: 0.9,
    step: 0.01,
    category: 'entry',
    description: 'Start of Fibonacci retracement entry zone (default 0.60).',
  },
  {
    key: 'fibEnd',
    label: 'Fib Zone End',
    type: 'number',
    defaultValue: 0.70,
    min: 0.1,
    max: 0.95,
    step: 0.01,
    category: 'entry',
    description: 'End of Fibonacci retracement entry zone (default 0.70).',
  },
  {
    key: 'atrLength',
    label: 'ATR Length (SMA)',
    type: 'number',
    defaultValue: 14,
    min: 5,
    max: 50,
    step: 1,
    category: 'risk',
    description: 'ATR period using Simple Moving Average of True Range (default 14).',
  },
  {
    key: 'slAtrMultiplier',
    label: 'SL ATR Multiplier',
    type: 'number',
    defaultValue: 2.0,
    min: 0.5,
    max: 5.0,
    step: 0.1,
    category: 'risk',
    description: 'Stop-Loss buffer distance in ATR multiples (default 2.0).',
  },
  {
    key: 'riskPercent',
    label: 'Risk % per Trade',
    type: 'number',
    defaultValue: 0.5,
    min: 0.1,
    max: 5.0,
    step: 0.1,
    category: 'risk',
    description: 'Account equity risk percentage per trade (default 0.5%).',
  },
  {
    key: 'rrTarget',
    label: 'Risk:Reward Target',
    type: 'number',
    defaultValue: 15.0,
    min: 1.0,
    max: 30.0,
    step: 0.5,
    category: 'risk',
    description: 'Take-Profit Risk:Reward multiple (default 15.0R).',
  },
  {
    key: 'executionTiming',
    label: 'Execution Timing',
    type: 'select',
    defaultValue: 'next_open',
    options: [
      { label: 'Next Bar Open (QC / TradeLab)', value: 'next_open' },
      { label: 'Bar Close (TradingView Pine v6)', value: 'close' },
    ],
    category: 'execution',
    description: 'Order fill convention: next 4H bar open (QuantConnect MarketOrder) vs current bar close (Pine process_orders_on_close).',
  },
];
