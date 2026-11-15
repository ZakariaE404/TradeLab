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
  parameterSchema: STRATEGY_001_SCHEMA,
  defaultParameters: STRATEGY_001_DEFAULTS,

  init(marketContext: MultiTimeframeMarketContext<Strategy001Parameters>) {
    // Precompute sequential EMA 50 and EMA 200 on M15
    const m15Candles = marketContext.candlesByTimeframe.get('15m') || [];
    if (m15Candles.length > 0) {
      const m15Ema50 = calculateSequentialEMAMap(m15Candles, 50);
      const m15Ema200 = calculateSequentialEMAMap(m15Candles, 200);
      marketContext.registerIndicatorMap('ema50', '15m', m15Ema50);
      marketContext.registerIndicatorMap('ema200', '15m', m15Ema200);
    }

    // Precompute sequential EMA 50 and EMA 200 on H1
    const h1Candles = marketContext.candlesByTimeframe.get('1h') || [];
    if (h1Candles.length > 0) {
      const h1Ema50 = calculateSequentialEMAMap(h1Candles, 50);
      const h1Ema200 = calculateSequentialEMAMap(h1Candles, 200);
      marketContext.registerIndicatorMap('ema50', '1h', h1Ema50);
      marketContext.registerIndicatorMap('ema200', '1h', h1Ema200);
    }
  },

  evaluateBar(context) {
    return evaluateStrategy001Bar(context);
  },
};
