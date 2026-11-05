import test, { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Candle, HistoricalDataset } from '../types/trading';
import { ConfirmedSwingPoint } from '../types/strategyA';
import {
  ExecutionCostConfig,
  PositionSizingConfig,
  SimulationConfig,
  TradingSignal,
} from '../types/simulation';
import { runHistoricalSimulation } from '../services/simulationEngine';
import { DeterministicTestSignalGenerator } from '../services/signalEngine';
import { calculateAtrStopLoss, calculateSwingStopLoss } from '../services/stopLossEngine';
import {
  calculateRiskRewardTakeProfit,
  calculateSupportResistanceTakeProfit,
} from '../services/takeProfitEngine';
import {
  calculateEntryFill,
  calculateExitFill,
  calculateTradeExecutionCosts,
  getInstrumentCostModel,
} from '../services/costEngine';

/**
 * Creates a minimal valid synthetic HistoricalDataset for testing.
 */
function createMockDataset(options: {
  m15Candles: Candle[];
  h1Candles?: Candle[];
  symbol?: 'XAUUSDm' | 'EUR/USD';
  evaluationStartIndex?: number;
}): HistoricalDataset {
  const {
    m15Candles,
    symbol = 'XAUUSDm',
    evaluationStartIndex = 0,
  } = options;

  // Default H1 candles covering the M15 timeframe plus warm-up
  const h1Candles =
    options.h1Candles ||
    Array.from({ length: 1000 }, (_, i) => ({
      time: 1700000000 + i * 3600,
      open: 2700,
      high: 2710,
      low: 2690,
      close: 2700,
      volume: 100,
    }));

  const m15Ema50Map = new Map<number, number>();
  const m15Ema200Map = new Map<number, number>();
  const m15Atr14Map = new Map<number, number>();
  for (const c of m15Candles) {
    m15Ema50Map.set(c.time, 2700);
    m15Ema200Map.set(c.time, 2690);
    m15Atr14Map.set(c.time, 10.0); // 10.0 ATR for testing
  }

  const h1Ema50Map = new Map<number, number>();
  const h1Ema200Map = new Map<number, number>();
  const h1Atr14Map = new Map<number, number>();
  for (const c of h1Candles) {
    h1Ema50Map.set(c.time, 2700);
    h1Ema200Map.set(c.time, 2690);
    h1Atr14Map.set(c.time, 15.0);
  }

  return {
    symbol,
    mode: 'DEMO',
    m15Candles,
    h1Candles,
    m15Enriched: m15Candles.map((c) => ({ ...c, ema50: 2700, ema200: 2690, atr14: 10.0 })),
    h1Enriched: h1Candles.map((c) => ({ ...c, ema50: 2700, ema200: 2690, atr14: 15.0 })),
    m15Ema50Map,
    m15Ema200Map,
    m15Atr14Map,
    h1Ema50Map,
    h1Ema200Map,
    h1Atr14Map,
    evaluationStartIndex,
    m15WarmupBarsCount: evaluationStartIndex,
    h1WarmupBarsCount: h1Candles.length,
    m15Gaps: [],
    h1Gaps: [],
    isRealData: false,
  };
}

const DEFAULT_ZERO_COSTS: ExecutionCostConfig = {
  spreadPips: 0,
  slippagePips: 0,
  commissionPerLot: 0,
};

const DEFAULT_TEST_SIZING: PositionSizingConfig = {
  method: 'FIXED_RISK_AMOUNT',
  value: 100, // $100 risk per trade
};

const BASE_TEST_CONFIG: SimulationConfig = {
  initialBalance: 10000,
  sizing: DEFAULT_TEST_SIZING,
  costs: DEFAULT_ZERO_COSTS,
  endOfTestPolicy: 'CLOSE_AT_LAST_BAR',
  minStopLossPips: 5.0,
};

describe('Phase 2: Entry Execution & Timing', () => {
  it('should execute BUY at NEXT candle OPEN (never confirmation candle close)', () => {
    // Bar 0: Signal candle, closes at 2705
    // Bar 1: Next candle, opens at 2712, highs to 2730
    const m15Candles: Candle[] = [
      { time: 1700000000, open: 2700, high: 2710, low: 2695, close: 2705, volume: 100 },
      { time: 1700000900, open: 2712, high: 2735, low: 2710, close: 2730, volume: 100 },
    ];

    const dataset = createMockDataset({ m15Candles });
    const signalGenerator = new DeterministicTestSignalGenerator([
      {
        barIndex: 0,
        signal: {
          direction: 'BUY',
          proposedStopLoss: { method: 'ATR', atrMultiplier: 1.0 },
          proposedTakeProfit: { method: 'RR', riskRewardRatio: 2.0 },
        },
      },
    ]);

    const result = runHistoricalSimulation({
      dataset,
      signalGenerator,
      config: BASE_TEST_CONFIG,
    });

    assert.equal(result.trades.length, 1);
    const trade = result.trades[0];
    assert.equal(trade.direction, 'BUY');
    assert.equal(trade.entryTime, 1700000900, 'Entry timestamp must be bar 1 open timestamp');
    assert.equal(trade.entryIndex, 1, 'Entry index must be 1, not 0');
    assert.equal(trade.entryPrice, 2712, 'Entry price must be Bar 1 OPEN (2712), NOT Bar 0 CLOSE (2705)');
  });

  it('should execute SELL at NEXT candle OPEN (never confirmation candle close)', () => {
    const m15Candles: Candle[] = [
      { time: 1700000000, open: 2720, high: 2725, low: 2700, close: 2702, volume: 100 },
      { time: 1700000900, open: 2698, high: 2700, low: 2670, close: 2675, volume: 100 },
    ];

    const dataset = createMockDataset({ m15Candles });
    const signalGenerator = new DeterministicTestSignalGenerator([
      {
        barIndex: 0,
        signal: {
          direction: 'SELL',
          proposedStopLoss: { method: 'ATR', atrMultiplier: 1.0 },
          proposedTakeProfit: { method: 'RR', riskRewardRatio: 2.0 },
        },
      },
    ]);

    const result = runHistoricalSimulation({
      dataset,
      signalGenerator,
      config: BASE_TEST_CONFIG,
    });

    assert.equal(result.trades.length, 1);
    const trade = result.trades[0];
    assert.equal(trade.direction, 'SELL');
    assert.equal(trade.entryTime, 1700000900);
    assert.equal(trade.entryPrice, 2698, 'SELL entry must be Bar 1 OPEN (2698), not Bar 0 CLOSE (2702)');
  });

  it('should correctly ignore signals on the final bar when no next candle exists', () => {
    // Only 1 candle in dataset
    const m15Candles: Candle[] = [
      { time: 1700000000, open: 2700, high: 2710, low: 2695, close: 2705, volume: 100 },
    ];

    const dataset = createMockDataset({ m15Candles });
    const signalGenerator = new DeterministicTestSignalGenerator([
      {
        barIndex: 0,
        signal: {
          direction: 'BUY',
        },
      },
    ]);

    const result = runHistoricalSimulation({
      dataset,
      signalGenerator,
      config: BASE_TEST_CONFIG,
    });

    assert.equal(result.trades.length, 0, 'No trade should be executed because there is no next candle');
    assert.equal(result.diagnostics.unexecutedFinalBarSignalsCount, 1);
    assert.ok(result.diagnostics.warnings.some((w) => w.includes('cannot be executed')));
  });
});

describe('Phase 2: Execution Costs & Pricing Math', () => {
  const goldModel = getInstrumentCostModel('XAUUSDm'); // pipSize = 0.1, contractSize = 100

  it('should compute entry fill with spread and slippage without double charging', () => {
    const costs: ExecutionCostConfig = {
      spreadPips: 2.0, // 2.0 pips * 0.1 = 0.20 price spread (half = 0.10)
      slippagePips: 0.5, // 0.5 pips * 0.1 = 0.05 price slippage
      commissionPerLot: 7.0,
    };

    const buyFill = calculateEntryFill('BUY', 2700.0, costs, goldModel);
    // Ask = 2700.00 + 0.10 (half spread) + 0.05 (slippage) = 2700.15
    assert.equal(buyFill.executionPrice, 2700.15);

    const sellFill = calculateEntryFill('SELL', 2700.0, costs, goldModel);
    // Bid = 2700.00 - 0.10 (half spread) - 0.05 (slippage) = 2699.85
    assert.equal(sellFill.executionPrice, 2699.85);
  });

  it('should compute exit fill with spread and slippage', () => {
    const costs: ExecutionCostConfig = {
      spreadPips: 2.0, // halfSpreadPrice = 0.10
      slippagePips: 0.5, // slippagePrice = 0.05
      commissionPerLot: 7.0,
    };

    // BUY exit is Selling at Bid: 2720.00 - 0.10 - 0.05 = 2719.85
    const buyExitFill = calculateExitFill('BUY', 2720.0, costs, goldModel);
    assert.equal(buyExitFill.executionPrice, 2719.85);

    // SELL exit is Buying at Ask: 2680.00 + 0.10 + 0.05 = 2680.15
    const sellExitFill = calculateExitFill('SELL', 2680.0, costs, goldModel);
    assert.equal(sellExitFill.executionPrice, 2680.15);
  });

  it('should calculate complete trade execution costs matching gross vs net PnL', () => {
    const costs: ExecutionCostConfig = {
      spreadPips: 2.0, // $0.20 per unit
      slippagePips: 1.0, // $0.10 per side = $0.20 round trip
      commissionPerLot: 10.0, // $10 per 100 units = $0.10 per unit
    };

    const positionUnits = 100; // 1.0 standard lot of Gold
    const positionLots = 1.0;

    const breakdown = calculateTradeExecutionCosts(positionUnits, positionLots, costs, goldModel);
    assert.equal(breakdown.spreadCost, 20.0); // 0.20 * 100 = $20.00
    assert.equal(breakdown.slippageCost, 20.0); // (2 * 0.10) * 100 = $20.00
    assert.equal(breakdown.commissionCost, 10.0); // 1.0 lot * $10 = $10.00
    assert.equal(breakdown.totalExecutionCosts, 50.0); // Total $50.00
  });

  it('should deduct execution costs from trade net PnL and account balance', () => {
    // Bar 0: BUY signal
    // Bar 1: opens 2700, runs to 2730 (hits TP)
    const m15Candles: Candle[] = [
      { time: 1700000000, open: 2690, high: 2702, low: 2688, close: 2700, volume: 100 },
      { time: 1700000900, open: 2700, high: 2725, low: 2695, close: 2722, volume: 100 },
    ];

    const dataset = createMockDataset({ m15Candles });
    const signalGenerator = new DeterministicTestSignalGenerator([
      {
        barIndex: 0,
        signal: {
          direction: 'BUY',
          proposedStopLoss: { method: 'ATR', atrMultiplier: 1.0 }, // Entry 2700.15, ATR 10 -> SL 2690.15 (risk = $10.00)
          proposedTakeProfit: { method: 'RR', riskRewardRatio: 2.0 }, // TP = 2700.15 + 20.0 = 2720.15
        },
      },
    ]);

    const costsConfig: SimulationConfig = {
      ...BASE_TEST_CONFIG,
      costs: {
        spreadPips: 2.0,
        slippagePips: 0.5,
        commissionPerLot: 7.0,
      },
    };

    const result = runHistoricalSimulation({
      dataset,
      signalGenerator,
      config: costsConfig,
    });

    assert.equal(result.trades.length, 1);
    const trade = result.trades[0];
    assert.equal(trade.status, 'WIN');
    assert.ok(trade.totalExecutionCosts > 0, 'Total execution costs must be greater than zero');
    assert.equal(trade.netPnl, Number((trade.grossPnl - trade.totalExecutionCosts).toFixed(2)));
    assert.equal(
      result.performance.totalNetPnl,
      Number((result.performance.totalGrossPnl - result.performance.totalExecutionCosts).toFixed(2))
    );
  });
});

describe('Phase 2: Stop Loss Engine', () => {
  it('should calculate swing-based SL below confirmed swing low for BUY with safety buffer', () => {
    const swings: ConfirmedSwingPoint[] = [
      {
        index: 5,
        time: 1700005000,
        price: 2685.5,
        type: 'LOW',
        confirmedAtIndex: 8,
        confirmedAtTime: 1700008000,
      },
    ];

    const slResult = calculateSwingStopLoss({
      direction: 'BUY',
      entryPrice: 2700.0,
      swings,
      signalCandleIndex: 10, // Swings confirmed at index 8 are visible!
      bufferPips: 2.0, // 2.0 pips * 0.1 = 0.20
      pipSize: 0.1,
      digits: 2,
      minStopLossPips: 5.0,
    });

    // 2685.50 - 0.20 buffer = 2685.30
    assert.equal(slResult.stopLossPrice, 2685.3);
    assert.equal(slResult.distancePips, 147.0); // (2700 - 2685.3) / 0.1 = 147.0
  });

  it('should ignore unconfirmed future swing points for SL calculation', () => {
    const swings: ConfirmedSwingPoint[] = [
      {
        index: 5,
        time: 1700005000,
        price: 2680.0,
        type: 'LOW',
        confirmedAtIndex: 8, // Confirmed at 8
        confirmedAtTime: 1700008000,
      },
      {
        index: 9,
        time: 1700009000,
        price: 2692.0,
        type: 'LOW',
        confirmedAtIndex: 12, // NOT confirmed at signal index 10!
        confirmedAtTime: 1700012000,
      },
    ];

    const slResult = calculateSwingStopLoss({
      direction: 'BUY',
      entryPrice: 2700.0,
      swings,
      signalCandleIndex: 10,
      bufferPips: 2.0,
      pipSize: 0.1,
      digits: 2,
    });

    // Swing at index 9 was confirmed at 12, so only swing at index 5 (price 2680.0) is visible!
    assert.equal(slResult.stopLossPrice, 2679.8); // 2680.0 - 0.20
  });

  it('should calculate ATR-based SL for BUY and SELL with multipliers 1.0, 1.5, 2.0', () => {
    const buySl1 = calculateAtrStopLoss({
      direction: 'BUY',
      entryPrice: 2700.0,
      atrValue: 10.0,
      multiplier: 1.0,
      pipSize: 0.1,
      digits: 2,
    });
    assert.equal(buySl1.stopLossPrice, 2690.0);

    const buySl15 = calculateAtrStopLoss({
      direction: 'BUY',
      entryPrice: 2700.0,
      atrValue: 10.0,
      multiplier: 1.5,
      pipSize: 0.1,
      digits: 2,
    });
    assert.equal(buySl15.stopLossPrice, 2685.0);

    const sellSl2 = calculateAtrStopLoss({
      direction: 'SELL',
      entryPrice: 2700.0,
      atrValue: 10.0,
      multiplier: 2.0,
      pipSize: 0.1,
      digits: 2,
    });
    assert.equal(sellSl2.stopLossPrice, 2720.0);
  });
});

describe('Phase 2: Take Profit Engine', () => {
  it('should calculate Risk/Reward TP accurately for 1:1, 1:1.5, 1:2', () => {
    // BUY entry = 2700, SL = 2690 -> Risk distance = 10.0
    const tp1 = calculateRiskRewardTakeProfit({
      direction: 'BUY',
      entryPrice: 2700.0,
      stopLossPrice: 2690.0,
      ratio: 1.0,
      pipSize: 0.1,
      digits: 2,
    });
    assert.equal(tp1.takeProfitPrice, 2710.0);

    const tp15 = calculateRiskRewardTakeProfit({
      direction: 'BUY',
      entryPrice: 2700.0,
      stopLossPrice: 2690.0,
      ratio: 1.5,
      pipSize: 0.1,
      digits: 2,
    });
    assert.equal(tp15.takeProfitPrice, 2715.0);

    const tp2 = calculateRiskRewardTakeProfit({
      direction: 'SELL',
      entryPrice: 2700.0,
      stopLossPrice: 2710.0,
      ratio: 2.0,
      pipSize: 0.1,
      digits: 2,
    });
    assert.equal(tp2.takeProfitPrice, 2680.0);
  });

  it('should calculate Support/Resistance TP and reject targets on the wrong side of entry', () => {
    // BUY targeting resistance at 2725.0
    const srBuy = calculateSupportResistanceTakeProfit({
      direction: 'BUY',
      entryPrice: 2700.0,
      targetZonePrice: 2725.0,
      stopLossPrice: 2690.0,
      pipSize: 0.1,
      digits: 2,
    });
    assert.equal(srBuy.takeProfitPrice, 2725.0);
    assert.equal(srBuy.effectiveRiskRewardRatio, 2.5); // 25 / 10 = 2.5

    // BUY targeting resistance BELOW entry must throw
    assert.throws(
      () =>
        calculateSupportResistanceTakeProfit({
          direction: 'BUY',
          entryPrice: 2700.0,
          targetZonePrice: 2695.0, // below entry!
          stopLossPrice: 2690.0,
          pipSize: 0.1,
          digits: 2,
        }),
      /Invalid BUY resistance target/
    );
  });
});

describe('Phase 2: Position Management & Execution Rules', () => {
  it('should execute Take Profit when candle high reaches TP level', () => {
    const m15Candles: Candle[] = [
      { time: 1700000000, open: 2700, high: 2705, low: 2695, close: 2700, volume: 100 },
      // Bar 1: Entry at 2700, SL at 2690, TP at 2720
      { time: 1700000900, open: 2700, high: 2710, low: 2696, close: 2708, volume: 100 },
      // Bar 2: High touches 2722 (reaches TP 2720)
      { time: 1700001800, open: 2708, high: 2722, low: 2705, close: 2718, volume: 100 },
    ];

    const dataset = createMockDataset({ m15Candles });
    const signalGenerator = new DeterministicTestSignalGenerator([
      {
        barIndex: 0,
        signal: {
          direction: 'BUY',
          proposedStopLoss: { method: 'ATR', atrMultiplier: 1.0 }, // SL = 2690
          proposedTakeProfit: { method: 'RR', riskRewardRatio: 2.0 }, // TP = 2720
        },
      },
    ]);

    const result = runHistoricalSimulation({
      dataset,
      signalGenerator,
      config: BASE_TEST_CONFIG,
    });

    assert.equal(result.trades.length, 1);
    const trade = result.trades[0];
    assert.equal(trade.status, 'WIN');
    assert.equal(trade.exitReason, 'TP');
    assert.equal(trade.exitPrice, 2720);
    assert.equal(trade.exitIndex, 2);
    assert.equal(trade.resultInR, 2.0);
  });

  it('should execute Stop Loss when candle low touches SL level', () => {
    const m15Candles: Candle[] = [
      { time: 1700000000, open: 2700, high: 2705, low: 2695, close: 2700, volume: 100 },
      // Bar 1: Entry at 2700, SL at 2690, TP at 2720
      { time: 1700000900, open: 2700, high: 2704, low: 2692, close: 2694, volume: 100 },
      // Bar 2: Low touches 2688 (breaches SL 2690)
      { time: 1700001800, open: 2694, high: 2696, low: 2688, close: 2690, volume: 100 },
    ];

    const dataset = createMockDataset({ m15Candles });
    const signalGenerator = new DeterministicTestSignalGenerator([
      {
        barIndex: 0,
        signal: {
          direction: 'BUY',
          proposedStopLoss: { method: 'ATR', atrMultiplier: 1.0 },
          proposedTakeProfit: { method: 'RR', riskRewardRatio: 2.0 },
        },
      },
    ]);

    const result = runHistoricalSimulation({
      dataset,
      signalGenerator,
      config: BASE_TEST_CONFIG,
    });

    assert.equal(result.trades.length, 1);
    const trade = result.trades[0];
    assert.equal(trade.status, 'LOSS');
    assert.equal(trade.exitReason, 'SL');
    assert.equal(trade.exitPrice, 2690);
    assert.equal(trade.resultInR, -1.0);
  });

  it('should conservatively resolve simultaneous SL & TP touch in the same bar to STOP LOSS', () => {
    const m15Candles: Candle[] = [
      { time: 1700000000, open: 2700, high: 2705, low: 2695, close: 2700, volume: 100 },
      // Bar 1: Entry at 2700, SL at 2690, TP at 2720
      // Bar 1 itself has massive spike: Low 2685 (touches SL), High 2725 (touches TP)
      { time: 1700000900, open: 2700, high: 2725, low: 2685, close: 2710, volume: 100 },
    ];

    const dataset = createMockDataset({ m15Candles });
    const signalGenerator = new DeterministicTestSignalGenerator([
      {
        barIndex: 0,
        signal: {
          direction: 'BUY',
          proposedStopLoss: { method: 'ATR', atrMultiplier: 1.0 },
          proposedTakeProfit: { method: 'RR', riskRewardRatio: 2.0 },
        },
      },
    ]);

    const result = runHistoricalSimulation({
      dataset,
      signalGenerator,
      config: BASE_TEST_CONFIG,
    });

    assert.equal(result.trades.length, 1);
    const trade = result.trades[0];
    assert.equal(trade.status, 'LOSS', 'Must resolve conservatively to LOSS');
    assert.equal(trade.exitReason, 'SL', 'Must resolve to SL');
    assert.equal(trade.simultaneousTouchResolvedToSL, true);
    assert.equal(result.diagnostics.simultaneousTouchCount, 1);
  });

  it('should prevent overlapping positions (position exclusivity)', () => {
    const m15Candles: Candle[] = [
      { time: 1700000000, open: 2700, high: 2705, low: 2695, close: 2700, volume: 100 },
      { time: 1700000900, open: 2700, high: 2706, low: 2696, close: 2702, volume: 100 },
      { time: 1700001800, open: 2702, high: 2708, low: 2698, close: 2704, volume: 100 },
      { time: 1700002700, open: 2704, high: 2725, low: 2700, close: 2722, volume: 100 },
    ];

    const dataset = createMockDataset({ m15Candles });
    // Attempt to trigger a second BUY signal at bar 1 while trade 1 is already active
    const signalGenerator = new DeterministicTestSignalGenerator([
      {
        barIndex: 0,
        signal: { direction: 'BUY' },
      },
      {
        barIndex: 1, // While trade from bar 0 is still active!
        signal: { direction: 'BUY' },
      },
    ]);

    const result = runHistoricalSimulation({
      dataset,
      signalGenerator,
      config: BASE_TEST_CONFIG,
    });

    assert.equal(result.trades.length, 1, 'Only 1 position should be open at any time');
    assert.equal(result.diagnostics.rejectedSignalsCount, 1, 'Duplicate overlapping signal must be rejected');
  });

  it('should handle open position at end of backtest according to configured policy', () => {
    // 3 candles where trade is opened at bar 1 and never hits SL or TP before backtest ends
    const m15Candles: Candle[] = [
      { time: 1700000000, open: 2700, high: 2705, low: 2695, close: 2700, volume: 100 },
      { time: 1700000900, open: 2700, high: 2705, low: 2695, close: 2702, volume: 100 },
      { time: 1700001800, open: 2702, high: 2706, low: 2698, close: 2705, volume: 100 },
    ];

    const dataset = createMockDataset({ m15Candles });
    const signalGenerator = new DeterministicTestSignalGenerator([
      { barIndex: 0, signal: { direction: 'BUY' } },
    ]);

    // Policy A: CLOSE_AT_LAST_BAR
    const resultClose = runHistoricalSimulation({
      dataset,
      signalGenerator,
      config: { ...BASE_TEST_CONFIG, endOfTestPolicy: 'CLOSE_AT_LAST_BAR' },
    });
    assert.equal(resultClose.trades.length, 1);
    assert.equal(resultClose.trades[0].exitReason, 'END_OF_TEST');
    assert.equal(resultClose.trades[0].exitPrice, 2705); // Closed at last bar close

    // Policy B: LEAVE_OPEN
    const resultLeaveOpen = runHistoricalSimulation({
      dataset,
      signalGenerator,
      config: { ...BASE_TEST_CONFIG, endOfTestPolicy: 'LEAVE_OPEN' },
    });
    assert.equal(resultLeaveOpen.trades.length, 1);
    assert.equal(resultLeaveOpen.trades[0].status, 'OPEN');
    assert.equal(resultLeaveOpen.trades[0].exitReason, 'OPEN');
    assert.equal(resultLeaveOpen.trades[0].exitTime, null);
    assert.equal(resultLeaveOpen.diagnostics.openTradesAtEndCount, 1);
  });
});

describe('Phase 2: Warm-up Validation & Zero Lookahead', () => {
  it('should flag REDUCED_CONFIDENCE when H1 warmup is between 300 and 1000 bars', () => {
    const m15Candles: Candle[] = [
      { time: 1700000000, open: 2700, high: 2705, low: 2695, close: 2700, volume: 100 },
      { time: 1700000900, open: 2700, high: 2705, low: 2695, close: 2700, volume: 100 },
    ];

    // Only 400 H1 bars (minimum 300 met, but below 1000 target)
    const h1Candles = Array.from({ length: 400 }, (_, i) => ({
      time: 1700000000 - (400 - i) * 3600,
      open: 2700,
      high: 2710,
      low: 2690,
      close: 2700,
      volume: 100,
    }));

    const dataset = createMockDataset({ m15Candles, h1Candles });
    const signalGenerator = new DeterministicTestSignalGenerator([]);

    const result = runHistoricalSimulation({
      dataset,
      signalGenerator,
      config: BASE_TEST_CONFIG,
    });

    assert.equal(result.diagnostics.warmUpConfidence, 'REDUCED_CONFIDENCE');
    assert.ok(result.diagnostics.warnings.some((w) => w.includes('reduced statistical confidence')));
  });

  it('should flag INSUFFICIENT when H1 warmup is below 300 bars', () => {
    const m15Candles: Candle[] = [
      { time: 1700000000, open: 2700, high: 2705, low: 2695, close: 2700, volume: 100 },
      { time: 1700000900, open: 2700, high: 2705, low: 2695, close: 2700, volume: 100 },
    ];

    const h1Candles = Array.from({ length: 250 }, (_, i) => ({
      time: 1700000000 - (250 - i) * 3600,
      open: 2700,
      high: 2710,
      low: 2690,
      close: 2700,
      volume: 100,
    }));

    const dataset = createMockDataset({ m15Candles, h1Candles });
    const signalGenerator = new DeterministicTestSignalGenerator([]);

    const result = runHistoricalSimulation({
      dataset,
      signalGenerator,
      config: BASE_TEST_CONFIG,
    });

    assert.equal(result.diagnostics.warmUpConfidence, 'INSUFFICIENT');
    assert.ok(result.diagnostics.warnings.some((w) => w.includes('Insufficient H1 warm-up history')));
  });
});
