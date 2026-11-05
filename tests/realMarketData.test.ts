import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Candle, StrategyParameters } from '../types/trading';
import {
  parseTwelveDataTimestamp,
  detectCandleGaps,
  processRawTwelveDataCandles,
} from '../services/realMarketData';
import { DEFAULT_STRATEGY_PARAMS, runBacktest } from '../services/backtestEngine';

describe('Real Market Data - Twelve Data Data Service', () => {
  it('should parse Twelve Data UTC datetime string accurately without timezone skew', () => {
    // 2026-03-15 14:30:00 UTC
    const dt = '2026-03-15 14:30:00';
    const timestamp = parseTwelveDataTimestamp(dt);
    const expected = Math.floor(Date.UTC(2026, 2, 15, 14, 30, 0) / 1000);
    assert.equal(timestamp, expected);
  });

  it('should detect missing data gaps between consecutive bars', () => {
    // 15m intervals = 900 seconds
    const candles: Candle[] = [
      { time: 1700000000, open: 2000, high: 2010, low: 1990, close: 2005, volume: 100 },
      { time: 1700000900, open: 2005, high: 2015, low: 2000, close: 2010, volume: 100 },
      // Gap of 3600 seconds (4 bars missing)
      { time: 1700004500, open: 2010, high: 2020, low: 2008, close: 2015, volume: 100 },
    ];

    const gaps = detectCandleGaps(candles, 900);
    assert.equal(gaps.length, 1);
    assert.equal(gaps[0].expectedTime, 1700001800);
    assert.equal(gaps[0].gapDurationSeconds, 3600);
    assert.equal(gaps[0].missingBarsCount, 3);
  });

  it('should validate, remove duplicates, and sort raw Twelve Data candles ascending', () => {
    // Raw Twelve Data array is typically descending and may contain malformed bars or duplicates
    const rawValues = [
      { datetime: '2026-03-15 15:00:00', open: '2010', high: '2020', low: '2005', close: '2015', volume: '300' },
      // Duplicate of 15:00:00
      { datetime: '2026-03-15 15:00:00', open: '2010', high: '2020', low: '2005', close: '2015', volume: '300' },
      // Malformed bar (high < low)
      { datetime: '2026-03-15 14:45:00', open: '2005', high: '1990', low: '2010', close: '2000', volume: '200' },
      { datetime: '2026-03-15 14:30:00', open: '2000', high: '2010', low: '1995', close: '2005', volume: '100' },
    ];

    const processed = processRawTwelveDataCandles(rawValues, '15m');
    assert.equal(processed.candles.length, 2);
    // Chronologically ascending
    assert.equal(processed.candles[0].open, 2000);
    assert.equal(processed.candles[1].open, 2010);
    assert.ok(processed.candles[0].time < processed.candles[1].time);
  });
});

describe('Real Backtesting Engine - Transaction Costs & Monthly Breakdown', () => {
  it('should incorporate spread, commission, and slippage into net simulated performance', () => {
    // Create deterministic sequence of 60 bars for backtest execution
    const candles: Candle[] = [];
    let price = 2000;
    const startTime = 1700000000;

    for (let i = 0; i < 70; i++) {
      const time = startTime + i * 900;
      candles.push({
        time,
        open: price,
        high: price + 4,
        low: price - 3,
        close: price + 1,
        volume: 500,
      });
      price += 0.5;
    }

    const paramsWithCosts: StrategyParameters = {
      ...DEFAULT_STRATEGY_PARAMS,
      spreadPips: 2.0,
      slippagePips: 0.5,
      commissionPerLot: 7.0,
    };

    const result = runBacktest(candles, paramsWithCosts, 'XAUUSDm', '15m');

    assert.ok(result);
    assert.equal(result.isGrossSimulated, false);
    assert.ok(result.costModel);
    assert.equal(result.costModel.spreadPips, 2.0);
    assert.equal(result.costModel.commissionPerLot, 7.0);
    assert.equal(result.costModel.slippagePips, 0.5);
    assert.ok(Array.isArray(result.monthlyPerformance));
  });

  it('should safely aggregate monthly performance breakdown for closed trades', () => {
    // Generate 80 candles spanning across two simulated months
    const candles: Candle[] = [];
    // Start Nov 2023
    let time = 1700000000; // Nov 14 2023
    let price = 2000;

    for (let i = 0; i < 80; i++) {
      candles.push({
        time,
        open: price,
        high: price + 5,
        low: price - 4,
        close: price + (i % 2 === 0 ? 3 : -2),
        volume: 1000,
      });
      time += 900;
      price += 1;
    }

    const result = runBacktest(candles, DEFAULT_STRATEGY_PARAMS, 'XAUUSDm', '15m');
    assert.ok(Array.isArray(result.monthlyPerformance));
    for (const month of result.monthlyPerformance) {
      assert.match(month.monthKey, /^\d{4}-\d{2}$/);
      assert.ok(typeof month.tradesCount === 'number');
      assert.ok(typeof month.winRate === 'number');
      assert.ok(typeof month.netR === 'number');
      assert.ok(typeof month.profitCurrency === 'number');
    }
  });
});
