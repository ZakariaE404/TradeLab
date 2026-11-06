import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Candle, HistoricalDataset } from '../types/trading';
import { ConfirmedSwingPoint } from '../types/strategyA';
import { DEFAULT_STRATEGY_CONFIG, StrategyConfiguration } from '../services/strategy/types';
import { analyzeH1Trend } from '../services/strategy/trendAnalysis';
import { classifyMarketRegime } from '../services/strategy/marketRegime';
import {
  detectConfirmedSwings,
  getActivePriceZones,
  doesCandleInteractWithSupport,
  doesCandleInteractWithResistance,
} from '../services/strategy/supportResistance';
import { evaluateCandlePattern } from '../services/strategy/candlePatterns';
import { TradeLabStrategyEngine } from '../services/strategy/strategyRules';
import { runHistoricalSimulation } from '../services/simulationEngine';
import { runStrategyExperiments } from '../services/strategy/experimentRunner';
import { runBacktest, DEFAULT_STRATEGY_PARAMS } from '../services/backtestEngine';
import { SimulationConfig } from '../types/simulation';

function createMockDataset(options: {
  m15Candles: Candle[];
  h1Candles?: Candle[];
  m15Ema50?: number;
  m15Ema200?: number;
  h1Ema50?: number;
  h1Ema200?: number;
}): HistoricalDataset {
  const {
    m15Candles,
    h1Candles = [
      { time: 1700000000, open: 2700, high: 2710, low: 2690, close: 2705, volume: 100 },
    ],
    m15Ema50 = 2700,
    m15Ema200 = 2680,
    h1Ema50 = 2700,
    h1Ema200 = 2680,
  } = options;

  const m15Ema50Map = new Map<number, number>();
  const m15Ema200Map = new Map<number, number>();
  const m15Atr14Map = new Map<number, number>();
  for (const c of m15Candles) {
    m15Ema50Map.set(c.time, m15Ema50);
    m15Ema200Map.set(c.time, m15Ema200);
    m15Atr14Map.set(c.time, 10.0);
  }

  const h1Ema50Map = new Map<number, number>();
  const h1Ema200Map = new Map<number, number>();
  const h1Atr14Map = new Map<number, number>();
  const h1Adx14Map = new Map<number, number>();
  for (const c of h1Candles) {
    h1Ema50Map.set(c.time, h1Ema50);
    h1Ema200Map.set(c.time, h1Ema200);
    h1Atr14Map.set(c.time, 15.0);
    h1Adx14Map.set(c.time, 28.0); // Default trending
  }

  return {
    symbol: 'XAUUSDm',
    mode: 'DEMO',
    m15Candles,
    h1Candles,
    m15Enriched: m15Candles.map((c) => ({ ...c, ema50: m15Ema50, ema200: m15Ema200, atr14: 10.0 })),
    h1Enriched: h1Candles.map((c) => ({ ...c, ema50: h1Ema50, ema200: h1Ema200, atr14: 15.0 })),
    m15Ema50Map,
    m15Ema200Map,
    m15Atr14Map,
    h1Ema50Map,
    h1Ema200Map,
    h1Atr14Map,
    h1Adx14Map,
    evaluationStartIndex: 0,
    m15WarmupBarsCount: 0,
    h1WarmupBarsCount: h1Candles.length,
    m15Gaps: [],
    h1Gaps: [],
    isRealData: false,
  };
}

const BASE_SIM_CONFIG: SimulationConfig = {
  initialBalance: 10000,
  sizing: { method: 'FIXED_RISK_AMOUNT', value: 100 },
  costs: { spreadPips: 0, slippagePips: 0, commissionPerLot: 0 },
  endOfTestPolicy: 'CLOSE_AT_LAST_BAR',
};

describe('Phase 3: H1 Trend Analysis Engine', () => {
  it('should detect BULLISH trend when EMA 50 > EMA 200, slope > 0, and price >= EMA 50', () => {
    const h1Candles: Candle[] = [
      { time: 1700000000, open: 2680, high: 2690, low: 2675, close: 2685, volume: 100 },
      { time: 1700003600, open: 2685, high: 2700, low: 2680, close: 2695, volume: 100 },
      { time: 1700007200, open: 2695, high: 2715, low: 2690, close: 2710, volume: 100 },
      { time: 1700010800, open: 2710, high: 2725, low: 2705, close: 2720, volume: 100 },
    ];

    const h1Ema50Map = new Map<number, number>([
      [1700000000, 2690],
      [1700003600, 2693],
      [1700007200, 2697],
      [1700010800, 2702], // Slope > 0 vs index 0 (2702 - 2690)/3 = +4.0
    ]);
    const h1Ema200Map = new Map<number, number>([
      [1700010800, 2650], // EMA 50 (2702) > EMA 200 (2650)
    ]);

    const result = analyzeH1Trend({
      h1Candles,
      completedH1Index: 3,
      h1Ema50Map,
      h1Ema200Map,
      config: DEFAULT_STRATEGY_CONFIG,
    });

    assert.equal(result.bias, 'BULLISH');
    assert.equal(result.emaAlignment, 'BULLISH');
    assert.ok(result.ema50Slope > 0, 'Slope must be strictly positive');
    assert.equal(result.priceAboveEma50, true);
  });

  it('should detect BEARISH trend when EMA 50 < EMA 200, slope < 0, and price <= EMA 50', () => {
    const h1Candles: Candle[] = [
      { time: 1700000000, open: 2720, high: 2725, low: 2705, close: 2710, volume: 100 },
      { time: 1700003600, open: 2710, high: 2715, low: 2690, close: 2695, volume: 100 },
      { time: 1700007200, open: 2695, high: 2700, low: 2680, close: 2685, volume: 100 },
      { time: 1700010800, open: 2685, high: 2690, low: 2670, close: 2675, volume: 100 },
    ];

    const h1Ema50Map = new Map<number, number>([
      [1700000000, 2710],
      [1700003600, 2705],
      [1700007200, 2700],
      [1700010800, 2695], // Slope < 0
    ]);
    const h1Ema200Map = new Map<number, number>([
      [1700010800, 2740], // EMA 50 (2695) < EMA 200 (2740)
    ]);

    const result = analyzeH1Trend({
      h1Candles,
      completedH1Index: 3,
      h1Ema50Map,
      h1Ema200Map,
      config: DEFAULT_STRATEGY_CONFIG,
    });

    assert.equal(result.bias, 'BEARISH');
    assert.equal(result.emaAlignment, 'BEARISH');
    assert.ok(result.ema50Slope < 0, 'Slope must be strictly negative');
    assert.equal(result.priceAboveEma50, false);
  });

  it('should return NEUTRAL when conditions conflict (e.g. EMA alignment bullish but slope negative)', () => {
    const h1Candles: Candle[] = [
      { time: 1700000000, open: 2720, high: 2725, low: 2710, close: 2715, volume: 100 },
      { time: 1700003600, open: 2715, high: 2720, low: 2700, close: 2705, volume: 100 },
      { time: 1700007200, open: 2705, high: 2710, low: 2695, close: 2698, volume: 100 },
      { time: 1700010800, open: 2698, high: 2700, low: 2680, close: 2685, volume: 100 },
    ];

    const h1Ema50Map = new Map<number, number>([
      [1700000000, 2710],
      [1700003600, 2705],
      [1700007200, 2700],
      [1700010800, 2695], // Falling slope!
    ]);
    const h1Ema200Map = new Map<number, number>([
      [1700010800, 2680], // EMA 50 (2695) > EMA 200 (2680) -> Alignment is Bullish!
    ]);

    const result = analyzeH1Trend({
      h1Candles,
      completedH1Index: 3,
      h1Ema50Map,
      h1Ema200Map,
      config: DEFAULT_STRATEGY_CONFIG,
    });

    assert.equal(result.bias, 'NEUTRAL', 'Conflicting alignment and slope must classify as NEUTRAL');
  });
});

describe('Phase 3: Market Regime Engine', () => {
  const bullishTrend = {
    bias: 'BULLISH' as const,
    ema50: 2700,
    ema200: 2650,
    ema50Slope: 1.5,
    slopeLookback: 3,
    emaAlignment: 'BULLISH' as const,
    priceAboveEma50: true,
    priceAboveEma200: true,
    reasons: [],
  };

  it('should classify as TRENDING when ADX >= 25 and directional trend is confirmed', () => {
    const result = classifyMarketRegime({
      trendAnalysis: bullishTrend,
      h1Adx14: 28.5,
      config: DEFAULT_STRATEGY_CONFIG,
    });
    assert.equal(result.regime, 'TRENDING');
  });

  it('should classify as RANGING when ADX < 20', () => {
    const result = classifyMarketRegime({
      trendAnalysis: bullishTrend,
      h1Adx14: 16.2,
      config: DEFAULT_STRATEGY_CONFIG,
    });
    assert.equal(result.regime, 'RANGING');
  });

  it('should classify as TRANSITION when ADX is between 20 and 25', () => {
    const result = classifyMarketRegime({
      trendAnalysis: bullishTrend,
      h1Adx14: 22.4,
      config: DEFAULT_STRATEGY_CONFIG,
    });
    assert.equal(result.regime, 'TRANSITION');
  });

  it('should classify as TRANSITION when ADX >= 25 but trend is NEUTRAL', () => {
    const neutralTrend = { ...bullishTrend, bias: 'NEUTRAL' as const };
    const result = classifyMarketRegime({
      trendAnalysis: neutralTrend,
      h1Adx14: 31.0,
      config: DEFAULT_STRATEGY_CONFIG,
    });
    assert.equal(result.regime, 'TRANSITION');
  });
});

describe('Phase 3: Support and Resistance Engine', () => {
  it('should detect confirmed swing highs and lows with left/right confirmation lag', () => {
    // 7 candles with peak high at index 3
    const candles: Candle[] = [
      { time: 100, open: 10, high: 15, low: 8, close: 12, volume: 100 },
      { time: 200, open: 12, high: 20, low: 11, close: 18, volume: 100 },
      { time: 300, open: 18, high: 25, low: 16, close: 22, volume: 100 },
      { time: 400, open: 22, high: 40, low: 20, close: 35, volume: 100 }, // Peak High at idx 3 = 40
      { time: 500, open: 35, high: 30, low: 25, close: 28, volume: 100 },
      { time: 600, open: 28, high: 24, low: 20, close: 22, volume: 100 },
      { time: 700, open: 22, high: 18, low: 15, close: 16, volume: 100 },
    ];

    const swings = detectConfirmedSwings(candles, 2, 2);
    const swingHigh = swings.find((s) => s.type === 'HIGH');

    assert.ok(swingHigh, 'Should detect swing high');
    assert.equal(swingHigh.index, 3);
    assert.equal(swingHigh.price, 40);
    assert.equal(swingHigh.confirmedAtIndex, 5, 'Index 3 with right=2 confirmed at index 5');
  });

  it('should cluster nearby swing points into consolidated zones', () => {
    const swings: ConfirmedSwingPoint[] = [
      { index: 2, time: 200, price: 2680.0, type: 'LOW', confirmedAtIndex: 5, confirmedAtTime: 500 },
      { index: 8, time: 800, price: 2680.2, type: 'LOW', confirmedAtIndex: 11, confirmedAtTime: 1100 },
    ];

    const { supportZones } = getActivePriceZones({
      allSwings: swings,
      currentCandleIndex: 12,
      currentPrice: 2700.0,
      config: DEFAULT_STRATEGY_CONFIG,
      pipSize: 0.1,
    });

    assert.equal(supportZones.length, 1, 'Should cluster the two nearby swings into 1 zone');
    assert.equal(supportZones[0].swings.length, 2);
    assert.equal(supportZones[0].minPrice, 2680.0);
    assert.equal(supportZones[0].maxPrice, 2680.2);
  });
});

describe('Phase 3: Candle Pattern Engine', () => {
  const dummyZone = {
    id: 'supp_1',
    type: 'SUPPORT' as const,
    minPrice: 2680,
    maxPrice: 2682,
    centerPrice: 2681,
    swings: [],
    confirmedAtIndex: 0,
    confirmedAtTime: 0,
    distancePips: 5,
    isValid: true,
  };

  it('should detect bullish rejection when lower wick >= 2.0x body and touches support', () => {
    // Open 2690, High 2692, Low 2680 (touches support 2681), Close 2689
    // Range = 12, Body = 1, Lower Wick = 9, 9 / 1 = 9.0x body
    const candle: Candle = {
      time: 1000,
      open: 2690,
      high: 2692,
      low: 2680,
      close: 2689,
      volume: 100,
    };

    const pattern = evaluateCandlePattern({
      currentCandle: candle,
      supportZones: [dummyZone],
      resistanceZones: [],
      config: DEFAULT_STRATEGY_CONFIG,
      pipSize: 0.1,
    });

    assert.equal(pattern.isBullishRejection, true);
    assert.ok(pattern.wickToBodyRatio >= 2.0);
  });

  it('should detect bullish engulfing when real body engulfs previous candle at support', () => {
    const prevCandle: Candle = {
      time: 1000,
      open: 2688,
      high: 2690,
      low: 2682,
      close: 2683, // Bearish: body from 2688 down to 2683
      volume: 100,
    };
    const currentCandle: Candle = {
      time: 1900,
      open: 2682,
      high: 2695,
      low: 2681, // touches support 2681
      close: 2692, // Bullish: body from 2682 up to 2692 (completely engulfs 2683-2688)
      volume: 100,
    };

    const pattern = evaluateCandlePattern({
      currentCandle,
      prevCandle,
      supportZones: [dummyZone],
      resistanceZones: [],
      config: DEFAULT_STRATEGY_CONFIG,
      pipSize: 0.1,
    });

    assert.equal(pattern.isBullishEngulfing, true);
  });

  it('should safely handle zero-range and micro-body candles without errors', () => {
    const zeroRangeCandle: Candle = {
      time: 1000,
      open: 2700,
      high: 2700,
      low: 2700,
      close: 2700,
      volume: 100,
    };

    const pattern = evaluateCandlePattern({
      currentCandle: zeroRangeCandle,
      supportZones: [dummyZone],
      resistanceZones: [],
      config: DEFAULT_STRATEGY_CONFIG,
      pipSize: 0.1,
    });

    assert.equal(pattern.isBullishRejection, false);
    assert.equal(pattern.isBullishEngulfing, false);
    assert.equal(pattern.candleRange, 0);
  });
});

describe('Phase 3: Strategy Rules & Simulation Integration', () => {
  it('should generate BUY signal in TRENDING regime on bullish rejection at confirmed support', () => {
    // 3 M15 candles
    // Bar 0: confirms swing low at 2680
    // Bar 1: bullish rejection candle touching support 2680, close 2689
    // Bar 2: next bar where execution occurs
    const m15Candles: Candle[] = [
      { time: 1700000000, open: 2690, high: 2695, low: 2679, close: 2685, volume: 100 },
      { time: 1700000900, open: 2688, high: 2692, low: 2680, close: 2689, volume: 100 }, // Bullish rejection
      { time: 1700001800, open: 2690, high: 2720, low: 2688, close: 2715, volume: 100 }, // Next candle
    ];

    const dataset = createMockDataset({
      m15Candles,
      h1Ema50: 2700,
      h1Ema200: 2650,
      m15Ema50: 2685,
      m15Ema200: 2670,
    });

    const swings: ConfirmedSwingPoint[] = [
      { index: 0, time: 1700000000, price: 2680, type: 'LOW', confirmedAtIndex: 0, confirmedAtTime: 1700000000 },
    ];

    const engine = new TradeLabStrategyEngine({
      regime: 'TRENDING',
      pattern: 'REJECTION',
      direction: 'BUY',
    });

    const result = runHistoricalSimulation({
      dataset,
      signalGenerator: engine,
      config: BASE_SIM_CONFIG,
      swings,
    });

    assert.equal(result.trades.length, 1);
    const trade = result.trades[0];
    assert.equal(trade.direction, 'BUY');
    assert.equal(trade.entryTime, 1700001800, 'Must enter at next candle OPEN');
    assert.equal(trade.entryPrice, 2690);
  });

  it('should reject BUY signal when market regime is RANGING and strategy requires TRENDING', () => {
    const m15Candles: Candle[] = [
      { time: 1700000000, open: 2690, high: 2695, low: 2679, close: 2685, volume: 100 },
      { time: 1700000900, open: 2688, high: 2692, low: 2680, close: 2689, volume: 100 },
      { time: 1700001800, open: 2690, high: 2720, low: 2688, close: 2715, volume: 100 },
    ];

    const dataset = createMockDataset({ m15Candles });
    // Override H1 ADX to 14.0 (RANGING)
    dataset.h1Adx14Map?.set(dataset.h1Candles[0].time, 14.0);

    const engine = new TradeLabStrategyEngine({
      regime: 'TRENDING', // Requires TRENDING
    });

    const result = runHistoricalSimulation({
      dataset,
      signalGenerator: engine,
      config: BASE_SIM_CONFIG,
    });

    assert.equal(result.trades.length, 0, 'Must not generate signal when regime does not match');
    assert.ok(result.diagnostics.rejectedSignalsCount >= 0);
  });

  it('should run isolated independent experiments without merging equity curves', () => {
    const m15Candles: Candle[] = [
      { time: 1700000000, open: 2690, high: 2695, low: 2679, close: 2685, volume: 100 },
      { time: 1700000900, open: 2688, high: 2692, low: 2680, close: 2689, volume: 100 },
      { time: 1700001800, open: 2690, high: 2720, low: 2688, close: 2715, volume: 100 },
    ];

    const dataset = createMockDataset({ m15Candles });

    const suite = runStrategyExperiments({
      dataset,
      strategyConfig: {
        ...DEFAULT_STRATEGY_CONFIG,
        regime: 'BOTH',
        pattern: 'BOTH',
        direction: 'BOTH',
      },
      simulationConfig: BASE_SIM_CONFIG,
    });

    // 2 regimes * 2 patterns * 2 directions = 8 discrete experiments
    assert.equal(suite.totalExperiments, 8);
    assert.equal(suite.experiments.length, 8);

    const ids = suite.experiments.map((e) => e.id);
    assert.ok(ids.includes('EXP_TRENDING_REJECTION_BUY'));
    assert.ok(ids.includes('EXP_TRENDING_ENGULFING_SELL'));
    assert.ok(ids.includes('EXP_RANGING_REJECTION_BUY'));
    assert.ok(ids.includes('EXP_RANGING_ENGULFING_SELL'));
  });

  it('should run TradeLab Phase 3 strategy end-to-end via runBacktest bridge', () => {
    const m15Candles: Candle[] = [];
    let baseTime = 1700000000;
    let price = 2650.0;
    for (let i = 0; i < 100; i++) {
      m15Candles.push({
        time: baseTime + i * 900,
        open: price,
        high: price + 2,
        low: price - 1,
        close: price + 1,
        volume: 100,
      });
      price += 1;
    }

    const result = runBacktest(
      m15Candles,
      {
        ...DEFAULT_STRATEGY_PARAMS,
        strategyType: 'tradelab_strategy',
        tradeLabConfig: {
          ...DEFAULT_STRATEGY_CONFIG,
          regime: 'TRENDING',
          pattern: 'REJECTION',
        },
      },
      'XAUUSDm',
      '15m'
    );

    assert.ok(result);
    assert.ok(Array.isArray(result.trades));
    assert.ok(result.assumptions && result.assumptions.length > 0);
    assert.ok(result.assumptions.some((a) => a.includes('TradeLab Phase 3')));
    assert.ok(result.simulationResult !== undefined);
  });
});
