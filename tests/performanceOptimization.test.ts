import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Candle, Trade } from '../types/trading';
import {
  aggregateM1ToTimeframe,
  createTimeframeAggregator,
  getBucketStartTimestamp,
  getOrComputeDerivedTimeframe,
} from '../services/timeframeAggregator';
import {
  clearM1Database,
  isWeekendMarketClosed,
  saveCanonicalM1Candles,
  streamCanonicalM1Candles,
} from '../services/m1Database';
import { runBacktest, DEFAULT_STRATEGY_PARAMS } from '../services/backtestEngine';
import { runBacktestInWorker } from '../services/workerManager';
import {
  binarySearchByTime,
  MAX_CHART_CANDLES,
  selectChartCandleWindow,
} from '../services/chartWindow';

function buildSyntheticM1(startSec: number, count: number, stepSec: number = 60): Candle[] {
  const out: Candle[] = new Array(count);
  let price = 2000;
  for (let i = 0; i < count; i++) {
    const open = price;
    const delta = ((i % 7) - 3) * 0.25;
    const close = open + delta;
    const high = Math.max(open, close) + 0.5;
    const low = Math.min(open, close) - 0.5;
    out[i] = {
      time: startSec + i * stepSec,
      open,
      high,
      low,
      close,
      volume: 10 + (i % 5),
    };
    price = close;
  }
  return out;
}

describe('Performance Optimization: Streaming M1 Aggregation & DB', () => {
  it('streams chunks identically to full-array aggregation across timeframes', () => {
    // Start on Thursday 2024-10-10 00:00 UTC and span across weekend into Monday
    const startSec = Math.floor(Date.parse('2024-10-10T00:00:00Z') / 1000);
    const allM1 = buildSyntheticM1(startSec, 7200); // 5 days = 7,200 M1 bars

    const timeframes = ['5m', '15m', '30m', '1h', '4h', '1D', '1W'] as const;
    for (const tf of timeframes) {
      const fullAgg = aggregateM1ToTimeframe(allM1, tf, false);

      const streamed = createTimeframeAggregator(tf, false);
      for (let i = 0; i < allM1.length; i += 333) {
        streamed.pushBatch(allM1.slice(i, i + 333));
      }
      const streamedAgg = streamed.finalize();

      assert.deepEqual(streamedAgg, fullAgg, `Mismatch for timeframe ${tf}`);
    }
  });

  it('handles out-of-order M1 candles without constituent array allocations', () => {
    const startSec = Math.floor(Date.parse('2024-10-14T10:00:00Z') / 1000);
    const ordered = buildSyntheticM1(startSec, 30);
    // Reverse order to trigger out-of-order fallback
    const reversed = [...ordered].reverse();

    const aggOrdered = aggregateM1ToTimeframe(ordered, '15m', false);
    const aggReversed = aggregateM1ToTimeframe(reversed, '15m', false);

    assert.deepEqual(aggReversed, aggOrdered);
  });

  it('aggregates 750,000+ M1 bars (2+ years) in streaming chunks rapidly', () => {
    const startSec = Math.floor(Date.parse('2023-01-02T00:00:00Z') / 1000);
    const totalBars = 750_000;
    const chunkSize = 10_000;

    const aggregator = createTimeframeAggregator('15m', false);
    const t0 = performance.now();

    let price = 1900;
    for (let offset = 0; offset < totalBars; offset += chunkSize) {
      const len = Math.min(chunkSize, totalBars - offset);
      const chunk: Candle[] = new Array(len);
      for (let i = 0; i < len; i++) {
        const idx = offset + i;
        const open = price;
        const close = open + ((idx % 5) - 2) * 0.1;
        chunk[i] = {
          time: startSec + idx * 60,
          open,
          high: Math.max(open, close) + 0.2,
          low: Math.min(open, close) - 0.2,
          close,
          volume: 100,
        };
        price = close;
      }
      aggregator.pushBatch(chunk);
    }

    const result = aggregator.finalize();
    const elapsedMs = performance.now() - t0;

    assert.equal(result.length, 50_000);
    assert.ok(elapsedMs < 3000, `Expected 750k M1 streaming aggregation < 3000ms, got ${elapsedMs}ms`);
  });

  it('matches integer weekend closure & weekly bucket calculations to UTC Date logic', () => {
    const startSec = Math.floor(Date.parse('2024-10-11T18:00:00Z') / 1000); // Friday 18:00 UTC
    for (let i = 0; i < 72; i++) {
      const ts = startSec + i * 3600;
      const d = new Date(ts * 1000);
      const day = d.getUTCDay();
      const hour = d.getUTCHours();
      const expectedClosed = (day === 5 && hour >= 22) || day === 6 || (day === 0 && hour < 21);
      assert.equal(isWeekendMarketClosed(ts), expectedClosed, `Mismatch at ${d.toISOString()}`);

      // Verify weekly bucket is always Monday 00:00 UTC
      const weekBucket = getBucketStartTimestamp(ts, '1W');
      assert.equal(new Date(weekBucket * 1000).getUTCDay(), 1);
      assert.equal(weekBucket % 86400, 0);
    }
  });

  it('streams canonical M1 chunks in getOrComputeDerivedTimeframe', async () => {
    await clearM1Database('xauusd');
    const startSec = Math.floor(Date.parse('2024-10-14T00:00:00Z') / 1000);
    const m1 = buildSyntheticM1(startSec, 3600); // 60 hours = 3,600 M1 bars

    await saveCanonicalM1Candles('xauusd', m1, 'Dukascopy');

    let chunkCount = 0;
    let streamedTotal = 0;
    await streamCanonicalM1Candles(
      'xauusd',
      startSec,
      startSec + 3600 * 60,
      (chunk) => {
        chunkCount++;
        streamedTotal += chunk.length;
      },
      1000
    );

    assert.equal(chunkCount, 4);
    assert.equal(streamedTotal, 3600);

    const derived = await getOrComputeDerivedTimeframe('xauusd', '1h', startSec, startSec + 3600 * 60);
    const direct = aggregateM1ToTimeframe(m1, '1h', false);
    assert.equal(derived.length, direct.length);
    assert.equal(derived[0].open, direct[0].open);
    assert.equal(derived[derived.length - 1].close, direct[direct.length - 1].close);

    await clearM1Database('xauusd');
  });
});

describe('Performance Optimization: Chart Windowing & Full-Period Backtest', () => {
  it('caps chart display candles to MAX_CHART_CANDLES while preserving full dataset', () => {
    const startSec = Math.floor(Date.parse('2022-01-03T00:00:00Z') / 1000);
    const totalCandles = 25_000;
    const fullCandles = buildSyntheticM1(startSec, totalCandles, 900);

    // Default tail window
    const tailWindow = selectChartCandleWindow(fullCandles, null, MAX_CHART_CANDLES);
    assert.equal(tailWindow.displayCandles.length, MAX_CHART_CANDLES);
    assert.equal(tailWindow.startIndex, totalCandles - MAX_CHART_CANDLES);
    assert.equal(tailWindow.endIndex, totalCandles);
    assert.equal(fullCandles.length, totalCandles); // Original dataset untouched

    // Selecting an early trade centers window around it
    const earlyTrade = {
      id: 't-early',
      entryTime: fullCandles[500].time,
    } as Trade;
    const centeredWindow = selectChartCandleWindow(fullCandles, earlyTrade, MAX_CHART_CANDLES);
    assert.equal(centeredWindow.displayCandles.length, MAX_CHART_CANDLES);
    assert.equal(centeredWindow.startIndex, 0);
    assert.ok(binarySearchByTime(centeredWindow.displayCandles, earlyTrade.entryTime) !== null);
  });

  it('runs backtests across all historical candles even when exceeding chart render cap', async () => {
    // Create 12,000 M15 candles (> MAX_CHART_CANDLES = 8,000) with synthetic swings
    const startSec = Math.floor(Date.parse('2023-01-02T00:00:00Z') / 1000);
    const totalBars = 12_000;
    const candles: Candle[] = new Array(totalBars);
    let price = 2000;
    for (let i = 0; i < totalBars; i++) {
      const wave = Math.sin(i / 40) * 15 + Math.cos(i / 13) * 5;
      const open = price;
      const close = 2000 + wave;
      const high = Math.max(open, close) + 2;
      const low = Math.min(open, close) - 2;
      candles[i] = {
        time: startSec + i * 900,
        open,
        high,
        low,
        close,
        volume: 1000,
      };
      price = close;
    }

    const params = {
      ...DEFAULT_STRATEGY_PARAMS,
      strategyType: 'smc_fib_4h_v1' as const,
      accountBalance: 100000,
    };

    const syncResult = runBacktest(candles, params, 'XAUUSDm', '15m');
    const workerResult = await runBacktestInWorker(candles, params, 'XAUUSDm', '15m');

    assert.deepEqual(workerResult.netR, syncResult.netR);
    assert.equal(workerResult.totalTrades, syncResult.totalTrades);
    assert.ok(candles.length > MAX_CHART_CANDLES);

    // Ensure chart-truncated subset would NOT match full-period backtest if there are trades in early bars
    const truncatedResult = runBacktest(
      candles.slice(candles.length - MAX_CHART_CANDLES),
      params,
      'XAUUSDm',
      '15m'
    );
    if (syncResult.trades.some((t) => t.entryTime < candles[candles.length - MAX_CHART_CANDLES].time)) {
      assert.notEqual(
        syncResult.totalTrades,
        truncatedResult.totalTrades,
        'Full-period backtest must include early trades beyond chart window'
      );
    }
  });
});
