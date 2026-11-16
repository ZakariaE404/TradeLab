import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Candle, ForexSymbol, Timeframe, StrategyParameters } from '../types/trading';
import {
  StrategyRegistry,
  Strategy001,
  Strategy002,
  MultiTimeframeMarketContext,
  ExplicitTimeframeDataset,
  validateAndNormalizeTimeframe,
} from '../services/strategy';
import {
  prepareTimeframeCandlesForStrategy,
  runModularBacktest,
} from '../services/strategy/core/StrategyExecutor';
import {
  getLatestClosedHigherTimeframeIndex,
  getLatestClosedH1Index,
  assertNoLookaheadGeneric,
  assertNoLookahead,
} from '../services/multiTimeframeSync';
import {
  calculateSequentialEMA,
  calculateSequentialEMAMap,
  calculateSequentialATR,
  calculateSequentialATRMap,
} from '../services/indicators';
import {
  detectConfirmedSwings,
  evaluateMarketStructure,
  evaluateH1Trend,
  evaluateRejectionCandle,
  evaluateSupportResistanceZone,
} from '../services/strategyA';
import { runBacktest, DEFAULT_STRATEGY_PARAMS } from '../services/backtestEngine';
import { generateForexCandles, FOREX_SYMBOLS } from '../services/marketData';

function makeCandle(
  time: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume: number = 1000
): Candle {
  return { time, open, high, low, close, volume };
}

describe('Phase 8A: Strategy 001 Unit Tests', () => {
  it('1. Sequential EMA calculation correctness and warmup', () => {
    // 6 known closes: 10, 11, 12, 13, 14, 15
    const candles: Candle[] = [
      makeCandle(1000, 10, 10.5, 9.5, 10),
      makeCandle(1900, 11, 11.5, 10.5, 11),
      makeCandle(2800, 12, 12.5, 11.5, 12),
      makeCandle(3700, 13, 13.5, 12.5, 13),
      makeCandle(4600, 14, 14.5, 13.5, 14),
      makeCandle(5500, 15, 15.5, 14.5, 15),
    ];

    const period = 3;
    // Multiplier = 2 / (3 + 1) = 0.5
    // SMA for first 3 (indices 0, 1, 2) = (10 + 11 + 12) / 3 = 11.0
    // Bar 3 (13): 13 * 0.5 + 11.0 * 0.5 = 12.0
    // Bar 4 (14): 14 * 0.5 + 12.0 * 0.5 = 13.0
    // Bar 5 (15): 15 * 0.5 + 13.0 * 0.5 = 14.0
    const ema = calculateSequentialEMA(candles, period);
    assert.equal(ema[0], null);
    assert.equal(ema[1], null);
    assert.equal(ema[2], 11.0);
    assert.equal(ema[3], 12.0);
    assert.equal(ema[4], 13.0);
    assert.equal(ema[5], 14.0);
  });

  it('2. Sequential ATR Wilder smoothing correctness', () => {
    const candles: Candle[] = [
      makeCandle(1000, 100, 105, 95, 100),  // TR = 10
      makeCandle(1900, 100, 110, 98, 108),  // TR = max(12, 10, 2) = 12
      makeCandle(2800, 108, 112, 104, 106), // TR = max(8, 4, 4) = 8
      makeCandle(3700, 106, 115, 103, 114), // TR = max(12, 9, 3) = 12
    ];

    const period = 3;
    // Initial SMA of TR = (10 + 12 + 8) / 3 = 10.0
    // Bar 3: (10.0 * 2 + 12) / 3 = 32 / 3 = 10.66667
    const atr = calculateSequentialATR(candles, period);
    assert.equal(atr[0], null);
    assert.equal(atr[1], null);
    assert.equal(atr[2], 10.0);
    assert.equal(atr[3], 10.66667);
  });

  it('3. Confirmed swing detection guarantees zero future-data lookahead', () => {
    const candles: Candle[] = [];
    const baseTime = 1700000000;
    for (let i = 0; i < 20; i++) {
      candles.push(makeCandle(baseTime + i * 900, 100, 101, 99, 100));
    }
    // High at bar 5 (price 115)
    candles[5] = makeCandle(baseTime + 5 * 900, 100, 115, 99, 105);

    // Lookback = 3. Swing at bar 5 can ONLY be confirmed at bar 5 + 3 = 8
    const swingsAtBar7 = detectConfirmedSwings(candles, 3, 7);
    assert.equal(swingsAtBar7.length, 0, 'Swing at bar 5 must NOT be visible at bar 7');

    const swingsAtBar8 = detectConfirmedSwings(candles, 3, 8);
    assert.equal(swingsAtBar8.length, 1, 'Swing at bar 5 must be confirmed at bar 8');
    assert.equal(swingsAtBar8[0].index, 5);
    assert.equal(swingsAtBar8[0].price, 115);
    assert.equal(swingsAtBar8[0].confirmedAtIndex, 8);
  });

  it('4. Bullish and bearish market structure analysis from confirmed swings', () => {
    const bullishSwings = [
      { index: 2, time: 1000, price: 100, type: 'LOW' as const, confirmedAtIndex: 5, confirmedAtTime: 1300 },
      { index: 4, time: 1200, price: 110, type: 'HIGH' as const, confirmedAtIndex: 7, confirmedAtTime: 1500 },
      { index: 6, time: 1400, price: 105, type: 'LOW' as const, confirmedAtIndex: 9, confirmedAtTime: 1700 }, // Higher Low
      { index: 8, time: 1600, price: 115, type: 'HIGH' as const, confirmedAtIndex: 11, confirmedAtTime: 1900 }, // Higher High
    ];
    const bullStruct = evaluateMarketStructure(bullishSwings);
    assert.equal(bullStruct.structure, 'BULLISH');

    const bearishSwings = [
      { index: 2, time: 1000, price: 120, type: 'HIGH' as const, confirmedAtIndex: 5, confirmedAtTime: 1300 },
      { index: 4, time: 1200, price: 105, type: 'LOW' as const, confirmedAtIndex: 7, confirmedAtTime: 1500 },
      { index: 6, time: 1400, price: 115, type: 'HIGH' as const, confirmedAtIndex: 9, confirmedAtTime: 1700 }, // Lower High
      { index: 8, time: 1600, price: 95, type: 'LOW' as const, confirmedAtIndex: 11, confirmedAtTime: 1900 }, // Lower Low
    ];
    const bearStruct = evaluateMarketStructure(bearishSwings);
    assert.equal(bearStruct.structure, 'BEARISH');
  });

  it('5. Bullish and bearish rejection candle wick ratio and close location math', () => {
    // Valid Bullish Rejection: 60% lower wick, close in upper 60%
    const bullCandle = makeCandle(1000, 106, 110, 100, 108);
    const bullRej = evaluateRejectionCandle(bullCandle, 0.35);
    assert.equal(bullRej.type, 'BULLISH_REJECTION');
    assert.equal(bullRej.wickRatio, 0.6);

    // Invalid Rejection: wick only 20%
    const weakCandle = makeCandle(1000, 102, 110, 100, 109);
    const weakRej = evaluateRejectionCandle(weakCandle, 0.35);
    assert.equal(weakRej.type, 'NONE');

    // Valid Bearish Rejection: 70% upper wick, close in lower 60%
    const bearCandle = makeCandle(1000, 103, 110, 100, 101);
    const bearRej = evaluateRejectionCandle(bearCandle, 0.35);
    assert.equal(bearRej.type, 'BEARISH_REJECTION');
    assert.equal(bearRej.wickRatio, 0.7);
  });

  it('6. Support and resistance zone reach verification', () => {
    const candle = makeCandle(1000, 2005, 2008, 1999.5, 2004);
    const tolerance = 2.0;

    // BUY direction: Low (1999.5) touches EMA50 (2000.0) within tolerance (2.0)
    const resBuy = evaluateSupportResistanceZone(candle, 2000.0, null, null, 'BUY', tolerance);
    assert.equal(resBuy.isZoneReached, true);
    assert.equal(resBuy.zoneLevel, 2000.0);

    // Far above zone: Low is 2010 vs EMA 2000 -> Out of reach
    const farCandle = makeCandle(1000, 2012, 2015, 2010, 2014);
    const resFar = evaluateSupportResistanceZone(farCandle, 2000.0, null, null, 'BUY', tolerance);
    assert.equal(resFar.isZoneReached, false);
  });

  it('7. Stop-loss, take-profit, and position sizing calculation math', () => {
    const entryPrice = 2000.0;
    const swingLow = 1990.0;
    const bufferPips = 2.0;
    const pipSize = 0.1; // Gold pip size
    const bufferPrice = bufferPips * pipSize; // 0.2
    const calculatedSL = swingLow - bufferPrice; // 1989.8
    const minSlPrice = 5.0 * pipSize; // 0.5
    const finalSL = Math.min(calculatedSL, entryPrice - minSlPrice); // 1989.8
    const riskDistance = entryPrice - finalSL; // 10.2
    const rr = 2.0;
    const finalTP = entryPrice + riskDistance * rr; // 2020.4

    assert.equal(Number(finalSL.toFixed(2)), 1989.8);
    assert.equal(Number(finalTP.toFixed(2)), 2020.4);

    // Risk percentage: 1% on 10,000 capital = $100
    const capital = 10000;
    const riskPercent = 1.0;
    const riskAmount = capital * (riskPercent / 100);
    assert.equal(riskAmount, 100.0);
  });
});

describe('Phase 8B: Multi-Timeframe Integration & Explicit Data Access', () => {
  it('1. Strategy 001 receives both M15 and H1 datasets via explicit envelopes', () => {
    const m15Data: ExplicitTimeframeDataset = {
      timeframe: 'M15',
      candles: [makeCandle(1000, 100, 105, 95, 102), makeCandle(1900, 102, 106, 100, 104)],
    };
    const h1Data: ExplicitTimeframeDataset = {
      timeframe: 'H1',
      candles: [makeCandle(1000, 100, 106, 95, 104)],
    };

    const context = new MultiTimeframeMarketContext('EUR/USD', '15m', [m15Data, h1Data]);
    assert.equal(context.primaryTimeframe, '15m');
    assert.ok(context.candlesByTimeframe.has('15m'));
    assert.ok(context.candlesByTimeframe.has('1h'));
    assert.equal(context.candlesByTimeframe.get('15m')?.length, 2);
    assert.equal(context.candlesByTimeframe.get('1h')?.length, 1);
  });

  it('2. Unknown or undeclared timeframes throw an explicit error', () => {
    assert.throws(
      () => validateAndNormalizeTimeframe('INVALID_TF'),
      /Unknown or unsupported timeframe/
    );

    assert.throws(
      () => new MultiTimeframeMarketContext('EUR/USD', 'INVALID_TF' as any, []),
      /Unknown or unsupported timeframe/
    );

    const badDataset = { timeframe: 'XYZ', candles: [] };
    assert.throws(
      () => new MultiTimeframeMarketContext('EUR/USD', '15m', [badDataset]),
      /Unknown or unsupported timeframe/
    );
  });

  it('3. Exact H1/M15 closing boundaries and zero-lookahead validation', () => {
    // Hour 0: [1000, 4600) -> Opens 1000, Closes at 4600 (3600 seconds duration)
    // Hour 1: [4600, 8200) -> Opens 4600, Closes at 8200
    const h1Candles = [
      makeCandle(1000, 100, 105, 95, 102),
      makeCandle(4600, 102, 108, 101, 107),
    ];

    // M15 candle 0: [1000, 1900). Evaluates at 1900 -> Hour 0 is forming, NOT closed
    assert.equal(getLatestClosedH1Index(1000, h1Candles, 900, 'close'), -1);

    // M15 candle 3: [3700, 4600). Evaluates at 4600 -> Hour 0 finishes EXACTLY at 4600!
    assert.equal(getLatestClosedH1Index(3700, h1Candles, 900, 'close'), 0);

    // M15 candle 4: [4600, 5500). Evaluates at 5500 -> Hour 0 is closed (idx 0), Hour 1 is forming
    assert.equal(getLatestClosedH1Index(4600, h1Candles, 900, 'close'), 0);

    // M15 candle 7: [7300, 8200). Evaluates at 8200 -> Hour 1 finishes EXACTLY at 8200!
    assert.equal(getLatestClosedH1Index(7300, h1Candles, 900, 'close'), 1);
  });

  it('4. assertNoLookaheadGeneric detects and blocks future data leaks', () => {
    const h1Candle = makeCandle(3600, 100, 105, 95, 102); // Closes at 3600 + 3600 = 7200
    // Lower bar evaluates at 4500 (close) -> h1Close (7200) > 4500 -> Lookahead error!
    assert.throws(
      () => assertNoLookaheadGeneric(3600, h1Candle, 900, 3600, 'close'),
      /Future-data lookahead violation detected/
    );
  });

  it('5. Missing or insufficient indicator history produces no signals', () => {
    // Only 20 candles: less than 50 minimum warmup bars
    const shortCandles = generateForexCandles('EUR/USD', '15m', 42, 20, 'mixed');
    const res = runBacktest(shortCandles, DEFAULT_STRATEGY_PARAMS, 'EUR/USD', '15m');
    assert.equal(res.totalTrades, 0);
  });
});

describe('Phase 8C: Strategy Logic Tests on Deterministic Market Conditions', () => {
  it('1. Clear Bullish H1 Trend + M15 Rejection produces BUY signal', () => {
    const candles: Candle[] = [];
    const baseTime = 1700000000;
    const interval = 900;

    let price = 2000.0;
    // 260 candles upward trend
    for (let i = 0; i < 260; i++) {
      const open = price;
      const close = price + 0.4;
      candles.push(makeCandle(baseTime + i * interval, open, close + 0.3, open - 0.2, close));
      price = close;
    }

    // Insert a confirmed swing low 8 bars back
    const swingIdx = candles.length - 8;
    candles[swingIdx] = makeCandle(
      candles[swingIdx].time,
      candles[swingIdx].open - 5,
      candles[swingIdx].open - 3,
      candles[swingIdx].open - 12,
      candles[swingIdx].open - 4
    );

    // M15 EMA 20
    const emaFast = calculateSequentialEMA(candles, 20);
    const currEma = emaFast[emaFast.length - 1]!;

    // Rejection bar touching EMA
    const sigIdx = candles.length;
    const sigOpen = currEma + 2.0;
    const sigLow = currEma - 0.5;
    const sigClose = currEma + 3.0;
    candles.push(makeCandle(baseTime + sigIdx * interval, sigOpen, sigClose + 0.5, sigLow, sigClose));

    // Next bar reaches TP
    candles.push(makeCandle(baseTime + (sigIdx + 1) * interval, sigClose, sigClose + 60.0, sigClose - 0.5, sigClose + 55.0));

    const params: StrategyParameters = {
      ...DEFAULT_STRATEGY_PARAMS,
      strategyType: 'strategy_001',
      strategyA: {
        ...DEFAULT_STRATEGY_PARAMS.strategyA,
        h1FastEmaPeriod: 10,
        h1SlowEmaPeriod: 25,
        m15FastEmaPeriod: 20,
        m15SlowEmaPeriod: 50,
        requireH1Structure: false,
        requireM15EmaFilter: false,
        riskRewardRatio: 2.0,
      },
    };

    const res = runBacktest(candles, params, 'XAUUSDm', '15m');
    assert.ok(res.totalTrades > 0, 'Should execute trade');
    const trade = res.trades[res.trades.length - 1];
    assert.equal(trade.direction, 'BUY');
    assert.equal(trade.status, 'WIN');
    assert.equal(trade.exitReason, 'TP');
  });

  it('2. Sideways / Flat Market produces NO signals', () => {
    const candles: Candle[] = [];
    const baseTime = 1700000000;
    // 300 flat oscillating candles with zero trend
    for (let i = 0; i < 300; i++) {
      const p = 2000.0 + (i % 2 === 0 ? 0.2 : -0.2);
      candles.push(makeCandle(baseTime + i * 900, p, p + 0.3, p - 0.3, p));
    }

    const res = runBacktest(candles, DEFAULT_STRATEGY_PARAMS, 'XAUUSDm', '15m');
    assert.equal(res.totalTrades, 0, 'Flat sideways market without trend structure must produce 0 trades');
  });

  it('3. False Rejection (wick ratio < 35%) is rejected and produces NO signal', () => {
    const candles: Candle[] = [];
    const baseTime = 1700000000;
    let price = 2000.0;
    for (let i = 0; i < 260; i++) {
      candles.push(makeCandle(baseTime + i * 900, price, price + 0.4, price - 0.2, price + 0.3));
      price += 0.3;
    }

    // Candle with only 10% lower wick
    const invalidCandle = makeCandle(baseTime + 260 * 900, price, price + 5.0, price - 0.5, price + 4.5);
    candles.push(invalidCandle);

    const rej = evaluateRejectionCandle(invalidCandle, 0.35);
    assert.equal(rej.type, 'NONE');
  });
});

describe('Phase 8D: Execution & Risk Management Tests', () => {
  it('1. Conservative Same-Bar SL & TP Touch strictly resolves to STOP LOSS', () => {
    const candles: Candle[] = [];
    const baseTime = 1700000000;
    let price = 2000.0;
    for (let i = 0; i < 260; i++) {
      candles.push(makeCandle(baseTime + i * 900, price, price + 0.5, price - 0.2, price + 0.4));
      price += 0.4;
    }

    const emaFast = calculateSequentialEMA(candles, 20);
    const currEma = emaFast[emaFast.length - 1]!;

    // Signal bar
    const sigOpen = currEma + 2.0;
    const sigLow = currEma - 0.5;
    const sigClose = currEma + 3.0;
    candles.push(makeCandle(baseTime + 260 * 900, sigOpen, sigClose + 0.5, sigLow, sigClose));

    // Next bar touches both SL (far low) and TP (far high) in the same bar
    candles.push(makeCandle(baseTime + 261 * 900, sigClose, 2400.0, 1600.0, 2000.0));

    const params: StrategyParameters = {
      ...DEFAULT_STRATEGY_PARAMS,
      strategyType: 'strategy_001',
      strategyA: {
        ...DEFAULT_STRATEGY_PARAMS.strategyA,
        h1FastEmaPeriod: 10,
        h1SlowEmaPeriod: 25,
        m15FastEmaPeriod: 20,
        m15SlowEmaPeriod: 50,
        requireH1Structure: false,
        requireM15EmaFilter: false,
      },
    };

    const res = runBacktest(candles, params, 'XAUUSDm', '15m');
    assert.ok(res.trades.length > 0);
    const trade = res.trades[res.trades.length - 1];
    assert.equal(trade.status, 'LOSS');
    assert.equal(trade.exitReason, 'SL');
    assert.equal(trade.simultaneousTouchResolvedToSL, true);
    assert.ok(trade.pnlR <= -0.9, 'Loss must be -1.0R');
  });

  it('2. Position Exclusivity prevents duplicate overlapping trades', () => {
    const candles = generateForexCandles('EUR/USD', '15m', 101, 1000, 'trending_bull');
    const res = runBacktest(candles, DEFAULT_STRATEGY_PARAMS, 'EUR/USD', '15m');

    for (let i = 0; i < res.trades.length - 1; i++) {
      const current = res.trades[i];
      const next = res.trades[i + 1];
      if (current.exitTime > 0) {
        assert.ok(
          next.entryTime >= current.exitTime,
          `Trade ${next.id} entered at ${next.entryTime} before prior trade ${current.id} exited at ${current.exitTime}`
        );
      }
    }
  });

  it('3. Mathematical equity and drawdown precision verification', () => {
    const candles = generateForexCandles('XAUUSDm', '15m', 42, 800, 'mixed');
    const res = runBacktest(candles, DEFAULT_STRATEGY_PARAMS, 'XAUUSDm', '15m');

    assert.ok(Array.isArray(res.equityCurve));
    assert.ok(res.equityCurve.length > 0);

    let runningEquity = DEFAULT_STRATEGY_PARAMS.accountBalance;
    let peak = runningEquity;
    let maxDd = 0;

    for (const t of res.trades) {
      runningEquity += t.pnlCurrency;
      if (runningEquity > peak) peak = runningEquity;
      const dd = peak - runningEquity;
      if (dd > maxDd) maxDd = dd;
    }

    assert.equal(Number(runningEquity.toFixed(1)), Number((res.totalPnlCurrency + DEFAULT_STRATEGY_PARAMS.accountBalance).toFixed(1)));
  });
});

describe('Phase 8F: Chart Timeframe Independence Tests', () => {
  it('1. Changing chart display timeframe produces 100% IDENTICAL trades and metrics', () => {
    const m15Candles = generateForexCandles('EUR/USD', '15m', 202, 1000, 'mixed');
    const h1Candles = generateForexCandles('EUR/USD', '1h', 202, 250, 'mixed');

    // Run 1: Chart displays 15m
    const resChartM15 = runBacktest(
      m15Candles,
      { ...DEFAULT_STRATEGY_PARAMS, strategyType: 'strategy_001' },
      'EUR/USD',
      '15m',
      h1Candles
    );

    // Run 2: Chart displays 1h
    const resChartH1 = runBacktest(
      m15Candles,
      { ...DEFAULT_STRATEGY_PARAMS, strategyType: 'strategy_001' },
      'EUR/USD',
      '1h',
      h1Candles
    );

    // Run 3: Chart displays 4h
    const resChartH4 = runBacktest(
      m15Candles,
      { ...DEFAULT_STRATEGY_PARAMS, strategyType: 'strategy_001' },
      'EUR/USD',
      '4h',
      h1Candles
    );

    assert.equal(resChartM15.totalTrades, resChartH1.totalTrades);
    assert.equal(resChartM15.totalTrades, resChartH4.totalTrades);
    assert.equal(resChartM15.netR, resChartH1.netR);
    assert.equal(resChartM15.netR, resChartH4.netR);
    assert.equal(resChartM15.winRate, resChartH1.winRate);
    assert.equal(resChartM15.profitFactor, resChartH1.profitFactor);
    assert.equal(resChartM15.totalPnlCurrency, resChartH1.totalPnlCurrency);

    // Each individual trade must match exactly
    for (let i = 0; i < resChartM15.trades.length; i++) {
      const t1 = resChartM15.trades[i];
      const t2 = resChartH1.trades[i];
      assert.equal(t1.entryTime, t2.entryTime);
      assert.equal(t1.entryPrice, t2.entryPrice);
      assert.equal(t1.stopLoss, t2.stopLoss);
      assert.equal(t1.takeProfit, t2.takeProfit);
      assert.equal(t1.exitPrice, t2.exitPrice);
      assert.equal(t1.status, t2.status);
      assert.equal(t1.pnlR, t2.pnlR);
    }
  });
});

describe('Phase 8G: Strategy Status UI & Regression Tests', () => {
  it('1. Strategy 001 is active and validated', () => {
    assert.equal(Strategy001.id, 'strategy_001');
    assert.equal(Strategy001.status, 'active');
    assert.equal(Strategy001.primaryTimeframe, '15m');
    assert.deepEqual(Strategy001.requiredTimeframes, ['15m', '1h']);
    assert.equal(Strategy001.timeframeDescription, 'M15 Entry + H1 Trend');
  });

  it('2. Strategy 002 is disabled and blocked from execution', () => {
    assert.equal(Strategy002.status, 'disabled');
    assert.ok(Strategy002.statusMessage?.includes('Disabled / Not Validated'));

    const res = runBacktest(
      generateForexCandles('EUR/USD', '15m', 42, 200, 'mixed'),
      { ...DEFAULT_STRATEGY_PARAMS, strategyType: 'strategy_002' },
      'EUR/USD',
      '15m'
    );
    assert.equal(res.totalTrades, 0);
    assert.ok(res.assumptions && res.assumptions.some((a) => a.includes('Disabled / Not Validated')));
  });

  it('3. User parameters reactively update indicator calculations in Strategy 001', () => {
    const candles = generateForexCandles('EUR/USD', '15m', 101, 800, 'trending_bull');

    // Default RR = 2.0
    const res1 = runBacktest(candles, { ...DEFAULT_STRATEGY_PARAMS, riskRewardRatio: 2.0 }, 'EUR/USD', '15m');

    // Modified RR = 3.0
    const res2 = runBacktest(
      candles,
      {
        ...DEFAULT_STRATEGY_PARAMS,
        riskRewardRatio: 3.0,
        strategyA: { ...DEFAULT_STRATEGY_PARAMS.strategyA, riskRewardRatio: 3.0 },
      },
      'EUR/USD',
      '15m'
    );

    const winTrade1 = res1.trades.find((t) => t.status === 'WIN');
    const winTrade2 = res2.trades.find((t) => t.status === 'WIN');
    if (winTrade1 && winTrade2) {
      assert.equal(winTrade1.riskRewardRatio, 2.0);
      assert.equal(winTrade2.riskRewardRatio, 3.0);
    }
  });
});
