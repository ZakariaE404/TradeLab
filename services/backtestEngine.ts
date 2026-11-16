import {
  BacktestResult,
  Candle,
  EquityPoint,
  ExitReason,
  ForexSymbol,
  StrategyParameters,
  Timeframe,
  Trade,
} from '@/types/trading';
import { calculateATR, calculateBollingerBands, calculateEMA, calculateRSI } from './indicators';
import { FOREX_SYMBOLS } from './marketData';
import {
  DEFAULT_STRATEGY_A_PARAMS,
  runStrategyABacktest,
  STRATEGY_A_ASSUMPTIONS,
} from './strategyA';
import { createHistoricalDatasetFromCandles } from './historicalDataLoader';
import { TradeLabStrategyEngine } from './strategy/strategyRules';
import { DEFAULT_STRATEGY_CONFIG, StrategyConfiguration, CandleDiagnosticSnapshot } from './strategy/types';
import { runHistoricalSimulation } from './simulationEngine';
import { runStrategyExperiments, StrategyExperimentResult } from './strategy/experimentRunner';
import { getInstrumentCostModel } from './costEngine';
import { SimulationConfig, SimulationResult } from '@/types/simulation';
import {
  StrategyRegistry,
  runModularBacktest,
  prepareTimeframeCandlesForStrategy,
} from './strategy';

export const DEFAULT_STRATEGY_PARAMS: StrategyParameters = {
  strategyType: 'strategy_001',
  fastEma: 20,
  slowEma: 50,
  trendEma: 200,
  rsiPeriod: 14,
  rsiOverbought: 70,
  rsiOversold: 30,
  atrPeriod: 14,
  atrStopMultiplier: 1.5,
  riskRewardRatio: 2.0,
  useTrailingStop: false,
  trailingStopTriggerR: 1.0,
  accountBalance: 10000,
  riskPercent: 1.0,
  includeSpread: true,
  spreadPips: 1.2,
  commissionPerLot: 7.0,
  slippagePips: 0.5,
  strategyA: DEFAULT_STRATEGY_A_PARAMS,
  tradeLabConfig: DEFAULT_STRATEGY_CONFIG,
};

export const STRATEGY_PRESETS: {
  id: string;
  name: string;
  description: string;
  params: Partial<StrategyParameters>;
  status?: 'active' | 'disabled';
}[] = [
  {
    id: 'strategy_001_standard',
    name: 'Strategy 001: H1 Trend + M15 Rejection (Active / Validated)',
    description:
      'Validated multi-timeframe strategy: H1 EMA 50/200 & swing structure filter with M15 support/resistance zone rejection (M15 Entry + H1 Trend).',
    params: {
      strategyType: 'strategy_001',
      riskRewardRatio: 2.0,
      strategyA: DEFAULT_STRATEGY_A_PARAMS,
    },
    status: 'active',
  },
  {
    id: 'strategy_002_pullback',
    name: 'Strategy 002: Multi-Timeframe EMA Trend Pullback [Disabled]',
    description:
      'Disabled / Not Validated — Pending comprehensive testing and validation.',
    params: {
      strategyType: 'strategy_002',
      riskRewardRatio: 2.0,
    },
    status: 'disabled',
  },
  {
    id: 'tradelab_standard',
    name: 'TradeLab Multi-Regime Engine [Disabled]',
    description:
      'Disabled / Not Validated — Pending comprehensive testing and validation.',
    params: {
      strategyType: 'tradelab_strategy',
      riskRewardRatio: 2.0,
      tradeLabConfig: DEFAULT_STRATEGY_CONFIG,
    },
    status: 'disabled',
  },
  {
    id: 'strategy_a_standard',
    name: 'Strategy A (Legacy Alias to Strategy 001)',
    description:
      'Alias to Strategy 001: H1 EMA 50/200 & structure filter with M15 rejection wick entries.',
    params: {
      strategyType: 'strategy_001',
      riskRewardRatio: 2.0,
      strategyA: DEFAULT_STRATEGY_A_PARAMS,
    },
    status: 'active',
  },
  {
    id: 'ema_pullback_standard',
    name: 'EMA Pullback 1:2 RR [Disabled]',
    description: 'Disabled / Not Validated — Pending validation requirements.',
    params: {
      strategyType: 'ema_pullback',
      fastEma: 20,
      slowEma: 50,
      trendEma: 200,
      atrStopMultiplier: 1.5,
      riskRewardRatio: 2.0,
      useTrailingStop: false,
    },
    status: 'disabled',
  },
];

/**
 * Executes TradeLab Phase 3 Strategy Backtest using modular simulation engine
 */
export function runTradeLabStrategyBacktest(
  candles: Candle[],
  providedH1Candles: Candle[] | null | undefined,
  params: StrategyParameters,
  symbol: ForexSymbol,
  timeframe: Timeframe,
  dataSourceDescription?: string
): BacktestResult {
  const strategyConfig: StrategyConfiguration = {
    ...DEFAULT_STRATEGY_CONFIG,
    ...(params.tradeLabConfig || {}),
    riskRewardRatio:
      params.riskRewardRatio ||
      params.tradeLabConfig?.riskRewardRatio ||
      DEFAULT_STRATEGY_CONFIG.riskRewardRatio,
  };

  const simConfig: SimulationConfig = {
    initialBalance: params.accountBalance,
    sizing: { method: 'FIXED_RISK_PERCENT', value: params.riskPercent },
    costs: {
      spreadPips: params.includeSpread ? params.spreadPips : 0,
      slippagePips: params.slippagePips ?? 0.5,
      commissionPerLot: params.commissionPerLot ?? 7.0,
    },
    endOfTestPolicy: 'LEAVE_OPEN',
    minStopLossPips: strategyConfig.minStopLossPips,
    allowMinimumWarmup: true,
  };

  const dataset = createHistoricalDatasetFromCandles(
    candles,
    providedH1Candles,
    symbol,
    providedH1Candles && providedH1Candles.length > 0 ? 'REAL' : 'DEMO'
  );

  const instrument = getInstrumentCostModel(symbol);

  // If BOTH is selected for any dimension, run independent experiments suite
  let simResult: SimulationResult;
  let experiments: StrategyExperimentResult[] | undefined;
  let diagnosticsSnapshots: CandleDiagnosticSnapshot[] = [];

  const isExperiment =
    strategyConfig.regime === 'BOTH' ||
    strategyConfig.pattern === 'BOTH' ||
    strategyConfig.direction === 'BOTH';

  if (isExperiment) {
    const suite = runStrategyExperiments({
      dataset,
      strategyConfig,
      simulationConfig: simConfig,
    });
    simResult = suite.primaryResult;
    experiments = suite.experiments;
  } else {
    const engine = new TradeLabStrategyEngine(strategyConfig);
    simResult = runHistoricalSimulation({
      dataset,
      signalGenerator: engine,
      config: simConfig,
    });
    diagnosticsSnapshots = Array.from(engine.diagnosticsMap.values());
  }

  // Map SimulationTradeRecord[] to Trade[]
  const mappedTrades: Trade[] = simResult.trades.map((st, idx) => {
    const isBuy = st.direction === 'BUY';
    const pnlPips =
      st.exitPrice !== null && st.exitPrice > 0
        ? (isBuy ? st.exitPrice - st.entryPrice : st.entryPrice - st.exitPrice) / instrument.pipSize
        : 0;

    const exitReason: ExitReason =
      st.exitReason === 'TP' ? 'TP' : st.exitReason === 'SL' ? 'SL' : 'UNRESOLVED';

    return {
      id: st.id,
      index: idx + 1,
      symbol,
      timeframe,
      direction: st.direction,
      signalTime: st.relevantIndicatorValuesAtEntry?.signalTime ?? st.entryTime,
      signalIndex: st.entryIndex > 0 ? st.entryIndex - 1 : st.entryIndex,
      entryTime: st.entryTime,
      entryPrice: st.entryPrice,
      entryIndex: st.entryIndex,
      exitTime: st.exitTime || 0,
      exitPrice: st.exitPrice || 0,
      exitIndex: st.exitIndex || 0,
      stopLoss: st.stopLoss,
      takeProfit: st.takeProfit,
      initialRiskPips: st.initialRiskPips,
      status: st.status === 'OPEN' ? 'UNRESOLVED' : st.status,
      exitReason,
      pnlPips: Number(pnlPips.toFixed(1)),
      pnlCurrency: Number(st.netPnl.toFixed(2)),
      pnlR: Number(st.resultInR.toFixed(2)),
      holdingBars: st.holdingBars,
      riskAmount: st.riskAmountCurrency,
      signalReason: st.signalType,
      h1Bias: (st.relevantIndicatorValuesAtEntry?.h1Trend as unknown as string) || st.marketRegime,
      m15Confirmation: `${st.signalType} (${st.stopLossMethod} SL / ${st.takeProfitMethod} TP)`,
      riskRewardRatio: strategyConfig.riskRewardRatio,
      simultaneousTouchResolvedToSL: st.simultaneousTouchResolvedToSL,
    };
  });

  const costModel = {
    spreadPips: simConfig.costs.spreadPips,
    commissionPerLot: simConfig.costs.commissionPerLot,
    slippagePips: simConfig.costs.slippagePips,
  };

  const compiled = compileBacktestResults(mappedTrades, params.accountBalance, costModel);

  const dataSourceNote = dataSourceDescription
    ? `Data Source: ${dataSourceDescription}. Note: Dukascopy prices may differ from broker feeds (e.g. Vantage/TradingView).`
    : 'Data Source: Simulated Market Data.';

  const assumptions = [
    dataSourceNote,
    'TradeLab Phase 3: Multi-Regime Strategy Engine active (Zero Future-Data Leakage).',
    `Regime: ${strategyConfig.regime} | Pattern: ${strategyConfig.pattern} | Direction: ${strategyConfig.direction}.`,
    `H1 Trend Filter: Causal EMA 50 / 200 with ${strategyConfig.slopeLookbackBars || strategyConfig.emaSlopeLookback || 3}-bar slope lookback.`,
    `Market Regime: ADX 14 thresholds (Trending > ${strategyConfig.adxTrendingThreshold}, Ranging < ${strategyConfig.adxRangingThreshold}).`,
    `S/R Engine: Confirmed Swings (${strategyConfig.swingLeftBars} left, ${strategyConfig.swingRightBars} right confirmation lag).`,
    `Execution Timing: Signal at confirmation candle CLOSE; fill at next candle OPEN.`,
    `Stop Loss: ${strategyConfig.stopLossMethod} (Buffer: ${strategyConfig.stopLossBufferPips} pips, Min: ${strategyConfig.minStopLossPips} pips).`,
    `Take Profit: ${strategyConfig.takeProfitMethod} (Target: 1:${strategyConfig.riskRewardRatio} RR).`,
    'Conservative Execution: Same-bar SL & TP touch resolves strictly to STOP LOSS.',
  ];

  return {
    ...compiled,
    costModel,
    assumptions,
    simulationResult: simResult,
    diagnosticsSnapshots,
    experiments,
    activeExperimentId: experiments && experiments.length > 0 ? experiments[0].id : undefined,
  };
}

/**
 * Executes candle-by-candle strategy simulation and backtest
 */
export function runBacktest(
  candles: Candle[],
  params: StrategyParameters,
  symbol: ForexSymbol,
  timeframe: Timeframe,
  providedH1Candles?: Candle[] | null,
  dataSourceDescription?: string
): BacktestResult {
  if (!candles || candles.length < 50) {
    return createEmptyResult(params.accountBalance);
  }

  // Route to Strategy 001 (or 'strategy_a' canonical alias)
  const strategyId = params.strategyType === 'strategy_a' ? 'strategy_001' : params.strategyType;
  const modularStrategy = StrategyRegistry.getStrategy(strategyId);

  // Strict Validation Guard: Prevent execution of disabled or unvalidated strategies
  if (!modularStrategy || (modularStrategy.status !== 'active' && modularStrategy.status !== 'validated')) {
    return {
      ...createEmptyResult(params.accountBalance),
      assumptions: [
        `Execution Blocked: Strategy "${params.strategyType}" is Disabled / Not Validated.`,
        'Only Strategy 001 (M15 Entry + H1 Trend) has passed all validation requirements and is authorized to execute.',
        'All other strategies remain disabled pending formal validation.',
      ],
    };
  }

  const candlesByTimeframe = prepareTimeframeCandlesForStrategy(
    modularStrategy,
    candles,
    providedH1Candles
  );

  return runModularBacktest({
    strategy: modularStrategy,
    candlesByTimeframe,
    parameters: params,
    symbol,
    activeChartTimeframe: timeframe,
    dataSourceDescription,
  });
}

/**
 * Calculates final PnL, R-multiple, and trade status
 */
function finalizeTrade(
  trade: Trade,
  pipSize: number,
  digits: number,
  accountBalance: number,
  riskPercent: number
) {
  const isLong = trade.direction === 'LONG' || trade.direction === 'BUY';
  const pipsDiff = isLong
    ? (trade.exitPrice - trade.entryPrice) / pipSize
    : (trade.entryPrice - trade.exitPrice) / pipSize;

  trade.pnlPips = Number(pipsDiff.toFixed(1));

  // Risk unit (1R in pips)
  const riskPips = Math.max(trade.initialRiskPips, 1);
  const pnlR = trade.pnlPips / riskPips;
  trade.pnlR = Number(pnlR.toFixed(2));

  // Currency PnL based on simulated account risk
  const riskDollar = accountBalance * (riskPercent / 100);
  trade.pnlCurrency = Number((pnlR * riskDollar).toFixed(2));

  if (
    trade.status === 'UNRESOLVED' ||
    trade.status === 'OPEN' ||
    trade.exitReason === 'OPEN' ||
    trade.exitReason === 'UNRESOLVED'
  ) {
    trade.status = 'UNRESOLVED';
    return;
  }

  if (trade.pnlR >= 0.1) {
    trade.status = 'WIN';
  } else if (trade.pnlR <= -0.1) {
    trade.status = 'LOSS';
  } else {
    trade.status = 'BREAKEVEN';
  }
}

/**
 * Aggregates all trade statistics, equity progression, and drawdown curves
 */
function compileBacktestResults(
  trades: Trade[],
  startingBalance: number,
  costModel?: { spreadPips: number; commissionPerLot: number; slippagePips: number }
): BacktestResult {
  const resolvedTrades = trades.filter((t) => t.status !== 'OPEN' && t.status !== 'UNRESOLVED');
  const unresolvedTrades = trades.filter((t) => t.status === 'OPEN' || t.status === 'UNRESOLVED').length;
  const totalResolved = resolvedTrades.length;

  let winningTrades = 0;
  let losingTrades = 0;
  let breakevenTrades = 0;
  let grossProfitR = 0;
  let grossLossR = 0;
  let netR = 0;
  let totalPnlCurrency = 0;

  let longCount = 0;
  let longWins = 0;
  let shortCount = 0;
  let shortWins = 0;

  let maxConsecWins = 0;
  let currentConsecWins = 0;
  let maxConsecLosses = 0;
  let currentConsecLosses = 0;

  let currentEquity = startingBalance;
  let peakEquity = startingBalance;
  let peakCumulativeR = 0;
  let maxDrawdownR = 0;
  let maxDrawdownPercent = 0;

  const equityCurve: EquityPoint[] = [
    {
      time: trades[0]?.entryTime || 1730505600,
      tradeIndex: 0,
      equity: startingBalance,
      cumulativeR: 0,
      drawdownPercent: 0,
      drawdownR: 0,
    },
  ];

  for (let i = 0; i < resolvedTrades.length; i++) {
    const t = resolvedTrades[i];
    netR += t.pnlR;
    totalPnlCurrency += t.pnlCurrency;
    currentEquity += t.pnlCurrency;

    if (t.status === 'WIN') {
      winningTrades++;
      grossProfitR += t.pnlR;
      currentConsecWins++;
      currentConsecLosses = 0;
      if (currentConsecWins > maxConsecWins) maxConsecWins = currentConsecWins;
    } else if (t.status === 'LOSS') {
      losingTrades++;
      grossLossR += Math.abs(t.pnlR);
      currentConsecLosses++;
      currentConsecWins = 0;
      if (currentConsecLosses > maxConsecLosses) maxConsecLosses = currentConsecLosses;
    } else {
      breakevenTrades++;
      currentConsecWins = 0;
      currentConsecLosses = 0;
    }

    const isLong = t.direction === 'LONG' || t.direction === 'BUY';
    if (isLong) {
      longCount++;
      if (t.status === 'WIN') longWins++;
    } else {
      shortCount++;
      if (t.status === 'WIN') shortWins++;
    }

    // High water mark & Drawdown tracking
    if (currentEquity > peakEquity) peakEquity = currentEquity;
    if (netR > peakCumulativeR) peakCumulativeR = netR;

    const currentDrawdownR = peakCumulativeR - netR;
    if (currentDrawdownR > maxDrawdownR) maxDrawdownR = currentDrawdownR;

    const currentDrawdownPct = peakEquity > 0 ? ((peakEquity - currentEquity) / peakEquity) * 100 : 0;
    if (currentDrawdownPct > maxDrawdownPercent) maxDrawdownPercent = currentDrawdownPct;

    equityCurve.push({
      time: t.exitTime || t.entryTime,
      tradeIndex: i + 1,
      equity: Number(currentEquity.toFixed(2)),
      cumulativeR: Number(netR.toFixed(2)),
      drawdownPercent: Number(currentDrawdownPct.toFixed(2)),
      drawdownR: Number(currentDrawdownR.toFixed(2)),
    });
  }

  const winRate = totalResolved > 0 ? Number(((winningTrades / totalResolved) * 100).toFixed(1)) : 0;
  const profitFactor =
    grossLossR > 0 ? Number((grossProfitR / grossLossR).toFixed(2)) : grossProfitR > 0 ? 99.9 : 0;

  const avgWinR = winningTrades > 0 ? Number((grossProfitR / winningTrades).toFixed(2)) : 0;
  const avgLossR = losingTrades > 0 ? Number((grossLossR / losingTrades).toFixed(2)) : 0;

  // Expectancy in R: (WinRate * AvgWin) - (LossRate * AvgLoss)
  const winProb = totalResolved > 0 ? winningTrades / totalResolved : 0;
  const lossProb = totalResolved > 0 ? losingTrades / totalResolved : 0;
  const expectancyR = Number((winProb * avgWinR - lossProb * avgLossR).toFixed(2));

  const longWinRate = longCount > 0 ? Number(((longWins / longCount) * 100).toFixed(1)) : 0;
  const shortWinRate = shortCount > 0 ? Number(((shortWins / shortCount) * 100).toFixed(1)) : 0;

  // Monthly Performance Breakdown
  const monthMap = new Map<
    string,
    {
      tradesCount: number;
      winningTrades: number;
      losingTrades: number;
      netR: number;
      pnlCurrency: number;
    }
  >();

  for (const t of resolvedTrades) {
    const d = new Date(t.entryTime * 1000);
    const monthKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    if (!monthMap.has(monthKey)) {
      monthMap.set(monthKey, {
        tradesCount: 0,
        winningTrades: 0,
        losingTrades: 0,
        netR: 0,
        pnlCurrency: 0,
      });
    }
    const m = monthMap.get(monthKey)!;
    m.tradesCount++;
    if (t.status === 'WIN') m.winningTrades++;
    if (t.status === 'LOSS') m.losingTrades++;
    m.netR += t.pnlR;
    m.pnlCurrency += t.pnlCurrency;
  }

  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthlyPerformance = Array.from(monthMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([monthKey, data]) => {
      const [year, monthNum] = monthKey.split('-');
      const label = `${MONTH_NAMES[parseInt(monthNum, 10) - 1]} ${year}`;
      const mWinRate =
        data.tradesCount > 0
          ? Number(((data.winningTrades / data.tradesCount) * 100).toFixed(1))
          : 0;
      return {
        monthKey,
        label,
        tradesCount: data.tradesCount,
        winningTrades: data.winningTrades,
        losingTrades: data.losingTrades,
        winRate: mWinRate,
        netR: Number(data.netR.toFixed(2)),
        profitCurrency: Number(data.pnlCurrency.toFixed(2)),
      };
    });

  return {
    trades,
    totalTrades: trades.length,
    winningTrades,
    losingTrades,
    breakevenTrades,
    unresolvedTrades,
    winRate,
    profitFactor,
    netR: Number(netR.toFixed(2)),
    grossSimulatedR: Number(grossProfitR.toFixed(2)),
    isGrossSimulated: false,
    totalPnlCurrency: Number(totalPnlCurrency.toFixed(2)),
    maxDrawdownR: Number(maxDrawdownR.toFixed(2)),
    maxDrawdownPercent: Number(maxDrawdownPercent.toFixed(2)),
    maxConsecutiveWins: maxConsecWins,
    maxConsecutiveLosses: maxConsecLosses,
    avgWinR,
    avgLossR,
    expectancyR,
    longTradesCount: longCount,
    longWinRate,
    shortTradesCount: shortCount,
    shortWinRate,
    equityCurve,
    monthlyPerformance,
    costModel: costModel || {
      spreadPips: 0,
      commissionPerLot: 7.0,
      slippagePips: 0.5,
    },
  };
}

function createEmptyResult(startingBalance: number): BacktestResult {
  return {
    trades: [],
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    breakevenTrades: 0,
    unresolvedTrades: 0,
    winRate: 0,
    profitFactor: 0,
    netR: 0,
    grossSimulatedR: 0,
    isGrossSimulated: false,
    costModel: {
      spreadPips: 0,
      commissionPerLot: 7.0,
      slippagePips: 0.5,
    },
    totalPnlCurrency: 0,
    maxDrawdownR: 0,
    maxDrawdownPercent: 0,
    maxConsecutiveWins: 0,
    maxConsecutiveLosses: 0,
    avgWinR: 0,
    avgLossR: 0,
    expectancyR: 0,
    longTradesCount: 0,
    longWinRate: 0,
    shortTradesCount: 0,
    shortWinRate: 0,
    equityCurve: [
      {
        time: 1730505600,
        tradeIndex: 0,
        equity: startingBalance,
        cumulativeR: 0,
        drawdownPercent: 0,
        drawdownR: 0,
      },
    ],
    monthlyPerformance: [],
  };
}
