/**
 * TradeLab Strategy Template
 *
 * Use this template to create and register new multi-timeframe strategies.
 *
 * Steps to add a new strategy:
 * 1. Copy this template to `services/strategy/implementations/myStrategy/index.ts`.
 * 2. Define your strategy's `id`, `name`, `primaryTimeframe`, and `requiredTimeframes`.
 * 3. Define your parameter types and default values.
 * 4. Implement `evaluateBar(context)` using zero-lookahead `context.getLatestClosedCandle(...)`.
 * 5. Call `StrategyRegistry.registerStrategy(MyStrategy)` in `services/strategy/index.ts`.
 */

import { StrategyDefinition } from '../core/StrategyDefinition';
import { StrategyBarContext } from '../core/StrategyContext';
import { StrategySignal, ParameterDefinition } from '../core/StrategyTypes';

export interface MyStrategyParameters {
  riskRewardRatio: number;
  fastPeriod: number;
  slowPeriod: number;
}

export const MY_STRATEGY_DEFAULTS: MyStrategyParameters = {
  riskRewardRatio: 2.0,
  fastPeriod: 20,
  slowPeriod: 50,
};

export const MY_STRATEGY_SCHEMA: ParameterDefinition[] = [
  {
    key: 'riskRewardRatio',
    label: 'Risk-to-Reward Ratio',
    type: 'number',
    defaultValue: 2.0,
    min: 1.0,
    max: 5.0,
    step: 0.5,
    category: 'risk',
    description: 'Target Take-Profit distance relative to initial Stop-Loss distance.',
  },
  {
    key: 'fastPeriod',
    label: 'Fast Period',
    type: 'number',
    defaultValue: 20,
    min: 5,
    max: 100,
    step: 1,
    category: 'entry',
  },
  {
    key: 'slowPeriod',
    label: 'Slow Period',
    type: 'number',
    defaultValue: 50,
    min: 20,
    max: 200,
    step: 5,
    category: 'trend',
  },
];

export const MyStrategyTemplate: StrategyDefinition<MyStrategyParameters> = {
  id: 'my_new_strategy',
  name: 'My New Strategy Name',
  version: '1.0.0',
  description: 'A brief description of the strategy core rules and market regime.',
  primaryTimeframe: '15m',           // Timeframe on whose candle closes evaluation runs
  requiredTimeframes: ['15m', '1h'], // All timeframes this strategy needs access to
  timeframeDescription: 'M15 Entry + H1 Trend',
  tags: ['trend', 'multi-timeframe'],
  parameterSchema: MY_STRATEGY_SCHEMA,
  defaultParameters: MY_STRATEGY_DEFAULTS,

  /**
   * Optional series-level initialization (called once before simulation loop)
   */
  init(marketContext) {
    // Optional: Precalculate indicators using marketContext.registerIndicatorMap(...)
  },

  /**
   * Bar-by-bar signal evaluation (called at the close of every primary timeframe candle)
   */
  evaluateBar(context: StrategyBarContext<MyStrategyParameters>): StrategySignal | null {
    const { currentCandle, parameters } = context;

    // 1. Access higher timeframe data with zero lookahead
    const closedH1 = context.getLatestClosedCandle('1h');
    if (!closedH1) return null;

    // 2. Perform strategy calculations here...
    // const isConditionMet = ...;

    // 3. Return StrategySignal if triggered, or null otherwise
    /*
    return {
      direction: 'BUY',
      signalTime: currentCandle.time,
      entryTime: currentCandle.time + 900,
      entryPrice: currentCandle.close,
      stopLossPrice: currentCandle.low - 0.0010,
      takeProfitPrice: currentCandle.close + 0.0020,
      riskPips: 10,
      rewardPips: 20,
      riskRewardRatio: parameters.riskRewardRatio,
      signalReason: 'Custom Entry Condition Met',
    };
    */

    return null;
  },
};
