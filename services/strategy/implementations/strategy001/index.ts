import { StrategyDefinition } from '../../core/StrategyDefinition';
import { MultiTimeframeMarketContext } from '../../core/StrategyContext';
import { Strategy001Parameters, STRATEGY_001_DEFAULTS, STRATEGY_001_SCHEMA } from './config';
import { evaluateStrategy001Bar } from './logic';
import { calculateSequentialEMAMap } from '@/services/indicators';

export const Strategy001: StrategyDefinition<Strategy001Parameters> = {
  id: 'strategy_001',
  name: 'Strategy 001: H1 Trend + M15 Rejection',
  version: '1.0.0',
  description:
    'Multi-timeframe trend-following strategy: H1 EMA 50/200 and swing structure filter with M15 S/R zone rejection wick entries.',
  primaryTimeframe: '15m',
  requiredTimeframes: ['15m', '1h'],
  timeframeDescription: 'M15 Entry + H1 Trend',
  tags: ['multi-timeframe', 'trend-following', 'price-action', 'rejection'],
  status: 'active',
  statusMessage: 'Validated Multi-Timeframe Strategy (M15 Entry + H1 Trend)',
  parameterSchema: STRATEGY_001_SCHEMA,
  defaultParameters: STRATEGY_001_DEFAULTS,

  init(marketContext: MultiTimeframeMarketContext<Strategy001Parameters>, parameters?: Strategy001Parameters) {
    const params = parameters || STRATEGY_001_DEFAULTS;
    const m15Fast = params.m15FastEmaPeriod || 50;
    const m15Slow = params.m15SlowEmaPeriod || 200;
    const h1Fast = params.h1FastEmaPeriod || 50;
    const h1Slow = params.h1SlowEmaPeriod || 200;

    // Precompute sequential EMA Fast and Slow on M15
    const m15Candles = marketContext.candlesByTimeframe.get('15m') || [];
    if (m15Candles.length > 0) {
      const m15EmaFast = calculateSequentialEMAMap(m15Candles, m15Fast);
      const m15EmaSlow = calculateSequentialEMAMap(m15Candles, m15Slow);
      marketContext.registerIndicatorMap('fastEma', '15m', m15EmaFast);
      marketContext.registerIndicatorMap('slowEma', '15m', m15EmaSlow);
      marketContext.registerIndicatorMap('ema50', '15m', m15EmaFast);
      marketContext.registerIndicatorMap('ema200', '15m', m15EmaSlow);
    }

    // Precompute sequential EMA Fast and Slow on H1
    const h1Candles = marketContext.candlesByTimeframe.get('1h') || [];
    if (h1Candles.length > 0) {
      const h1EmaFast = calculateSequentialEMAMap(h1Candles, h1Fast);
      const h1EmaSlow = calculateSequentialEMAMap(h1Candles, h1Slow);
      marketContext.registerIndicatorMap('fastEma', '1h', h1EmaFast);
      marketContext.registerIndicatorMap('slowEma', '1h', h1EmaSlow);
      marketContext.registerIndicatorMap('ema50', '1h', h1EmaFast);
      marketContext.registerIndicatorMap('ema200', '1h', h1EmaSlow);
    }
  },

  evaluateBar(context) {
    return evaluateStrategy001Bar(context);
  },
};
