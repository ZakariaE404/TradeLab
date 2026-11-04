import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Candle } from '../types/trading';
import {
  DEFAULT_STRATEGY_A_PARAMS,
  evaluateRejectionCandle,
  runStrategyABacktest,
} from '../services/strategyA';
import { DEFAULT_STRATEGY_PARAMS, runBacktest } from '../services/backtestEngine';
import { calculateEMA } from '../services/indicators';
import { getBacktestCacheKey } from '../services/cacheService';

/**
 * Creates deterministic candle with exact coordinates
 */
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

describe('Deterministic Strategy Fixtures & Known Trade Outcomes', () => {
  it('should evaluate bullish rejection candle accurately with exact wick math', () => {
    // Total range: 100 to 110 (10.0). Open: 106, Close: 108, Low: 100, High: 110
    // Lower wick = min(106, 108) - 100 = 6.0
    // Lower wick ratio = 6.0 / 10.0 = 0.60 (60% wick)
    // Upper wick = 110 - 108 = 2.0 (20%)
    // Close ratio = (108 - 100) / 10 = 0.80 (in top 60%)
    const candle = makeCandle(1700000000, 106, 110, 100, 108);
    const rejection = evaluateRejectionCandle(candle, 0.35);

    assert.equal(rejection.type, 'BULLISH_REJECTION');
    assert.equal(rejection.wickRatio, 0.6);
  });

  it('should evaluate bearish rejection candle accurately with exact wick math', () => {
    // Total range: 100 to 110 (10.0). Open: 103, Close: 101, High: 110, Low: 100
    // Upper wick = 110 - max(103, 101) = 7.0
    // Upper wick ratio = 7.0 / 10.0 = 0.70 (70% wick)
    // Close ratio = (101 - 100) / 10 = 0.10 (in lower 60%)
    const candle = makeCandle(1700000000, 103, 110, 100, 101);
    const rejection = evaluateRejectionCandle(candle, 0.35);

    assert.equal(rejection.type, 'BEARISH_REJECTION');
    assert.equal(rejection.wickRatio, 0.7);
  });

  it('should produce a deterministic WIN (+2.0R) trade on a synthetic bullish retest setup', () => {
    const candles: Candle[] = [];
    const baseTime = 1700000000;
    const interval = 900; // M15

    // Build 260 baseline upward-trending candles
    let price = 2000.0;
    for (let i = 0; i < 260; i++) {
      const open = price;
      const close = price + 0.5;
      const high = close + 0.3;
      const low = open - 0.2;
      candles.push(makeCandle(baseTime + i * interval, open, high, low, close));
      price = close;
    }

    // Insert a confirmed swing low 8 bars back
    const swingLowIndex = candles.length - 8;
    candles[swingLowIndex] = makeCandle(
      candles[swingLowIndex].time,
      candles[swingLowIndex].open - 5,
      candles[swingLowIndex].open - 3,
      candles[swingLowIndex].open - 12,
      candles[swingLowIndex].open - 4
    );

    // Get current EMA20 on M15
    const emaFast = calculateEMA(candles, 20);
    const currEma = emaFast[emaFast.length - 1].value;

    // Create a textbook bullish rejection bar that touches EMA20 zone and closes strong
    const signalIndex = candles.length;
    const sigOpen = currEma + 2.0;
    const sigLow = currEma - 0.5; // reaches EMA zone
    const sigClose = currEma + 3.0; // strong close
    const sigHigh = sigClose + 0.5;
    const signalCandle = makeCandle(baseTime + signalIndex * interval, sigOpen, sigHigh, sigLow, sigClose);
    candles.push(signalCandle);

    // Run strategy backtest with adjusted periods matching the fixture dataset size
    const customParams = {
      ...DEFAULT_STRATEGY_A_PARAMS,
      h1FastEmaPeriod: 10,
      h1SlowEmaPeriod: 25,
      m15FastEmaPeriod: 20,
      m15SlowEmaPeriod: 50,
      requireH1Structure: false,
      requireM15EmaFilter: false,
      riskRewardRatio: 2.0,
      minStopLossPips: 5.0,
      stopLossBufferPips: 2.0,
    };

    // Now append entry and resolution bar that hits TP
    const entryIndex = signalIndex + 1;
    const tpCandle = makeCandle(
      baseTime + entryIndex * interval,
      sigClose,
      sigClose + 60.0, // Surpasses take profit
      sigClose - 0.5,
      sigClose + 55.0
    );
    candles.push(tpCandle);

    const result = runStrategyABacktest(candles, null, customParams, 'XAUUSDm');

    assert.ok(result.trades.length > 0, 'Should trigger at least 1 trade');
    const trade = result.trades[result.trades.length - 1];

    assert.equal(trade.direction, 'BUY');
    assert.equal(trade.status, 'WIN');
    assert.equal(trade.exitReason, 'TP');
    assert.ok(trade.realizedR >= 1.9, `Realized R should be approx 2.0R, got ${trade.realizedR}`);
    assert.ok(trade.exitPrice !== null && trade.exitPrice >= trade.entryPrice);
  });

  it('should conservatively resolve simultaneous SL & TP hit to STOP LOSS (zero optimistic bias)', () => {
    const candles: Candle[] = [];
    const baseTime = 1700000000;
    const interval = 900;

    let price = 2000.0;
    for (let i = 0; i < 260; i++) {
      const open = price;
      const close = price + 0.5;
      candles.push(makeCandle(baseTime + i * interval, open, close + 0.3, open - 0.2, close));
      price = close;
    }

    // Insert a confirmed swing low 8 bars back
    const swingLowIndex = candles.length - 8;
    candles[swingLowIndex] = makeCandle(
      candles[swingLowIndex].time,
      candles[swingLowIndex].open - 5,
      candles[swingLowIndex].open - 3,
      candles[swingLowIndex].open - 12,
      candles[swingLowIndex].open - 4
    );

    const emaFast = calculateEMA(candles, 20);
    const currEma = emaFast[emaFast.length - 1].value;

    // Signal bar
    const signalIndex = candles.length;
    const sigOpen = currEma + 2.0;
    const sigLow = currEma - 0.5;
    const sigClose = currEma + 3.0;
    const sigHigh = sigClose + 0.5;
    const sigCandle = makeCandle(baseTime + signalIndex * interval, sigOpen, sigHigh, sigLow, sigClose);
    candles.push(sigCandle);

    // Simultaneous wild bar: touches both SL (low below 1800) and TP (high above 2300)
    const entryIndex = signalIndex + 1;
    const wildCandle = makeCandle(
      baseTime + entryIndex * interval,
      sigClose,
      2300.0, // High far above TP
      1800.0, // Low far below SL
      2000.0
    );
    candles.push(wildCandle);

    const customParams = {
      ...DEFAULT_STRATEGY_A_PARAMS,
      h1FastEmaPeriod: 10,
      h1SlowEmaPeriod: 25,
      m15FastEmaPeriod: 20,
      m15SlowEmaPeriod: 50,
      requireH1Structure: false,
      requireM15EmaFilter: false,
      allowMultiplePositions: true,
      riskRewardRatio: 2.0,
      minStopLossPips: 5.0,
      stopLossBufferPips: 2.0,
    };

    const result = runStrategyABacktest(candles, null, customParams, 'XAUUSDm');
    assert.ok(result.trades.length > 0, 'Should trigger at least 1 trade');
    const simultaneousTrade = result.trades.find((t) => t.simultaneousTouchResolvedToSL);
    assert.ok(simultaneousTrade, 'Should have resolved simultaneous touch to SL');
    assert.equal(simultaneousTrade.status, 'LOSS');
    assert.equal(simultaneousTrade.exitReason, 'SL');
    assert.ok(simultaneousTrade.realizedR <= -0.9, 'Realized R should be -1.0R');
  });

  it('should safely handle empty candle datasets and single-bar datasets', () => {
    const emptyResult = runBacktest([], DEFAULT_STRATEGY_PARAMS, 'EUR/USD', '15m');
    assert.equal(emptyResult.totalTrades, 0);
    assert.equal(emptyResult.winRate, 0);
    assert.equal(emptyResult.profitFactor, 0);
    assert.equal(emptyResult.netR, 0);

    const singleCandle = [makeCandle(1700000000, 1.1, 1.11, 1.09, 1.105)];
    const singleResult = runBacktest(singleCandle, DEFAULT_STRATEGY_PARAMS, 'EUR/USD', '15m');
    assert.equal(singleResult.totalTrades, 0);
    assert.equal(singleResult.winRate, 0);
  });

  it('should invalidate cache key when accountBalance or trailingStop settings change', () => {
    const key1 = getBacktestCacheKey('hash123', 'EUR/USD', '15m', {
      ...DEFAULT_STRATEGY_PARAMS,
      accountBalance: 10000,
    });
    const key2 = getBacktestCacheKey('hash123', 'EUR/USD', '15m', {
      ...DEFAULT_STRATEGY_PARAMS,
      accountBalance: 25000,
    });
    assert.notEqual(key1, key2, 'Changing account balance must produce a different cache key');

    const keyEma1 = getBacktestCacheKey('hash123', 'EUR/USD', '15m', {
      ...DEFAULT_STRATEGY_PARAMS,
      strategyType: 'ema_pullback',
      useTrailingStop: false,
    });
    const keyEma2 = getBacktestCacheKey('hash123', 'EUR/USD', '15m', {
      ...DEFAULT_STRATEGY_PARAMS,
      strategyType: 'ema_pullback',
      useTrailingStop: true,
    });
    assert.notEqual(keyEma1, keyEma2, 'Changing trailing stop setting must produce a different cache key');
  });
});
