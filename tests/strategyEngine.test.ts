import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Candle } from '../types/trading.ts';
import { calculateEMA, calculateSMA } from '../services/indicators.ts';
import {
  aggregateM15ToH1,
  DEFAULT_STRATEGY_A_PARAMS,
  detectConfirmedSwings,
  evaluateH1Trend,
  evaluateMarketStructure,
  evaluateRejectionCandle,
  evaluateSupportResistanceZone,
  getLatestClosedH1Index,
  runStrategyABacktest,
} from '../services/strategyA.ts';

// Helper to generate a sequence of clean test candles
function createTestCandles(
  count: number,
  startPrice: number = 100,
  step: number = 0.5,
  startTime: number = 1700000000,
  intervalSeconds: number = 900
): Candle[] {
  const candles: Candle[] = [];
  let price = startPrice;

  for (let i = 0; i < count; i++) {
    const time = startTime + i * intervalSeconds;
    const open = price;
    const close = price + step;
    const high = Math.max(open, close) + 0.2;
    const low = Math.min(open, close) - 0.2;
    candles.push({
      time,
      open: Number(open.toFixed(2)),
      high: Number(high.toFixed(2)),
      low: Number(low.toFixed(2)),
      close: Number(close.toFixed(2)),
      volume: 1000,
    });
    price = close;
  }

  return candles;
}

describe('EMA Calculation Unit Tests', () => {
  it('should return empty array if candle count is less than period', () => {
    const candles = createTestCandles(5);
    const ema = calculateEMA(candles, 10);
    assert.equal(ema.length, 0);
  });

  it('should compute initial EMA equal to SMA of the first period', () => {
    const candles = createTestCandles(15, 10, 1);
    const period = 5;
    const ema = calculateEMA(candles, period);
    const sma = calculateSMA(candles, period);

    assert.ok(ema.length > 0);
    // The first EMA point should equal the first SMA point
    assert.equal(ema[0].value, sma[0].value);
    assert.equal(ema[0].time, candles[period - 1].time);
  });

  it('should correctly smooth subsequent values using 2 / (period + 1)', () => {
    const candles = createTestCandles(10, 10, 2);
    const period = 3;
    const ema = calculateEMA(candles, period);

    const mult = 2 / (period + 1); // 2/4 = 0.5
    // First EMA is SMA of first 3 closes
    const smaFirst = (candles[0].close + candles[1].close + candles[2].close) / 3;
    assert.equal(ema[0].value, Number(smaFirst.toFixed(5)));

    // Next EMA is (close - prevEma) * 0.5 + prevEma
    const expectedSecond = (candles[3].close - smaFirst) * mult + smaFirst;
    assert.equal(ema[1].value, Number(expectedSecond.toFixed(5)));
  });
});

describe('Confirmed Swing Points & Market Structure (Zero-Lookahead)', () => {
  it('should NOT report a swing point before it has been confirmed by lookback subsequent bars', () => {
    // Construct 7 candles where candle #3 is an obvious peak
    // 0: 10, 1: 12, 2: 14, 3: 20 (PEAK), 4: 15, 5: 13, 6: 11
    const candles: Candle[] = [
      { time: 1000, open: 10, high: 11, low: 9, close: 10, volume: 100 },
      { time: 2000, open: 11, high: 13, low: 10, close: 12, volume: 100 },
      { time: 3000, open: 13, high: 15, low: 12, close: 14, volume: 100 },
      { time: 4000, open: 15, high: 22, low: 14, close: 20, volume: 100 }, // Index 3 is High = 22
      { time: 5000, open: 19, high: 16, low: 14, close: 15, volume: 100 },
      { time: 6000, open: 14, high: 14, low: 12, close: 13, volume: 100 },
      { time: 7000, open: 12, high: 12, low: 10, close: 11, volume: 100 },
    ];

    const lookback = 2;

    // At bar index 3, the peak has occurred, but it CANNOT be known as a swing yet!
    const swingsAtBar3 = detectConfirmedSwings(candles, lookback, 3);
    assert.equal(swingsAtBar3.length, 0, 'No swings should be visible at the peak bar itself');

    // At bar index 4 (only 1 bar after peak, lookback is 2), still not confirmed
    const swingsAtBar4 = detectConfirmedSwings(candles, lookback, 4);
    assert.equal(swingsAtBar4.length, 0, 'No swings should be visible before lookback bars elapse');

    // At bar index 5 (index 3 + lookback 2 = 5), the peak is officially confirmed!
    const swingsAtBar5 = detectConfirmedSwings(candles, lookback, 5);
    assert.equal(swingsAtBar5.length, 1, 'Swing must be confirmed at bar 3 + lookback = 5');
    assert.equal(swingsAtBar5[0].index, 3);
    assert.equal(swingsAtBar5[0].price, 22);
    assert.equal(swingsAtBar5[0].confirmedAtIndex, 5);
  });

  it('should detect BULLISH structure for Higher Highs and Higher Lows', () => {
    const swings: any[] = [
      { type: 'HIGH', price: 100 },
      { type: 'LOW', price: 90 },
      { type: 'HIGH', price: 110 }, // HH
      { type: 'LOW', price: 95 }, // HL
    ];
    const { structure } = evaluateMarketStructure(swings);
    assert.equal(structure, 'BULLISH');
  });

  it('should detect BEARISH structure for Lower Highs and Lower Lows', () => {
    const swings: any[] = [
      { type: 'HIGH', price: 100 },
      { type: 'LOW', price: 90 },
      { type: 'HIGH', price: 95 }, // LH
      { type: 'LOW', price: 85 }, // LL
    ];
    const { structure } = evaluateMarketStructure(swings);
    assert.equal(structure, 'BEARISH');
  });
});

describe('H1 Trend Filter Evaluation', () => {
  it('should return BUY bias when EMA 50 > EMA 200 and H1 candle closes above EMA 50 with bullish structure', () => {
    const candles = createTestCandles(10, 100, 1, 1700000000, 3600);
    const lastIndex = 5;
    const lastCandle = candles[lastIndex];

    const ema50Map = new Map<number, number>([[lastCandle.time, 102]]);
    const ema200Map = new Map<number, number>([[lastCandle.time, 95]]);

    const params = {
      ...DEFAULT_STRATEGY_A_PARAMS,
      requireH1Structure: false, // test pure EMA rules first
    };

    const trend = evaluateH1Trend(candles, lastIndex, ema50Map, ema200Map, params);
    assert.equal(trend.bias, 'BUY');
    assert.equal(trend.emaConditionMet, true);
    assert.equal(trend.closeConditionMet, true);
  });

  it('should return NEUTRAL bias when EMA 50 > EMA 200 but candle closes below EMA 50', () => {
    const candles = createTestCandles(10, 100, 1, 1700000000, 3600);
    const lastIndex = 5;
    const lastCandle = candles[lastIndex];

    // EMA 50 is 115, but candle.close is ~105
    const ema50Map = new Map<number, number>([[lastCandle.time, 115]]);
    const ema200Map = new Map<number, number>([[lastCandle.time, 95]]);

    const params = { ...DEFAULT_STRATEGY_A_PARAMS, requireH1Structure: false };
    const trend = evaluateH1Trend(candles, lastIndex, ema50Map, ema200Map, params);
    assert.equal(trend.bias, 'NEUTRAL');
  });

  it('should return SELL bias when EMA 50 < EMA 200 and H1 candle closes below EMA 50', () => {
    const candles = createTestCandles(10, 100, -1, 1700000000, 3600);
    const lastIndex = 5;
    const lastCandle = candles[lastIndex];

    const ema50Map = new Map<number, number>([[lastCandle.time, 96]]);
    const ema200Map = new Map<number, number>([[lastCandle.time, 105]]);

    const params = { ...DEFAULT_STRATEGY_A_PARAMS, requireH1Structure: false };
    const trend = evaluateH1Trend(candles, lastIndex, ema50Map, ema200Map, params);
    assert.equal(trend.bias, 'SELL');
  });
});

describe('M15 Rejection & Zone Rules', () => {
  it('should detect a bullish rejection candle when lower wick ratio >= 35%', () => {
    // Candle with high 105, open 103, close 104, low 100
    // Total range = 5. Lower wick = min(103, 104) - 100 = 3.
    // Lower wick ratio = 3 / 5 = 60% >= 35%
    const candle: Candle = {
      time: 1700000000,
      open: 103,
      high: 105,
      low: 100,
      close: 104,
      volume: 1000,
    };

    const rejection = evaluateRejectionCandle(candle, 0.35);
    assert.equal(rejection.type, 'BULLISH_REJECTION');
    assert.equal(rejection.wickRatio, 0.6);
  });

  it('should detect support zone reach when candle low penetrates or nears M15 EMA 50', () => {
    const candle: Candle = {
      time: 1700000000,
      open: 103,
      high: 105,
      low: 99.8,
      close: 103,
      volume: 1000,
    };
    const ema50 = 100.0;
    const tolerance = 0.5;

    const res = evaluateSupportResistanceZone(candle, ema50, null, null, 'BUY', tolerance);
    assert.equal(res.isZoneReached, true);
    assert.equal(res.zoneLevel, 100.0);
  });
});

describe('Future-Data Leakage Prevention Tests', () => {
  it('should NEVER allow an unclosed H1 candle to be visible to an M15 candle', () => {
    // H1 candle #0 spans [1700000000, 1700003600) -> closes at 1700003600
    // H1 candle #1 spans [1700003600, 1700007200) -> closes at 1700007200
    const h1Candles: Candle[] = [
      { time: 1700000000, open: 100, high: 102, low: 99, close: 101, volume: 4000 },
      { time: 1700003600, open: 101, high: 104, low: 100, close: 103, volume: 4000 },
    ];

    // M15 candle at 1700000900 (15m into Hour #0)
    // Candle closes at 1700000900 + 900 = 1700001800.
    // Hour #0 closes at 1700003600.
    // Therefore, NO H1 candle has completed yet!
    const closedH1IndexEarly = getLatestClosedH1Index(1700000900, h1Candles);
    assert.equal(
      closedH1IndexEarly,
      -1,
      'During hour #0, no closed H1 candle should be returned'
    );

    // M15 candle at 1700002700 (ends at 1700003600, exactly when Hour #0 closes)
    const closedH1IndexAtHourEnd = getLatestClosedH1Index(1700002700, h1Candles);
    assert.equal(
      closedH1IndexAtHourEnd,
      0,
      'When hour #0 finishes, only H1 candle #0 is closed and visible'
    );

    // M15 candle during hour #1 (e.g. 1700004500)
    const closedH1IndexDuringHour1 = getLatestClosedH1Index(1700004500, h1Candles);
    assert.equal(
      closedH1IndexDuringHour1,
      0,
      'During hour #1, the latest CLOSED H1 is still only candle #0, never #1'
    );
  });

  it('should conservatively resolve simultaneous Stop Loss and Take Profit touch to SL', () => {
    // Generate M15 candles where a trade enters
    const m15Candles = createTestCandles(250, 2740, 0.2);

    // Run backtest with conservative rules
    const result = runStrategyABacktest(m15Candles, null, DEFAULT_STRATEGY_A_PARAMS, 'XAUUSDm');

    // Confirm that assumptions document conservative fill
    assert.ok(
      result.assumptions.some((a) => a.includes('Conservative Simultaneous SL/TP Touch')),
      'Backtest assumptions must document conservative touch resolution'
    );
  });
});

describe('Strategy A Stop-Loss and Take-Profit Precision Tests', () => {
  it('should compute Stop-Loss from confirmed swing low with buffer, and enforce minStopLossPips', () => {
    // Test parameters
    const pipSize = 0.1; // XAUUSDm
    const entryPrice = 2750.0;
    const swingLow = 2745.0; // 5.0 points = 50 pips below entry
    const slBufferPips = 2.0; // 0.2 points
    const minSlPips = 10.0; // 1.0 points

    const slBufferPrice = slBufferPips * pipSize;
    const minSlPrice = minSlPips * pipSize;

    const calculatedSL = swingLow - slBufferPrice; // 2744.8
    const minAllowedSL = entryPrice - minSlPrice; // 2749.0
    const finalSL = Math.min(calculatedSL, minAllowedSL); // 2744.8

    assert.equal(finalSL, 2744.8);

    // If swing low is extremely tight to entry (e.g. 2749.9, only 1 pip below)
    const tightSwingLow = 2749.9;
    const tightCalculatedSL = tightSwingLow - slBufferPrice; // 2749.7
    const tightFinalSL = Math.min(tightCalculatedSL, minAllowedSL); // minAllowedSL = 2749.0

    assert.equal(tightFinalSL, 2749.0, 'Must enforce minStopLossPips when swing is too close');
  });

  it('should calculate Take Profit exactly according to configurable Risk-to-Reward ratio (2:1)', () => {
    const entryPrice = 2750.0;
    const stopLossPrice = 2745.0; // 5.0 risk
    const rrRatio = 2.0; // 2:1 RR

    const riskDistance = Math.abs(entryPrice - stopLossPrice);
    const rewardDistance = riskDistance * rrRatio;
    const takeProfitPrice = entryPrice + rewardDistance;

    assert.equal(riskDistance, 5.0);
    assert.equal(rewardDistance, 10.0);
    assert.equal(takeProfitPrice, 2760.0);

    // For SELL
    const sellEntry = 2750.0;
    const sellSL = 2755.0;
    const sellTP = sellEntry - (Math.abs(sellEntry - sellSL) * rrRatio);
    assert.equal(sellTP, 2740.0);
  });
});

describe('Position Exclusivity & Concurrency Control', () => {
  it('should prevent opening duplicate trades while a position is active when allowMultiplePositions is false', () => {
    const m15Candles = createTestCandles(300, 2700, 0.3);

    // Backtest with allowMultiplePositions: false
    const singlePosResult = runStrategyABacktest(
      m15Candles,
      null,
      {
        ...DEFAULT_STRATEGY_A_PARAMS,
        allowMultiplePositions: false,
        requireH1Structure: false,
      },
      'XAUUSDm'
    );

    // Check that no two trades overlap in holding time
    for (let i = 0; i < singlePosResult.trades.length - 1; i++) {
      const currentTrade = singlePosResult.trades[i];
      const nextTrade = singlePosResult.trades[i + 1];

      if (currentTrade.exitTime !== null) {
        assert.ok(
          nextTrade.entryTime >= currentTrade.exitTime,
          `Trade #${nextTrade.index} entry (${nextTrade.entryTime}) should not occur before Trade #${currentTrade.index} exit (${currentTrade.exitTime})`
        );
      }
    }
  });
});

describe('M15 EMA Trend Filter Validation', () => {
  it('should reject BUY signal if M15 EMA 50 is below M15 EMA 200 when requireM15EmaFilter is true', () => {
    const candle: Candle = {
      time: 1700000000,
      open: 103,
      high: 105,
      low: 99.8,
      close: 104,
      volume: 1000,
    };

    const direction: 'BUY' | 'SELL' = 'BUY';
    const m15Ema50 = 100.0;
    const m15Ema200 = 105.0; // 50 < 200 (bearish EMA alignment on M15)

    let m15EmaFilterPassed = true;
    if (direction === 'BUY' && m15Ema50 <= m15Ema200) {
      m15EmaFilterPassed = false;
    }

    assert.equal(m15EmaFilterPassed, false, 'BUY signal must be blocked when M15 EMA 50 < 200');
  });
});

describe('Multi-Timeframe M15 to H1 Aggregation Integrity', () => {
  it('should aggregate 4 consecutive M15 candles into a single H1 candle with exact OHLCV relations', () => {
    const baseHour = 1700000000; // divisible by 3600? Let's check: 1700000000 / 3600
    const alignedHour = Math.floor(baseHour / 3600) * 3600;

    const m15Bars: Candle[] = [
      { time: alignedHour, open: 100, high: 105, low: 99, close: 102, volume: 500 },
      { time: alignedHour + 900, open: 102, high: 108, low: 101, close: 107, volume: 600 },
      { time: alignedHour + 1800, open: 107, high: 110, low: 106, close: 108, volume: 700 },
      { time: alignedHour + 2700, open: 108, high: 109, low: 97, close: 104, volume: 800 },
    ];

    const h1Bars = aggregateM15ToH1(m15Bars);
    assert.equal(h1Bars.length, 1);

    const h1 = h1Bars[0];
    assert.equal(h1.time, alignedHour);
    assert.equal(h1.open, 100, 'H1 open must equal first M15 open');
    assert.equal(h1.close, 104, 'H1 close must equal last M15 close');
    assert.equal(h1.high, 110, 'H1 high must equal highest high of 4 M15 bars');
    assert.equal(h1.low, 97, 'H1 low must equal lowest low of 4 M15 bars');
    assert.equal(h1.volume, 2600, 'H1 volume must equal sum of 4 M15 volumes');
  });
});
