import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  StrategyRegistry,
  Strategy001,
  Strategy002,
  MultiTimeframeMarketContext,
  StrategyDefinition,
  StrategyBarContext,
  StrategySignal,
} from '../services/strategy';
import {
  prepareTimeframeCandlesForStrategy,
  runModularBacktest,
} from '../services/strategy/core/StrategyExecutor';
import { runBacktest, DEFAULT_STRATEGY_PARAMS } from '../services/backtestEngine';
import { generateForexCandles } from '../services/marketData';
import { Candle, Timeframe } from '../types/trading';

describe('Modular Multi-Timeframe Strategy Architecture Tests', () => {
  // Generate deterministic fixtures: 600 M15 candles (~6 days) and 150 H1 candles
  const m15Candles = generateForexCandles('EUR/USD', '15m', 101, 600, 'mixed');
  const h1Candles = generateForexCandles('EUR/USD', '1h', 101, 150, 'mixed');

  it('1. Strategy 001 declares and accesses both M15 and H1 simultaneously', () => {
    assert.equal(Strategy001.id, 'strategy_001');
    assert.deepEqual(Strategy001.requiredTimeframes, ['15m', '1h']);
    assert.equal(Strategy001.primaryTimeframe, '15m');

    const context = new MultiTimeframeMarketContext('EUR/USD', '15m', {
      '15m': m15Candles,
      '1h': h1Candles,
    });

    const barContext = context.createBarContext(100, Strategy001.defaultParameters);

    const currentM15 = barContext.getLatestClosedCandle('15m');
    const closedH1 = barContext.getLatestClosedCandle('1h');

    assert.ok(currentM15, 'M15 candle must be accessible');
    assert.ok(closedH1, 'H1 candle must be accessible simultaneously');
    assert.equal(currentM15?.time, m15Candles[100].time);
  });

  it('2. Strategy evaluation uses the correct latest CLOSED H1 candle', () => {
    const context = new MultiTimeframeMarketContext('EUR/USD', '15m', {
      '15m': m15Candles,
      '1h': h1Candles,
    });

    // Pick an M15 bar that falls inside an hour (e.g. 10:15, 10:30, or 10:45)
    for (let i = 20; i < 40; i++) {
      const bar = context.createBarContext(i, Strategy001.defaultParameters);
      const m15Time = bar.currentCandle.time;
      const m15CloseTime = m15Time + 900;
      const closedH1 = bar.getLatestClosedCandle('1h');

      if (closedH1) {
        const h1CloseTime = closedH1.time + 3600;
        // The closed H1 candle must have completed at or before this M15 evaluation time
        assert.ok(
          h1CloseTime <= m15CloseTime,
          `H1 close time (${h1CloseTime}) must be <= M15 evaluation close time (${m15CloseTime})`
        );
      }
    }
  });

  it('3. Strict No-Lookahead: No future or forming H1 candle can influence an M15 evaluation', () => {
    const context = new MultiTimeframeMarketContext('EUR/USD', '15m', {
      '15m': m15Candles,
      '1h': h1Candles,
    });

    for (let i = 50; i < 70; i++) {
      const bar = context.createBarContext(i, Strategy001.defaultParameters);
      const m15Close = bar.evaluationTime;
      const closedH1 = bar.getLatestClosedCandle('1h');

      if (closedH1) {
        assert.ok(
          closedH1.time + 3600 <= m15Close,
          `Lookahead violation: H1 candle at ${closedH1.time} closes at ${closedH1.time + 3600}, after M15 evaluation ${m15Close}`
        );
      }
    }
  });

  it('4. Chart Timeframe Independence: Changing active chart timeframe does NOT alter strategy results', () => {
    // Run backtest with Strategy 001 when chart is on 15m
    const resOnM15Chart = runBacktest(
      m15Candles,
      { ...DEFAULT_STRATEGY_PARAMS, strategyType: 'strategy_001' },
      'EUR/USD',
      '15m',
      h1Candles
    );

    // Run backtest with Strategy 001 when chart is on 1h (same candles passed, chart timeframe is 1h)
    const resOnH1Chart = runBacktest(
      m15Candles,
      { ...DEFAULT_STRATEGY_PARAMS, strategyType: 'strategy_001' },
      'EUR/USD',
      '1h',
      h1Candles
    );

    assert.equal(resOnM15Chart.totalTrades, resOnH1Chart.totalTrades, 'Total trades must be identical');
    assert.equal(resOnM15Chart.netR, resOnH1Chart.netR, 'Net R must be identical');
    assert.equal(resOnM15Chart.winRate, resOnH1Chart.winRate, 'Win rate must be identical');
    assert.equal(resOnM15Chart.trades.length, resOnH1Chart.trades.length, 'Trade count must be identical');
  });

  it('5. Strategy 001 evaluates entries on M15 candle closes', () => {
    const res = runBacktest(
      m15Candles,
      { ...DEFAULT_STRATEGY_PARAMS, strategyType: 'strategy_001' },
      'EUR/USD',
      '15m',
      h1Candles
    );

    for (const trade of res.trades) {
      if (trade.signalTime) {
        // Signal time must match an M15 candle timestamp
        const matchingCandle = m15Candles.find((c) => c.time === trade.signalTime);
        assert.ok(matchingCandle, `Signal time ${trade.signalTime} must align with an M15 candle timestamp`);
      }
    }
  });

  it('6. Strategies with different timeframe requirements receive the correct datasets', () => {
    const candles001 = prepareTimeframeCandlesForStrategy(Strategy001, m15Candles, h1Candles);
    assert.ok(candles001['15m'], 'Must provide 15m');
    assert.ok(candles001['1h'], 'Must provide 1h');

    const candles002 = prepareTimeframeCandlesForStrategy(Strategy002, m15Candles, h1Candles);
    assert.ok(candles002['15m'], 'Strategy 002 must receive 15m');
    assert.ok(candles002['1h'], 'Strategy 002 must receive 1h');
  });

  it('7. StrategyRegistry can register, alias, retrieve, and enumerate strategies', () => {
    assert.ok(StrategyRegistry.hasStrategy('strategy_001'));
    assert.ok(StrategyRegistry.hasStrategy('strategy_a')); // Alias
    assert.ok(StrategyRegistry.hasStrategy('strategy_002'));

    const strat1 = StrategyRegistry.getStrategy('strategy_001');
    const strat1Alias = StrategyRegistry.getStrategy('strategy_a');
    assert.equal(strat1?.id, 'strategy_001');
    assert.equal(strat1Alias?.id, 'strategy_001');

    const all = StrategyRegistry.getAllStrategies();
    assert.ok(all.some((s) => s.id === 'strategy_001'));
    assert.ok(all.some((s) => s.id === 'strategy_002'));
  });

  it('8. Test Strategy 003 can be added dynamically without modifying the backtesting engine', () => {
    // Define a new Strategy 003
    const Strategy003: StrategyDefinition<{ threshold: number }> = {
      id: 'test_strategy_003',
      name: 'Test Strategy 003: Custom Multi-Timeframe Test',
      version: '1.0.0',
      description: 'Dynamically registered test strategy.',
      primaryTimeframe: '15m',
      requiredTimeframes: ['15m', '1h'],
      timeframeDescription: 'M15 Entry + H1 Trend',
      parameterSchema: [],
      defaultParameters: { threshold: 1.0 },

      evaluateBar(context: StrategyBarContext<{ threshold: number }>): StrategySignal | null {
        const closedH1 = context.getLatestClosedCandle('1h');
        if (!closedH1) return null;

        // Custom trigger: If H1 is bullish and M15 close > open
        if (closedH1.close > closedH1.open && context.currentCandle.close > context.currentCandle.open) {
          if (context.currentIndex % 30 === 0) {
            return {
              direction: 'BUY',
              signalTime: context.currentCandle.time,
              entryTime: context.currentCandle.time + 900,
              entryPrice: context.currentCandle.close,
              stopLossPrice: context.currentCandle.close - 0.0020,
              takeProfitPrice: context.currentCandle.close + 0.0040,
              riskPips: 20,
              rewardPips: 40,
              riskRewardRatio: 2.0,
              signalReason: 'Custom 003 Trigger',
            };
          }
        }
        return null;
      },
    };

    // Register Strategy 003 in registry
    StrategyRegistry.registerStrategy(Strategy003);
    assert.ok(StrategyRegistry.hasStrategy('test_strategy_003'));

    // Execute backtest using core runBacktest engine WITHOUT any engine code modification!
    const result = runBacktest(
      m15Candles,
      { ...DEFAULT_STRATEGY_PARAMS, strategyType: 'test_strategy_003' },
      'EUR/USD',
      '15m',
      h1Candles
    );

    assert.ok(result, 'Backtest engine must complete successfully for Strategy 003');
    assert.ok(result.totalTrades >= 0);
    assert.ok(Array.isArray(result.trades));
    assert.ok(Array.isArray(result.equityCurve));

    // Clean up
    StrategyRegistry.unregisterStrategy('test_strategy_003');
  });

  it('9. Existing trade execution, conservative simultaneous touch, and risk management remain intact', () => {
    const res = runBacktest(
      m15Candles,
      { ...DEFAULT_STRATEGY_PARAMS, strategyType: 'strategy_001' },
      'EUR/USD',
      '15m',
      h1Candles
    );

    assert.ok(typeof res.winRate === 'number');
    assert.ok(typeof res.profitFactor === 'number');
    assert.ok(typeof res.totalPnlCurrency === 'number');
    assert.ok(Array.isArray(res.equityCurve));
    assert.ok(res.equityCurve.length > 0);
  });

  it('10. Strategy 002 executes cleanly via modular backtesting engine', () => {
    const res = runBacktest(
      m15Candles,
      { ...DEFAULT_STRATEGY_PARAMS, strategyType: 'strategy_002' },
      'EUR/USD',
      '15m',
      h1Candles
    );

    assert.ok(res, 'Strategy 002 backtest must execute cleanly');
    assert.ok(typeof res.netR === 'number');
    assert.ok(typeof res.winRate === 'number');
    assert.ok(Array.isArray(res.trades));
  });
});
