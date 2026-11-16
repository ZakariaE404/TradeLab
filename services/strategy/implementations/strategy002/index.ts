import { StrategyDefinition } from '../../core/StrategyDefinition';
import { MultiTimeframeMarketContext } from '../../core/StrategyContext';
import { StrategySignal, ParameterDefinition } from '../../core/StrategyTypes';
import { calculateSequentialEMAMap, calculateSequentialATRMap } from '@/services/indicators';
import { FOREX_SYMBOLS } from '@/services/marketData';

export interface Strategy002Parameters {
  h1FastEmaPeriod: number;
  h1SlowEmaPeriod: number;
  m15PullbackEmaPeriod: number;
  atrMultiplier: number;
  riskRewardRatio: number;
}

export const STRATEGY_002_DEFAULTS: Strategy002Parameters = {
  h1FastEmaPeriod: 20,
  h1SlowEmaPeriod: 50,
  m15PullbackEmaPeriod: 20,
  atrMultiplier: 1.5,
  riskRewardRatio: 2.0,
};

export const STRATEGY_002_SCHEMA: ParameterDefinition[] = [
  {
    key: 'riskRewardRatio',
    label: 'Risk-to-Reward Ratio',
    type: 'number',
    defaultValue: 2.0,
    min: 1.0,
    max: 5.0,
    step: 0.5,
    category: 'risk',
  },
  {
    key: 'atrMultiplier',
    label: 'ATR Stop Multiplier',
    type: 'number',
    defaultValue: 1.5,
    min: 1.0,
    max: 3.0,
    step: 0.1,
    category: 'risk',
  },
  {
    key: 'h1FastEmaPeriod',
    label: 'H1 Fast EMA Period',
    type: 'number',
    defaultValue: 20,
    min: 5,
    max: 50,
    step: 1,
    category: 'trend',
  },
  {
    key: 'h1SlowEmaPeriod',
    label: 'H1 Slow EMA Period',
    type: 'number',
    defaultValue: 50,
    min: 20,
    max: 200,
    step: 5,
    category: 'trend',
  },
];

export const Strategy002: StrategyDefinition<Strategy002Parameters> = {
  id: 'strategy_002',
  name: 'Strategy 002: Multi-Timeframe EMA Trend Pullback [Disabled]',
  version: '1.0.0',
  description:
    'H1 EMA 20/50 directional trend filter with M15 EMA 20 pullback touch and ATR volatility stop. (Status: Disabled / Not Validated pending comprehensive testing).',
  primaryTimeframe: '15m',
  requiredTimeframes: ['15m', '1h'],
  timeframeDescription: 'M15 Entry + H1 Trend',
  status: 'disabled',
  statusMessage: 'Disabled / Not Validated — Strategy 001 is currently the only active validated strategy.',
  tags: ['multi-timeframe', 'ema-pullback', 'trend-following'],
  parameterSchema: STRATEGY_002_SCHEMA,
  defaultParameters: STRATEGY_002_DEFAULTS,

  init(marketContext: MultiTimeframeMarketContext<Strategy002Parameters>) {
    const m15Candles = marketContext.candlesByTimeframe.get('15m') || [];
    if (m15Candles.length > 0) {
      const m15Ema = calculateSequentialEMAMap(m15Candles, marketContext.createBarContext(0, STRATEGY_002_DEFAULTS).parameters.m15PullbackEmaPeriod || 20);
      const m15Atr = calculateSequentialATRMap(m15Candles, 14);
      marketContext.registerIndicatorMap('pullbackEma', '15m', m15Ema);
      marketContext.registerIndicatorMap('atr14', '15m', m15Atr);
    }

    const h1Candles = marketContext.candlesByTimeframe.get('1h') || [];
    if (h1Candles.length > 0) {
      const h1Fast = calculateSequentialEMAMap(h1Candles, 20);
      const h1Slow = calculateSequentialEMAMap(h1Candles, 50);
      marketContext.registerIndicatorMap('fastEma', '1h', h1Fast);
      marketContext.registerIndicatorMap('slowEma', '1h', h1Slow);
    }
  },

  evaluateBar(context): StrategySignal | null {
    const { currentCandle, parameters: params, symbol } = context;

    // 1. Get latest closed H1 candle strictly at or before current evaluation time
    const closedH1 = context.getLatestClosedCandle('1h');
    if (!closedH1) return null;

    const h1Fast = context.getIndicatorValue<number>('fastEma', '1h');
    const h1Slow = context.getIndicatorValue<number>('slowEma', '1h');
    if (h1Fast === null || h1Slow === null) return null;

    const isBullishTrend = h1Fast > h1Slow && closedH1.close > h1Fast;
    const isBearishTrend = h1Fast < h1Slow && closedH1.close < h1Fast;

    if (!isBullishTrend && !isBearishTrend) return null;

    // 2. M15 pullback entry evaluation
    const m15Ema = context.getIndicatorValue<number>('pullbackEma', '15m');
    const atr14 = context.getIndicatorValue<number>('atr14', '15m');
    if (m15Ema === null || atr14 === null) return null;

    const symbolMeta = FOREX_SYMBOLS[symbol] || FOREX_SYMBOLS['EUR/USD'];
    const pipSize = symbolMeta.pipSize;
    const stopDistance = Math.max(atr14 * params.atrMultiplier, 5 * pipSize);

    // Bullish pullback touch
    if (isBullishTrend && currentCandle.low <= m15Ema && currentCandle.close > m15Ema && currentCandle.close > currentCandle.open) {
      const entryPrice = currentCandle.close;
      const stopLossPrice = entryPrice - stopDistance;
      const takeProfitPrice = entryPrice + stopDistance * params.riskRewardRatio;

      return {
        direction: 'BUY',
        signalTime: currentCandle.time,
        entryTime: currentCandle.time + 900,
        entryPrice,
        stopLossPrice: Number(stopLossPrice.toFixed(symbolMeta.digits)),
        takeProfitPrice: Number(takeProfitPrice.toFixed(symbolMeta.digits)),
        riskPips: Number((stopDistance / pipSize).toFixed(1)),
        rewardPips: Number(((stopDistance * params.riskRewardRatio) / pipSize).toFixed(1)),
        riskRewardRatio: params.riskRewardRatio,
        signalReason: `Strategy 002: H1 Bullish Trend + M15 EMA 20 Pullback`,
        h1Bias: `BULLISH (H1 EMA 20: ${h1Fast.toFixed(symbolMeta.digits)} > EMA 50: ${h1Slow.toFixed(symbolMeta.digits)})`,
        m15Confirmation: `M15 EMA 20 Bounce`,
      };
    }

    // Bearish pullback touch
    if (isBearishTrend && currentCandle.high >= m15Ema && currentCandle.close < m15Ema && currentCandle.close < currentCandle.open) {
      const entryPrice = currentCandle.close;
      const stopLossPrice = entryPrice + stopDistance;
      const takeProfitPrice = entryPrice - stopDistance * params.riskRewardRatio;

      return {
        direction: 'SELL',
        signalTime: currentCandle.time,
        entryTime: currentCandle.time + 900,
        entryPrice,
        stopLossPrice: Number(stopLossPrice.toFixed(symbolMeta.digits)),
        takeProfitPrice: Number(takeProfitPrice.toFixed(symbolMeta.digits)),
        riskPips: Number((stopDistance / pipSize).toFixed(1)),
        rewardPips: Number(((stopDistance * params.riskRewardRatio) / pipSize).toFixed(1)),
        riskRewardRatio: params.riskRewardRatio,
        signalReason: `Strategy 002: H1 Bearish Trend + M15 EMA 20 Pullback`,
        h1Bias: `BEARISH (H1 EMA 20: ${h1Fast.toFixed(symbolMeta.digits)} < EMA 50: ${h1Slow.toFixed(symbolMeta.digits)})`,
        m15Confirmation: `M15 EMA 20 Rejection`,
      };
    }

    return null;
  },
};
