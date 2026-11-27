import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Candle } from '../types/trading';
import { StrategyRegistry } from '../services/strategy';
import {
  calculateSmcFibQuantity,
  calculateSmaAtr,
  isCryptoSymbol,
  runSmcFibBacktest,
  SmcFib4hV1,
} from '../services/strategy/implementations/smcFib4hV1';
import { DEFAULT_STRATEGY_PARAMS, runBacktest } from '../services/backtestEngine';
import { getBacktestCacheKey } from '../services/cacheService';

function makeBar(
  idx: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume = 100
): Candle {
  return {
    time: 1700000000 + idx * 14400,
    open,
    high,
    low,
    close,
    volume,
  };
}

describe('SMC_FIB_4H_V1 Strategy Engine Unit & Integration Tests', () => {
  it('1. Registers SMC_FIB_4H_V1 cleanly in StrategyRegistry', () => {
    const strat = StrategyRegistry.getStrategy('smc_fib_4h_v1');
    assert.ok(strat, 'smc_fib_4h_v1 must be registered');
    assert.equal(strat.id, SmcFib4hV1.id);
    assert.equal(strat.primaryTimeframe, '4h');
    assert.equal(strat.status, 'active');
  });

  it('2. Computes SMA-based ATR(14) matching QC MovingAverageType.Simple and Pine ta.sma(ta.tr, 14)', () => {
    const bars: Candle[] = [
      makeBar(0, 100, 104, 98, 102), // TR = 6
      makeBar(1, 102, 108, 101, 107), // TR = max(7, 6, 1) = 7
      makeBar(2, 107, 110, 103, 104), // TR = max(7, 3, 4) = 7
      makeBar(3, 104, 106, 99, 100), // TR = max(7, 2, 5) = 7
    ];

    const atr3 = calculateSmaAtr(bars, 3);
    assert.equal(atr3[0], null);
    assert.equal(atr3[1], null);
    assert.ok(Math.abs(atr3[2]! - (6 + 7 + 7) / 3) < 1e-9);
    assert.ok(Math.abs(atr3[3]! - (7 + 7 + 7) / 3) < 1e-9);

    // Causal invariance check
    const atr3Prefix = calculateSmaAtr(bars.slice(0, 3), 3);
    assert.equal(atr3Prefix[2], atr3[2]);
  });

  it('3. Rounds crypto qty to 4 decimals and floors equity/ETF qty to integer', () => {
    assert.equal(isCryptoSymbol('BTCUSD'), true);
    assert.equal(isCryptoSymbol('ETHUSD'), true);
    assert.equal(isCryptoSymbol('SPY'), false);
    assert.equal(isCryptoSymbol('AAPL'), false);

    // Equity = 100000, risk = 0.5% -> $500; riskDist = 12 -> 41.6666...
    assert.equal(calculateSmcFibQuantity(100000, 0.5, 12, false), 41);
    assert.equal(calculateSmcFibQuantity(100000, 0.5, 12, true), 41.6667);
  });

  it('4. Detects swing(10), Bull BOS, dynamic impulse extension, Fib 0.60-0.70 long entry, and 15R TP', () => {
    const bars: Candle[] = [];
    // Bars 0..24: flat range [98..102], with swing low=90 at idx 10 (confirmed at i=20) and swing high=110 at idx 12 (confirmed at i=22)
    for (let i = 0; i < 25; i++) {
      bars.push(makeBar(i, 100, 102, 98, 100));
    }
    bars[10] = makeBar(10, 96, 101, 90, 95); // Confirmed swing low at i = 20
    bars[12] = makeBar(12, 105, 110, 99, 104); // Confirmed swing high at i = 22

    // Bar 25: Bullish BOS (prev close 100 <= 110, current close 112 > 110, high 120)
    // impulseLow = 90, impulseHigh = 120 -> dist = 30
    // bullTop = 120 - 30 * 0.60 = 102, bullBottom = 120 - 30 * 0.70 = 99
    bars.push(makeBar(25, 108, 120, 107, 112));

    // Bar 26: Extend impulse high to 140 -> dist = 140 - 90 = 50
    // bullTop = 140 - 50 * 0.60 = 110, bullBottom = 140 - 50 * 0.70 = 105
    bars.push(makeBar(26, 112, 140, 111, 130));

    // Bar 27: Retracement into Fib zone [105, 110]: low=108 <= 110 and close=109 > 105 -> Long Entry!
    bars.push(makeBar(27, 128, 129, 108, 109));

    // Bar 28: Entry at open=109 (in next_open mode) and stays flat before huge rally
    bars.push(makeBar(28, 109, 115, 108, 114));

    // Bar 29: Rally well past 15R TP
    bars.push(makeBar(29, 114, 500, 113, 490));

    const res = runSmcFibBacktest(bars, 'SPY', { executionTiming: 'next_open' });

    assert.ok(res.smcOverlay, 'Overlay data must be emitted');
    assert.ok(
      res.smcOverlay.structureEvents.some((e) => e.type === 'BULL_BOS' && e.brokenLevel === 110),
      'Must emit BULL_BOS at 110'
    );
    assert.equal(res.totalTrades, 1);
    const trade = res.trades[0];
    assert.equal(trade.direction, 'BUY');
    assert.equal(trade.entryPrice, 109);
    assert.equal(trade.status, 'WIN');
    assert.equal(trade.exitReason, 'TP');
    assert.equal(trade.riskRewardRatio, 15);
    // Equity integer floor (Math.floor(500 / riskDist)) slightly reduces realized R below 15.0
    assert.ok(trade.pnlR >= 14.0 && trade.pnlR <= 15.0, `Expected ~14-15R win, got ${trade.pnlR}`);
  });

  it('5. Handles CHOCH (longFail) liquidation of open long and immediate counter-trend short reversal', () => {
    const bars: Candle[] = [];
    for (let i = 0; i < 25; i++) {
      bars.push(makeBar(i, 1000, 1002, 998, 1000));
    }
    bars[10] = makeBar(10, 996, 1001, 990, 995); // swing low = 990 (confirmed at i=20)
    bars[12] = makeBar(12, 1005, 1010, 999, 1004); // swing high = 1010 (confirmed at i=22)

    // Bar 25: Bull BOS -> impulseLow=990, impulseHigh=1020 -> bullTop=1002, bullBottom=999
    bars.push(makeBar(25, 1008, 1020, 1007, 1012));

    // Bar 26: Long entry inside [999, 1002] -> low=1001 <= 1002, close=1001.5 > 999
    bars.push(makeBar(26, 1010, 1011, 1001, 1001.5));

    // Bar 27: Stays above SL, closes at 998 (< bullBottom=999) -> longFail!
    // Liquidates Long at 998 and opens counter-trend Short at 998!
    bars.push(makeBar(27, 1001.5, 1002, 997, 998));

    // Bar 28: Holds inside SL/TP
    bars.push(makeBar(28, 998, 999, 995, 996));

    // Bar 29: Wick drops to 500 (hits Short 15R TP) and closes at 992 (> lastLow 990 so no new bearBOS)
    bars.push(makeBar(29, 996, 997, 500, 992));

    const res = runSmcFibBacktest(bars, 'SPY', { executionTiming: 'close' });

    assert.ok(
      res.smcOverlay?.structureEvents.some((e) => e.type === 'BEAR_CHOCH'),
      'Must emit BEAR_CHOCH event on longFail'
    );
    assert.equal(res.trades.length, 2, 'Should have liquidated Long + counter-trend Short');
    assert.equal(res.trades[0].direction, 'BUY');
    assert.equal(res.trades[0].exitReason, 'SIGNAL_CLOSE');
    assert.equal(res.trades[1].direction, 'SELL');
    assert.equal(res.trades[1].exitReason, 'TP');
    assert.equal(res.trades[1].status, 'WIN');
  });

  it('6. Resolves simultaneous SL & TP touch conservatively to STOP LOSS', () => {
    const bars: Candle[] = [];
    for (let i = 0; i < 25; i++) {
      bars.push(makeBar(i, 100, 102, 98, 100));
    }
    bars[10] = makeBar(10, 96, 101, 90, 95);
    bars[12] = makeBar(12, 105, 110, 99, 104);
    bars.push(makeBar(25, 108, 120, 107, 112)); // Bull BOS: bullTop=102, bullBottom=99
    bars.push(makeBar(26, 110, 111, 101, 101.5)); // Long entry signal
    // Bar 27: Next bar touches BOTH SL (far below) and TP (far above)
    bars.push(makeBar(27, 101.5, 500, 10, 105));

    const res = runSmcFibBacktest(bars, 'SPY', { executionTiming: 'next_open' });
    assert.equal(res.totalTrades, 1);
    assert.equal(res.trades[0].status, 'LOSS');
    assert.equal(res.trades[0].exitReason, 'SL');
    assert.equal(res.trades[0].simultaneousTouchResolvedToSL, true);
  });

  it('7. Routes via runBacktest() and invalidates cache keys when smcFibConfig changes', () => {
    const bars: Candle[] = [];
    for (let i = 0; i < 60; i++) {
      const p = 100 + Math.sin(i / 4) * 5;
      bars.push(makeBar(i, p, p + 2, p - 2, p + 0.5));
    }

    const params1 = {
      ...DEFAULT_STRATEGY_PARAMS,
      strategyType: 'smc_fib_4h_v1' as const,
      accountBalance: 100000,
      riskPercent: 0.5,
      riskRewardRatio: 15,
      smcFibConfig: { executionTiming: 'next_open' as const },
    };
    const params2 = {
      ...params1,
      smcFibConfig: { executionTiming: 'close' as const },
    };

    const res = runBacktest(bars, params1, 'BTCUSD', '4h');
    assert.ok(res.equityCurve.length >= 1);
    assert.ok(res.assumptions?.some((a) => a.includes('SMC_FIB_4H_V1')));

    const k1 = getBacktestCacheKey('abc', 'BTCUSD', '4h', params1);
    const k2 = getBacktestCacheKey('abc', 'BTCUSD', '4h', params2);
    assert.notEqual(k1, k2, 'Cache key must invalidate when executionTiming changes');
  });
});
