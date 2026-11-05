import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Candle } from '../types/trading';
import {
  calculateEMA,
  calculateSequentialEMA,
  calculateSequentialEMAMap,
  calculateATR,
  calculateSequentialATR,
  calculateATRPoints,
  calculateSequentialATRMap,
  enrichCandlesWithIndicators,
} from '../services/indicators';
import {
  getLatestClosedH1Index,
  getLatestCompletedH1Candle,
  synchronizeM15WithH1,
  assertNoLookahead,
} from '../services/multiTimeframeSync';
import {
  sanitizeAndSortCandles,
  loadHistoricalDataset,
  HISTORICAL_WARMUP_REQUIREMENTS,
} from '../services/historicalDataLoader';

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

describe('Phase 1: Sequential EMA Calculations & Historical Invariance', () => {
  it('should match independently hand-calculated EMA values exactly', () => {
    // 10 candles with known closes
    // Closes: 100, 102, 104, 106, 108, 110, 112, 114, 116, 118
    const candles: Candle[] = [];
    for (let i = 0; i < 10; i++) {
      const price = 100 + i * 2;
      candles.push(makeCandle(1700000000 + i * 900, price, price + 1, price - 1, price));
    }

    const period = 5;
    // Multiplier = 2 / (5 + 1) = 2/6 = 1/3
    // Bar 0..4 SMA = (100 + 102 + 104 + 106 + 108) / 5 = 104.0
    // Bar 5: 110 * (1/3) + 104.0 * (2/3) = 106.0
    // Bar 6: 112 * (1/3) + 106.0 * (2/3) = 108.0
    // Bar 7: 114 * (1/3) + 108.0 * (2/3) = 110.0
    // Bar 8: 116 * (1/3) + 110.0 * (2/3) = 112.0
    // Bar 9: 118 * (1/3) + 112.0 * (2/3) = 114.0
    const expected = [null, null, null, null, 104.0, 106.0, 108.0, 110.0, 112.0, 114.0];

    const sequential = calculateSequentialEMA(candles, period);
    assert.equal(sequential.length, 10);

    for (let i = 0; i < 10; i++) {
      assert.equal(
        sequential[i],
        expected[i],
        `Index ${i} expected ${expected[i]}, got ${sequential[i]}`
      );
    }

    // Chart IndicatorPoint format
    const points = calculateEMA(candles, period);
    assert.equal(points.length, 6);
    assert.equal(points[0].value, 104.0);
    assert.equal(points[1].value, 106.0);
    assert.equal(points[5].value, 114.0);
  });

  it('should ensure EMA values remain strictly identical when future candles are appended', () => {
    // Generate 100 base candles
    const baseCandles: Candle[] = [];
    let price = 2000;
    for (let i = 0; i < 100; i++) {
      baseCandles.push(makeCandle(1700000000 + i * 900, price, price + 2, price - 2, price + 0.5));
      price += (i % 3 === 0 ? 1 : -0.5);
    }

    // Compute EMA on 80 candles
    const prefix = baseCandles.slice(0, 80);
    const emaPrefix = calculateSequentialEMA(prefix, 20);

    // Compute EMA on all 100 candles (future 20 candles appended)
    const emaFull = calculateSequentialEMA(baseCandles, 20);

    // Historical values 0..79 must be 100% BITWISE IDENTICAL
    for (let i = 0; i < 80; i++) {
      assert.equal(
        emaFull[i],
        emaPrefix[i],
        `Historical EMA at index ${i} changed when future candles were appended!`
      );
    }
  });

  it('should provide EMA 200 only after sufficient warm-up and remain stable across deep history', () => {
    // 150 candles: EMA 200 must be unavailable (all null)
    const shortCandles: Candle[] = [];
    for (let i = 0; i < 150; i++) {
      shortCandles.push(makeCandle(1700000000 + i * 3600, 2000, 2005, 1995, 2001));
    }
    const emaShort = calculateSequentialEMA(shortCandles, 200);
    assert.ok(emaShort.every((val) => val === null));

    // 1000 candles: EMA 200 must be available from index 199 onwards
    const deepCandles: Candle[] = [];
    let p = 2000;
    for (let i = 0; i < 1000; i++) {
      deepCandles.push(makeCandle(1700000000 + i * 3600, p, p + 5, p - 5, p + 1));
      p += 0.2;
    }
    const emaDeep = calculateSequentialEMA(deepCandles, 200);
    assert.equal(emaDeep[198], null);
    assert.ok(typeof emaDeep[199] === 'number');
    assert.ok(typeof emaDeep[999] === 'number');

    // All candles from 199 to 999 must have finite, valid numbers
    for (let i = 199; i < 1000; i++) {
      assert.ok(Number.isFinite(emaDeep[i]));
    }
  });
});

describe('Phase 1: Sequential ATR Calculations & Wilder Smoothing', () => {
  it('should calculate True Range and Wilder smoothing matching hand-calculated reference', () => {
    // 5 known candles
    // Candle 0: H=105, L=95, C=100. TR0 = 10
    // Candle 1: H=110, L=98, C=108. TR1 = max(12, 10, 2) = 12
    // Candle 2: H=112, L=104, C=106. TR2 = max(8, 4, 4) = 8
    // Candle 3: H=115, L=103, C=114. TR3 = max(12, 9, 3) = 12
    // Candle 4: H=118, L=110, C=115. TR4 = max(8, 4, 4) = 8
    const candles: Candle[] = [
      makeCandle(1700000000, 100, 105, 95, 100),
      makeCandle(1700000900, 100, 110, 98, 108),
      makeCandle(1700001800, 108, 112, 104, 106),
      makeCandle(1700002700, 106, 115, 103, 114),
      makeCandle(1700003600, 114, 118, 110, 115),
    ];

    const period = 3;
    // Initial SMA of TR for first 3 bars: (10 + 12 + 8) / 3 = 10.0
    // Bar 3: (10.0 * 2 + 12) / 3 = 32 / 3 = 10.66667
    // Bar 4: (10.666667 * 2 + 8) / 3 = 29.333333 / 3 = 9.77778
    const expected = [null, null, 10.0, 10.66667, 9.77778];

    const sequential = calculateSequentialATR(candles, period);
    assert.equal(sequential.length, 5);

    for (let i = 0; i < 5; i++) {
      assert.equal(
        sequential[i],
        expected[i],
        `ATR at index ${i} expected ${expected[i]}, got ${sequential[i]}`
      );
    }

    // Chart IndicatorPoints
    const points = calculateATRPoints(candles, period);
    assert.equal(points.length, 3);
    assert.equal(points[0].value, 10.0);
    assert.equal(points[1].value, 10.66667);
    assert.equal(points[2].value, 9.77778);
  });

  it('should ensure ATR values do not change when future candles are appended', () => {
    const candles: Candle[] = [];
    let price = 2000;
    for (let i = 0; i < 50; i++) {
      candles.push(makeCandle(1700000000 + i * 900, price, price + 3, price - 3, price + 1));
      price += 0.5;
    }

    const atrShort = calculateSequentialATR(candles.slice(0, 30), 14);
    const atrFull = calculateSequentialATR(candles, 14);

    for (let i = 0; i < 30; i++) {
      assert.equal(atrFull[i], atrShort[i], `Historical ATR changed at index ${i}!`);
    }
  });
});

describe('Phase 1: Multi-Timeframe Synchronization & Zero Lookahead', () => {
  it('should guarantee each M15 candle only accesses completed H1 candles', () => {
    // Hour 0: [1700000000, 1700003600) -> Closes at 1700003600
    // Hour 1: [1700003600, 1700007200) -> Closes at 1700007200
    const h1Candles: Candle[] = [
      makeCandle(1700000000, 2000, 2010, 1990, 2005),
      makeCandle(1700003600, 2005, 2015, 2000, 2010),
    ];

    // M15 Bar 0: 1700000000 (ends 1700000900) -> Hour 0 is NOT closed!
    assert.equal(getLatestClosedH1Index(1700000000, h1Candles), -1);

    // M15 Bar 1: 1700000900 (ends 1700001800) -> Hour 0 is NOT closed!
    assert.equal(getLatestClosedH1Index(1700000900, h1Candles), -1);

    // M15 Bar 2: 1700001800 (ends 1700002700) -> Hour 0 is NOT closed!
    assert.equal(getLatestClosedH1Index(1700001800, h1Candles), -1);

    // M15 Bar 3: 1700002700 (ends 1700003600) -> Hour 0 finishes exactly at this close!
    assert.equal(getLatestClosedH1Index(1700002700, h1Candles), 0);
    const completedAtHour0End = getLatestCompletedH1Candle(1700002700, h1Candles);
    assert.equal(completedAtHour0End?.time, 1700000000);

    // M15 Bar 4: 1700003600 (ends 1700004500) -> Hour 0 is completed, Hour 1 is forming
    assert.equal(getLatestClosedH1Index(1700003600, h1Candles), 0);

    // M15 Bar 7: 1700006300 (ends 1700007200) -> Hour 1 finishes at this close!
    assert.equal(getLatestClosedH1Index(1700006300, h1Candles), 1);
  });

  it('should handle weekend gaps and holiday closures without future leakage', () => {
    // Friday 21:00 UTC (closes at 22:00 UTC)
    const fridayCloseTime = 1700000000;
    // Sunday 22:00 UTC (48-hour weekend gap)
    const sundayOpenTime = 1700000000 + 48 * 3600;

    const h1Candles: Candle[] = [
      makeCandle(fridayCloseTime - 3600, 2000, 2010, 1995, 2005), // Friday 20:00-21:00
      makeCandle(fridayCloseTime, 2005, 2012, 2002, 2008),        // Friday 21:00-22:00 (closes at Friday 22:00)
      makeCandle(sundayOpenTime, 2008, 2015, 2005, 2012),         // Sunday 22:00-23:00 (closes at Sunday 23:00)
    ];

    // Sunday first M15 bar: starts at Sunday 22:00 (ends at 22:15)
    // The Sunday H1 candle is still forming!
    // The latest completed H1 MUST be Friday 21:00 candle (index 1)!
    const closedH1Idx = getLatestClosedH1Index(sundayOpenTime, h1Candles);
    assert.equal(closedH1Idx, 1);
    assert.equal(h1Candles[closedH1Idx].time, fridayCloseTime);

    // Verify assertion helper
    assertNoLookahead(sundayOpenTime, h1Candles[closedH1Idx]);
  });

  it('should synchronize full M15 candle series with completed H1 bars with zero lookahead flag', () => {
    const h1Candles: Candle[] = [];
    for (let h = 0; h < 10; h++) {
      h1Candles.push(makeCandle(1700000000 + h * 3600, 2000 + h, 2005 + h, 1995 + h, 2002 + h));
    }

    const m15Candles: Candle[] = [];
    for (let m = 0; m < 40; m++) {
      m15Candles.push(makeCandle(1700000000 + m * 900, 2000, 2005, 1995, 2001));
    }

    const synced = synchronizeM15WithH1(m15Candles, h1Candles);
    assert.equal(synced.length, 40);

    for (const bar of synced) {
      assert.ok(bar.isLookaheadFree);
      if (bar.completedH1) {
        assert.ok(bar.completedH1.time + 3600 <= bar.m15.time + 900);
      }
    }
  });
});

describe('Phase 1: Historical Data Sanitization & Dataset Loader', () => {
  it('should safely filter out corrupt quotes, deduplicate timestamps, and sort out-of-order candles', () => {
    const rawCandles: Candle[] = [
      makeCandle(1700001800, 2005, 2010, 2000, 2008), // Bar 2
      makeCandle(1700000900, 2002, 2008, 1998, 2005), // Bar 1
      makeCandle(1700000000, 2000, 2005, 1995, 2002), // Bar 0
      makeCandle(1700000900, 2002, 2008, 1998, 2005), // Duplicate of Bar 1
      makeCandle(1700002700, 2008, 2000, 2010, 2005), // Inverted: High < Low!
      makeCandle(1700003600, -2000, 2005, 1995, 2002), // Negative open!
      makeCandle(1700004500, 2010, 2015, 2008, 2012), // Bar 5
    ];

    const sanitized = sanitizeAndSortCandles(rawCandles);
    assert.equal(sanitized.length, 4);

    // Verify strict ascending order
    assert.equal(sanitized[0].time, 1700000000);
    assert.equal(sanitized[1].time, 1700000900);
    assert.equal(sanitized[2].time, 1700001800);
    assert.equal(sanitized[3].time, 1700004500);

    // Verify all bars have valid high >= low
    for (const c of sanitized) {
      assert.ok(c.high >= c.low);
      assert.ok(c.high >= Math.max(c.open, c.close));
      assert.ok(c.low <= Math.min(c.open, c.close));
      assert.ok(c.open > 0 && c.close > 0);
    }
  });

  it('should load historical dataset with warm-up bars, pre-computed EMAs, and safe evaluation start index', async () => {
    const result = await loadHistoricalDataset({
      symbol: 'XAUUSDm',
      mode: 'DEMO',
      h1Bars: 1000,
      m15Bars: 2500,
    });

    assert.ok(result.success);
    assert.ok(result.dataset);

    const ds = result.dataset;
    assert.equal(ds.h1Candles.length, 1000);
    assert.equal(ds.m15Candles.length, 2500);

    // Both H1 and M15 must have pre-calculated sequential indicators
    assert.ok(ds.h1Ema50Map.size > 0);
    assert.ok(ds.h1Ema200Map.size > 0);
    assert.ok(ds.h1Atr14Map.size > 0);

    assert.ok(ds.m15Ema50Map.size > 0);
    assert.ok(ds.m15Ema200Map.size > 0);
    assert.ok(ds.m15Atr14Map.size > 0);

    // Evaluation start index must guarantee that EMA 200 is already active and stabilized
    assert.ok(ds.evaluationStartIndex >= 200);
    const evalM15Candle = ds.m15Candles[ds.evaluationStartIndex];
    assert.ok(ds.m15Ema200Map.has(evalM15Candle.time));
  });
});
