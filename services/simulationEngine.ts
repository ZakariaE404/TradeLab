import { Candle, HistoricalDataset } from '@/types/trading';
import { ConfirmedSwingPoint } from '@/types/strategyA';
import {
  EquitySnapshot,
  InstrumentCostModel,
  SignalEvaluationContext,
  SignalGenerator,
  SimulationConfig,
  SimulationDiagnostics,
  SimulationPerformanceMetrics,
  SimulationResult,
  SimulationTradeRecord,
  TradingSignal,
  WarmUpConfidence,
} from '@/types/simulation';
import {
  evaluateActiveTradeOnCandle,
  executeOpenTrade,
  finalizeOpenTradeAtEndOfTest,
  calculateUnrealizedPnL,
} from './executionEngine';
import { getInstrumentCostModel, SIMULATION_ASSUMPTIONS } from './costEngine';
import { assertNoLookahead, getLatestClosedH1Index } from './multiTimeframeSync';
import { validateSignal } from './signalEngine';
import { HISTORICAL_WARMUP_REQUIREMENTS } from './historicalDataLoader';

export interface RunHistoricalSimulationParams {
  dataset: HistoricalDataset;
  signalGenerator: SignalGenerator;
  config: SimulationConfig;
  swings?: ConfirmedSwingPoint[];
}

/**
 * Rebuilt Historical Simulation Engine.
 * - Processes historical M15 candles chronologically starting at evaluationStartIndex.
 * - Strictly accesses only completed H1 candles available at each evaluation time (zero lookahead).
 * - Executes trades at the next M15 candle OPEN with realistic spread, slippage, and commission.
 * - Enforces position exclusivity (one open position, no overlapping positions).
 * - Implements conservative intrabar simultaneous SL/TP resolution (SL first).
 * - Handles end-of-test open positions according to configured policy.
 * - Generates full equity curve, performance metrics, and diagnostic validation.
 */
export function runHistoricalSimulation(
  params: RunHistoricalSimulationParams
): SimulationResult {
  const { dataset, signalGenerator, config, swings = [] } = params;
  const { m15Candles, h1Candles, symbol } = dataset;

  const warnings: string[] = [];
  const instrument: InstrumentCostModel = getInstrumentCostModel(symbol);

  if (!instrument.isKnownInstrument) {
    warnings.push(
      `Instrument ${symbol} does not have registered metadata in FOREX_SYMBOLS. Using safe defaults (contract size: 100,000, pip size: 0.0001).`
    );
  }

  // 1. Warm-up Validation
  let warmUpConfidence: WarmUpConfidence = 'STABILIZED';
  const h1Count = h1Candles.length;

  if (h1Count < HISTORICAL_WARMUP_REQUIREMENTS.MIN_H1_WARMUP_BARS) {
    warmUpConfidence = 'INSUFFICIENT';
    warnings.push(
      `Insufficient H1 warm-up history (${h1Count} bars). Required minimum: ${HISTORICAL_WARMUP_REQUIREMENTS.MIN_H1_WARMUP_BARS} bars.`
    );
  } else if (h1Count < HISTORICAL_WARMUP_REQUIREMENTS.TARGET_H1_WARMUP_BARS) {
    warmUpConfidence = 'REDUCED_CONFIDENCE';
    warnings.push(
      `H1 warm-up (${h1Count} bars) is below the recommended ${HISTORICAL_WARMUP_REQUIREMENTS.TARGET_H1_WARMUP_BARS} bars for full EMA 200 mathematical convergence. Results have reduced statistical confidence.`
    );
  }

  const startIndex = Math.max(0, dataset.evaluationStartIndex || 0);

  // Simulation State
  let currentBalance = config.initialBalance;
  let peakEquity = config.initialBalance;
  let cumulativeR = 0;
  let simultaneousTouchCount = 0;
  let rejectedSignalsCount = 0;
  let unexecutedFinalBarSignalsCount = 0;
  let totalSignalsGenerated = 0;

  let activeTrade: SimulationTradeRecord | null = null;
  let pendingSignal: TradingSignal | null = null;
  const executedTrades: SimulationTradeRecord[] = [];
  const equityCurve: EquitySnapshot[] = [];

  // Initial Equity snapshot
  equityCurve.push({
    time: m15Candles[startIndex]?.time || 0,
    barIndex: startIndex,
    balance: currentBalance,
    equity: currentBalance,
    realizedPnl: 0,
    unrealizedPnl: 0,
    peakEquity: currentBalance,
    drawdownCurrency: 0,
    drawdownPercent: 0,
    drawdownR: 0,
    cumulativeR: 0,
  });

  // 2. Chronological Simulation Loop
  for (let i = startIndex; i < m15Candles.length; i++) {
    const candle = m15Candles[i];

    // Find the latest completed H1 candle at candle.time (closed at or before candle.time + 900)
    const h1Idx = getLatestClosedH1Index(candle.time, h1Candles, 900, 'close');
    const completedH1 = h1Idx >= 0 ? h1Candles[h1Idx] : null;

    // Verify zero lookahead
    assertNoLookahead(candle.time, completedH1, 900, 'close');

    // STEP A: Execute Pending Signal at current candle OPEN
    if (pendingSignal && !activeTrade) {
      // Execute at current candle OPEN
      const atrAtSignal = pendingSignal.indicatorsAtSignal?.atr14 ?? dataset.m15Atr14Map.get(pendingSignal.signalTime) ?? 1.0;
      activeTrade = executeOpenTrade({
        signal: pendingSignal,
        nextCandle: candle,
        nextCandleIndex: i,
        config,
        instrument,
        currentBalance,
        swings,
        atrValueAtSignal: atrAtSignal,
      });
      pendingSignal = null;
    }

    // STEP B: Evaluate Active Trade against current candle price range
    if (activeTrade) {
      const evalResult = evaluateActiveTradeOnCandle({
        trade: activeTrade,
        candle,
        candleIndex: i,
        costs: config.costs,
        instrument,
      });

      if (evalResult.tradeClosed && evalResult.closedTrade) {
        const closed = evalResult.closedTrade;
        currentBalance = Number((currentBalance + closed.netPnl).toFixed(2));
        cumulativeR = Number((cumulativeR + closed.resultInR).toFixed(2));
        if (closed.simultaneousTouchResolvedToSL) {
          simultaneousTouchCount++;
        }
        executedTrades.push(closed);
        activeTrade = null;
      }
    }

    // STEP C: Signal Generation on current candle CLOSE
    // If no active trade and no pending signal, evaluate signal candidate
    if (!activeTrade && !pendingSignal) {
      const m15Indicators = {
        ema50: dataset.m15Ema50Map.get(candle.time) ?? null,
        ema200: dataset.m15Ema200Map.get(candle.time) ?? null,
        atr14: dataset.m15Atr14Map.get(candle.time) ?? null,
      };

      const h1Indicators = completedH1
        ? {
            ema50: dataset.h1Ema50Map.get(completedH1.time) ?? null,
            ema200: dataset.h1Ema200Map.get(completedH1.time) ?? null,
            atr14: dataset.h1Atr14Map.get(completedH1.time) ?? null,
          }
        : { ema50: null, ema200: null, atr14: null };

      const context: SignalEvaluationContext = {
        m15Candles,
        currentIndex: i,
        currentCandle: candle,
        completedH1Candle: completedH1,
        completedH1Index: h1Idx,
        m15Indicators,
        h1Indicators,
        h1Candles: dataset.h1Candles,
        h1Ema50Map: dataset.h1Ema50Map,
        h1Ema200Map: dataset.h1Ema200Map,
        h1Adx14Map: dataset.h1Adx14Map,
        confirmedSwings: swings.filter((s) => s.confirmedAtIndex <= i),
        symbol,
      };

      const detected = signalGenerator.generateSignal(context);

      if (detected) {
        totalSignalsGenerated++;
        const validation = validateSignal(detected, candle);
        if (!validation.isValid) {
          warnings.push(`Invalid signal rejected at bar ${i}: ${validation.error}`);
        } else {
          // Check if there is a next candle for execution
          if (i === m15Candles.length - 1) {
            unexecutedFinalBarSignalsCount++;
            warnings.push(
              `Signal detected at the final bar (index ${i}, time ${candle.time}) cannot be executed because no subsequent candle exists.`
            );
          } else {
            pendingSignal = detected;
          }
        }
      }
    } else if (activeTrade) {
      // Position is already active: evaluate if a duplicate signal would have formed
      // to track rejected overlapping signals
      const m15Indicators = {
        ema50: dataset.m15Ema50Map.get(candle.time) ?? null,
        ema200: dataset.m15Ema200Map.get(candle.time) ?? null,
        atr14: dataset.m15Atr14Map.get(candle.time) ?? null,
      };
      const h1Indicators = completedH1
        ? {
            ema50: dataset.h1Ema50Map.get(completedH1.time) ?? null,
            ema200: dataset.h1Ema200Map.get(completedH1.time) ?? null,
            atr14: dataset.h1Atr14Map.get(completedH1.time) ?? null,
          }
        : { ema50: null, ema200: null, atr14: null };

      const context: SignalEvaluationContext = {
        m15Candles,
        currentIndex: i,
        currentCandle: candle,
        completedH1Candle: completedH1,
        completedH1Index: h1Idx,
        m15Indicators,
        h1Indicators,
        h1Candles: dataset.h1Candles,
        h1Ema50Map: dataset.h1Ema50Map,
        h1Ema200Map: dataset.h1Ema200Map,
        h1Adx14Map: dataset.h1Adx14Map,
        confirmedSwings: swings.filter((s) => s.confirmedAtIndex <= i),
        symbol,
      };

      const duplicateSignal = signalGenerator.generateSignal(context);
      if (duplicateSignal) {
        rejectedSignalsCount++;
      }
    }

    // STEP D: Record Equity Snapshot
    let unrealizedPnl = 0;
    if (activeTrade) {
      unrealizedPnl = calculateUnrealizedPnL(
        activeTrade,
        candle,
        activeTrade.commissionCost
      );
    }
    const currentEquity = Number((currentBalance + unrealizedPnl).toFixed(2));
    peakEquity = Math.max(peakEquity, currentEquity);
    const drawdownCurrency = Number((peakEquity - currentEquity).toFixed(2));
    const drawdownPercent =
      peakEquity > 0 ? Number(((drawdownCurrency / peakEquity) * 100).toFixed(2)) : 0;
    const initialRiskCurrency = activeTrade?.riskAmountCurrency || 100;
    const drawdownR = Number((drawdownCurrency / initialRiskCurrency).toFixed(2));

    equityCurve.push({
      time: candle.time,
      barIndex: i,
      balance: currentBalance,
      equity: currentEquity,
      realizedPnl: Number((currentBalance - config.initialBalance).toFixed(2)),
      unrealizedPnl,
      peakEquity,
      drawdownCurrency,
      drawdownPercent,
      drawdownR,
      cumulativeR,
    });
  }

  // 3. Handle Open Position at End of Test
  let openTradesAtEndCount = 0;
  if (activeTrade) {
    openTradesAtEndCount = 1;
    const lastCandle = m15Candles[m15Candles.length - 1];
    const lastIndex = m15Candles.length - 1;

    const finalized = finalizeOpenTradeAtEndOfTest({
      trade: activeTrade,
      lastCandle,
      lastCandleIndex: lastIndex,
      costs: config.costs,
      instrument,
      policy: config.endOfTestPolicy,
    });

    if (config.endOfTestPolicy === 'CLOSE_AT_LAST_BAR') {
      currentBalance = Number((currentBalance + finalized.netPnl).toFixed(2));
      cumulativeR = Number((cumulativeR + finalized.resultInR).toFixed(2));
    }
    executedTrades.push(finalized);
  }

  // 4. Performance Metrics Aggregation
  const performance = calculatePerformanceMetrics(executedTrades, config.initialBalance);

  // 5. Diagnostics
  const diagnostics: SimulationDiagnostics = {
    warmUpConfidence,
    warnings,
    assumptions: SIMULATION_ASSUMPTIONS,
    totalBarsEvaluated: m15Candles.length - startIndex,
    totalSignalsGenerated,
    totalTradesExecuted: executedTrades.length,
    rejectedSignalsCount,
    unexecutedFinalBarSignalsCount,
    openTradesAtEndCount,
    simultaneousTouchCount,
    instrumentMetadata: instrument,
    evaluationStartTime: m15Candles[startIndex]?.time || 0,
    evaluationEndTime: m15Candles[m15Candles.length - 1]?.time || 0,
  };

  return {
    trades: executedTrades,
    equityCurve,
    performance,
    diagnostics,
  };
}

/**
 * Calculates comprehensive backtest performance statistics.
 */
function calculatePerformanceMetrics(
  trades: SimulationTradeRecord[],
  initialBalance: number
): SimulationPerformanceMetrics {
  const totalTrades = trades.length;
  if (totalTrades === 0) {
    return {
      totalTrades: 0,
      winningTrades: 0,
      losingTrades: 0,
      breakevenTrades: 0,
      openTrades: 0,
      winRate: 0,
      profitFactor: 0,
      netR: 0,
      grossR: 0,
      totalGrossPnl: 0,
      totalExecutionCosts: 0,
      totalNetPnl: 0,
      maxDrawdownCurrency: 0,
      maxDrawdownPercent: 0,
      maxDrawdownR: 0,
      maxConsecutiveWins: 0,
      maxConsecutiveLosses: 0,
      avgWinR: 0,
      avgLossR: 0,
      expectancyR: 0,
      longTradesCount: 0,
      longWinRate: 0,
      shortTradesCount: 0,
      shortWinRate: 0,
      avgHoldingBars: 0,
    };
  }

  let winningTrades = 0;
  let losingTrades = 0;
  let breakevenTrades = 0;
  let openTrades = 0;

  let totalGrossPnl = 0;
  let totalExecutionCosts = 0;
  let totalNetPnl = 0;
  let netR = 0;
  let grossR = 0;

  let grossGains = 0;
  let grossLosses = 0;

  let totalWinR = 0;
  let totalLossR = 0;

  let maxConsecutiveWins = 0;
  let maxConsecutiveLosses = 0;
  let currentConsecutiveWins = 0;
  let currentConsecutiveLosses = 0;

  let longTradesCount = 0;
  let longWins = 0;
  let shortTradesCount = 0;
  let shortWins = 0;
  let totalHoldingBars = 0;

  for (const t of trades) {
    totalHoldingBars += t.holdingBars;
    totalGrossPnl += t.grossPnl;
    totalExecutionCosts += t.totalExecutionCosts;
    totalNetPnl += t.netPnl;
    netR += t.resultInR;
    grossR += t.grossResultInR;

    if (t.direction === 'BUY') {
      longTradesCount++;
      if (t.status === 'WIN') longWins++;
    } else {
      shortTradesCount++;
      if (t.status === 'WIN') shortWins++;
    }

    if (t.status === 'OPEN') {
      openTrades++;
      continue;
    }

    if (t.status === 'WIN') {
      winningTrades++;
      grossGains += Math.max(0, t.netPnl);
      totalWinR += t.resultInR;

      currentConsecutiveWins++;
      currentConsecutiveLosses = 0;
      if (currentConsecutiveWins > maxConsecutiveWins) {
        maxConsecutiveWins = currentConsecutiveWins;
      }
    } else if (t.status === 'LOSS') {
      losingTrades++;
      grossLosses += Math.abs(Math.min(0, t.netPnl));
      totalLossR += Math.abs(t.resultInR);

      currentConsecutiveLosses++;
      currentConsecutiveWins = 0;
      if (currentConsecutiveLosses > maxConsecutiveLosses) {
        maxConsecutiveLosses = currentConsecutiveLosses;
      }
    } else {
      breakevenTrades++;
      currentConsecutiveWins = 0;
      currentConsecutiveLosses = 0;
    }
  }

  const closedTradesCount = winningTrades + losingTrades + breakevenTrades;
  const winRate =
    closedTradesCount > 0 ? Number(((winningTrades / closedTradesCount) * 100).toFixed(1)) : 0;
  const longWinRate =
    longTradesCount > 0 ? Number(((longWins / longTradesCount) * 100).toFixed(1)) : 0;
  const shortWinRate =
    shortTradesCount > 0 ? Number(((shortWins / shortTradesCount) * 100).toFixed(1)) : 0;

  let profitFactor = 0;
  if (grossLosses === 0) {
    profitFactor = grossGains > 0 ? 999.99 : 0;
  } else {
    profitFactor = Number((grossGains / grossLosses).toFixed(2));
  }

  const avgWinR = winningTrades > 0 ? Number((totalWinR / winningTrades).toFixed(2)) : 0;
  const avgLossR = losingTrades > 0 ? Number((totalLossR / losingTrades).toFixed(2)) : 0;

  // Expectancy in R: (WinRate * AvgWinR) - (LossRate * AvgLossR)
  const winFraction = closedTradesCount > 0 ? winningTrades / closedTradesCount : 0;
  const lossFraction = closedTradesCount > 0 ? losingTrades / closedTradesCount : 0;
  const expectancyR = Number((winFraction * avgWinR - lossFraction * avgLossR).toFixed(2));

  const avgHoldingBars =
    totalTrades > 0 ? Number((totalHoldingBars / totalTrades).toFixed(1)) : 0;

  return {
    totalTrades,
    winningTrades,
    losingTrades,
    breakevenTrades,
    openTrades,
    winRate,
    profitFactor,
    netR: Number(netR.toFixed(2)),
    grossR: Number(grossR.toFixed(2)),
    totalGrossPnl: Number(totalGrossPnl.toFixed(2)),
    totalExecutionCosts: Number(totalExecutionCosts.toFixed(2)),
    totalNetPnl: Number(totalNetPnl.toFixed(2)),
    maxDrawdownCurrency: 0, // Computed from equity curve
    maxDrawdownPercent: 0,
    maxDrawdownR: 0,
    maxConsecutiveWins,
    maxConsecutiveLosses,
    avgWinR,
    avgLossR,
    expectancyR,
    longTradesCount,
    longWinRate,
    shortTradesCount,
    shortWinRate,
    avgHoldingBars,
  };
}
