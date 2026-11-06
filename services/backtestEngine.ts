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

export const DEFAULT_STRATEGY_PARAMS: StrategyParameters = {
  strategyType: 'strategy_a',
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
}[] = [
  {
    id: 'tradelab_standard',
    name: 'TradeLab Multi-Regime Engine (Phase 3)',
    description:
      'Phase 3 Multi-Regime engine: Causal H1 EMA 50/200 & slope, ADX 14 regime classification, confirmed swing S/R, Rejection & Engulfing patterns.',
    params: {
      strategyType: 'tradelab_strategy',
      riskRewardRatio: 2.0,
      tradeLabConfig: DEFAULT_STRATEGY_CONFIG,
    },
  },
  {
    id: 'strategy_a_standard',
    name: 'Strategy A: H1 Trend + M15 Rejection (2:1 RR)',
    description:
      'H1 EMA 50/200 & structure filter with M15 support/resistance zone rejection and confirmed swing SL.',
    params: {
      strategyType: 'strategy_a',
      riskRewardRatio: 2.0,
      strategyA: DEFAULT_STRATEGY_A_PARAMS,
    },
  },
  {
    id: 'ema_pullback_standard',
    name: 'EMA Pullback 1:2 RR',
    description: 'Trend filter with 20/50/200 EMAs and pullback entry with 1.5x ATR stop loss.',
    params: {
      strategyType: 'ema_pullback',
      fastEma: 20,
      slowEma: 50,
      trendEma: 200,
      atrStopMultiplier: 1.5,
      riskRewardRatio: 2.0,
      useTrailingStop: false,
    },
  },
  {
    id: 'ema_pullback_runner',
    name: 'EMA Trend Runner 1:3 RR (Trailing)',
    description: 'Aim for higher R-multiples with 1:3 RR and trailing stop at +1R breakeven.',
    params: {
      strategyType: 'ema_pullback',
      fastEma: 13,
      slowEma: 34,
      trendEma: 100,
      atrStopMultiplier: 1.8,
      riskRewardRatio: 3.0,
      useTrailingStop: true,
      trailingStopTriggerR: 1.2,
    },
  },
  {
    id: 'breakout_retest_standard',
    name: 'Donchian Breakout & ATR Stop',
    description: 'Enters on 20-bar channel high/low breakouts with dynamic volatility stop.',
    params: {
      strategyType: 'breakout_retest',
      fastEma: 20,
      slowEma: 50,
      atrStopMultiplier: 2.0,
      riskRewardRatio: 2.0,
      useTrailingStop: false,
    },
  },
  {
    id: 'rsi_mean_reversion_standard',
    name: 'RSI Reversal & Bollinger Bands',
    description: 'Counter-trend mean-reversion at RSI oversold/overbought extremes.',
    params: {
      strategyType: 'rsi_mean_reversion',
      rsiPeriod: 14,
      rsiOversold: 28,
      rsiOverbought: 72,
      atrStopMultiplier: 1.2,
      riskRewardRatio: 1.5,
      useTrailingStop: false,
    },
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
  timeframe: Timeframe
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

  const assumptions = [
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
  providedH1Candles?: Candle[] | null
): BacktestResult {
  if (!candles || candles.length < 50) {
    return createEmptyResult(params.accountBalance);
  }

  // Route to TradeLab Multi-Regime Engine (Phase 3)
  if (params.strategyType === 'tradelab_strategy') {
    return runTradeLabStrategyBacktest(candles, providedH1Candles, params, symbol, timeframe);
  }

  // Route to Strategy A: H1 Trend + M15 Rejection Backtesting Engine
  if (params.strategyType === 'strategy_a') {
    const stratAParams = params.strategyA || DEFAULT_STRATEGY_A_PARAMS;
    const mergedParams = {
      ...stratAParams,
      accountCapital: params.accountBalance,
      riskPercent: params.riskPercent,
      riskRewardRatio: params.riskRewardRatio || stratAParams.riskRewardRatio,
    };
    const stratAResult = runStrategyABacktest(candles, providedH1Candles || null, mergedParams, symbol);

    const mappedTrades: Trade[] = stratAResult.trades.map((st) => ({
      id: st.id,
      index: st.index,
      symbol: st.symbol,
      timeframe,
      direction: st.direction,
      signalTime: st.signalTime,
      signalIndex: st.signalIndex,
      entryTime: st.entryTime,
      entryPrice: st.entryPrice,
      entryIndex: st.entryIndex,
      exitTime: st.exitTime || 0,
      exitPrice: st.exitPrice || 0,
      exitIndex: st.exitIndex || 0,
      stopLoss: st.stopLossPrice,
      takeProfit: st.takeProfitPrice,
      initialRiskPips: st.riskPips,
      status: st.status,
      exitReason: st.exitReason,
      pnlPips: st.realizedPnlPips,
      pnlCurrency: Number((st.realizedR * st.riskAmount).toFixed(2)),
      pnlR: st.realizedR,
      holdingBars: st.holdingBars,
      riskAmount: st.riskAmount,
      signalReason: st.signalReason,
      h1Bias: st.h1Bias,
      m15Confirmation: st.m15Confirmation,
      riskRewardRatio: st.riskRewardRatio || params.riskRewardRatio,
      simultaneousTouchResolvedToSL: st.simultaneousTouchResolvedToSL,
    }));

    const costModel = {
      spreadPips: params.includeSpread ? params.spreadPips : 0,
      commissionPerLot: params.commissionPerLot ?? 7.0,
      slippagePips: params.slippagePips ?? 0.5,
    };

    const compiled = compileBacktestResults(mappedTrades, params.accountBalance, costModel);
    return {
      ...compiled,
      costModel,
      assumptions: STRATEGY_A_ASSUMPTIONS,
    };
  }

  const symbolMeta = FOREX_SYMBOLS[symbol] || FOREX_SYMBOLS['EUR/USD'];
  const pipSize = symbolMeta.pipSize;
  const digits = symbolMeta.digits;
  const spreadDelta = params.includeSpread ? params.spreadPips * pipSize : 0;

  // Pre-calculate indicators
  const fastEmaPoints = calculateEMA(candles, params.fastEma);
  const slowEmaPoints = calculateEMA(candles, params.slowEma);
  const trendEmaPoints = calculateEMA(candles, params.trendEma);
  const atrValues = calculateATR(candles, params.atrPeriod);
  const rsiPoints = calculateRSI(candles, params.rsiPeriod);
  const bbPoints = calculateBollingerBands(candles, 20, 2.0);

  // Map indicators by timestamp for fast O(1) lookup
  const fastEmaMap = new Map<number, number>();
  for (const p of fastEmaPoints) fastEmaMap.set(p.time, p.value);

  const slowEmaMap = new Map<number, number>();
  for (const p of slowEmaPoints) slowEmaMap.set(p.time, p.value);

  const trendEmaMap = new Map<number, number>();
  for (const p of trendEmaPoints) trendEmaMap.set(p.time, p.value);

  const rsiMap = new Map<number, number>();
  for (const p of rsiPoints) rsiMap.set(p.time, p.value);

  const bbMap = new Map<number, { upper: number; middle: number; lower: number }>();
  for (const p of bbPoints) bbMap.set(p.time, { upper: p.upper, middle: p.middle, lower: p.lower });

  const trades: Trade[] = [];
  let currentBalance = params.accountBalance;
  let activeTrade: Trade | null = null;
  let tradeCounter = 1;

  // Warmup period: ensure enough bars for slowest indicator
  const warmup = Math.max(params.trendEma, params.slowEma, params.atrPeriod, 30);

  for (let i = warmup; i < candles.length; i++) {
    const candle = candles[i];
    const prevCandle = candles[i - 1];

    // 1. Process Active Trade if any
    if (activeTrade) {
      activeTrade.holdingBars++;
      let isClosed = false;

      const isLong = activeTrade.direction === 'LONG' || activeTrade.direction === 'BUY';

      if (isLong) {
        // Trailing stop evaluation
        if (params.useTrailingStop) {
          const currentProfit = candle.high - activeTrade.entryPrice;
          const targetRDistance = activeTrade.initialRiskPips * pipSize * params.trailingStopTriggerR;
          if (currentProfit >= targetRDistance) {
            // Move SL to Breakeven (+0.1R cushion)
            const beLevel = activeTrade.entryPrice + activeTrade.initialRiskPips * pipSize * 0.1;
            if (activeTrade.stopLoss < beLevel) {
              activeTrade.stopLoss = Number(beLevel.toFixed(digits));
            }
          }
        }

        // Check Stop Loss hit
        if (candle.low <= activeTrade.stopLoss) {
          activeTrade.exitPrice = activeTrade.stopLoss;
          activeTrade.exitTime = candle.time;
          activeTrade.exitIndex = i;
          activeTrade.exitReason =
            activeTrade.stopLoss >= activeTrade.entryPrice ? 'TRAILING_STOP' : 'SL';
          isClosed = true;
        }
        // Check Take Profit hit
        else if (candle.high >= activeTrade.takeProfit) {
          activeTrade.exitPrice = activeTrade.takeProfit;
          activeTrade.exitTime = candle.time;
          activeTrade.exitIndex = i;
          activeTrade.exitReason = 'TP';
          isClosed = true;
        }
      } else {
        // SHORT trade evaluation
        if (params.useTrailingStop) {
          const currentProfit = activeTrade.entryPrice - candle.low;
          const targetRDistance = activeTrade.initialRiskPips * pipSize * params.trailingStopTriggerR;
          if (currentProfit >= targetRDistance) {
            // Move SL to Breakeven
            const beLevel = activeTrade.entryPrice - activeTrade.initialRiskPips * pipSize * 0.1;
            if (activeTrade.stopLoss > beLevel) {
              activeTrade.stopLoss = Number(beLevel.toFixed(digits));
            }
          }
        }

        // Check Stop Loss hit
        if (candle.high >= activeTrade.stopLoss) {
          activeTrade.exitPrice = activeTrade.stopLoss;
          activeTrade.exitTime = candle.time;
          activeTrade.exitIndex = i;
          activeTrade.exitReason =
            activeTrade.stopLoss <= activeTrade.entryPrice ? 'TRAILING_STOP' : 'SL';
          isClosed = true;
        }
        // Check Take Profit hit
        else if (candle.low <= activeTrade.takeProfit) {
          activeTrade.exitPrice = activeTrade.takeProfit;
          activeTrade.exitTime = candle.time;
          activeTrade.exitIndex = i;
          activeTrade.exitReason = 'TP';
          isClosed = true;
        }
      }

      if (isClosed) {
        // Calculate PnL and R
        finalizeTrade(activeTrade, pipSize, digits, currentBalance, params.riskPercent);
        currentBalance += activeTrade.pnlCurrency;
        trades.push(activeTrade);
        activeTrade = null;
      }
    }

    // 2. Generate New Entry Signal (if not currently holding a trade)
    if (!activeTrade && i < candles.length - 1) {
      const fastEma = fastEmaMap.get(candle.time);
      const slowEma = slowEmaMap.get(candle.time);
      const trendEma = trendEmaMap.get(candle.time) || slowEma;
      const prevFastEma = fastEmaMap.get(prevCandle.time);
      const prevSlowEma = slowEmaMap.get(prevCandle.time);
      const currentAtr = atrValues[i] || pipSize * 15;
      const rsi = rsiMap.get(candle.time) || 50;
      const prevRsi = rsiMap.get(prevCandle.time) || 50;
      const bb = bbMap.get(candle.time);

      let signal: 'LONG' | 'SHORT' | null = null;

      // Strategy A: EMA Trend Pullback
      if (params.strategyType === 'ema_pullback' && fastEma && slowEma && trendEma) {
        const isBullishTrend = fastEma > slowEma && candle.close > trendEma;
        const isBearishTrend = fastEma < slowEma && candle.close < trendEma;

        // Long trigger: in bullish trend, low touches or pierces fast EMA, but closes back above
        if (
          isBullishTrend &&
          candle.low <= fastEma &&
          candle.close > fastEma &&
          candle.close > candle.open
        ) {
          signal = 'LONG';
        }
        // Short trigger: in bearish trend, high touches or pierces fast EMA, but closes back below
        else if (
          isBearishTrend &&
          candle.high >= fastEma &&
          candle.close < fastEma &&
          candle.close < candle.open
        ) {
          signal = 'SHORT';
        }
      }

      // Strategy B: Breakout & Retest Channel
      else if (params.strategyType === 'breakout_retest') {
        const lookback = 20;
        let highestHigh = -Infinity;
        let lowestLow = Infinity;
        for (let k = i - lookback; k < i; k++) {
          if (candles[k].high > highestHigh) highestHigh = candles[k].high;
          if (candles[k].low < lowestLow) lowestLow = candles[k].low;
        }

        if (candle.close > highestHigh && prevCandle.close <= highestHigh) {
          signal = 'LONG';
        } else if (candle.close < lowestLow && prevCandle.close >= lowestLow) {
          signal = 'SHORT';
        }
      }

      // Strategy C: RSI Mean Reversion
      else if (params.strategyType === 'rsi_mean_reversion' && bb) {
        // Buy when RSI crosses back above oversold threshold and touched lower BB
        if (prevRsi <= params.rsiOversold && rsi > params.rsiOversold && candle.low <= bb.lower) {
          signal = 'LONG';
        }
        // Sell when RSI crosses back below overbought threshold and touched upper BB
        else if (
          prevRsi >= params.rsiOverbought &&
          rsi < params.rsiOverbought &&
          candle.high >= bb.upper
        ) {
          signal = 'SHORT';
        }
      }

      // Strategy D: MACD / Fast EMA Momentum Crossover
      else if (params.strategyType === 'macd_momentum' && fastEma && slowEma && prevFastEma && prevSlowEma) {
        const bullishCross = prevFastEma <= prevSlowEma && fastEma > slowEma;
        const bearishCross = prevFastEma >= prevSlowEma && fastEma < slowEma;

        if (bullishCross) signal = 'LONG';
        else if (bearishCross) signal = 'SHORT';
      }

      // If signal triggered, create trade order at candle close (+ spread on buy)
      if (signal) {
        const stopDistance = Math.max(currentAtr * params.atrStopMultiplier, pipSize * 5);
        const tpDistance = stopDistance * params.riskRewardRatio;

        const entryPrice =
          signal === 'LONG'
            ? Number((candle.close + spreadDelta).toFixed(digits))
            : Number((candle.close).toFixed(digits));

        const stopLoss =
          signal === 'LONG'
            ? Number((entryPrice - stopDistance).toFixed(digits))
            : Number((entryPrice + stopDistance + spreadDelta).toFixed(digits));

        const takeProfit =
          signal === 'LONG'
            ? Number((entryPrice + tpDistance).toFixed(digits))
            : Number((entryPrice - tpDistance).toFixed(digits));

        const initialRiskPips = Math.abs(entryPrice - stopLoss) / pipSize;
        const riskAmount = currentBalance * (params.riskPercent / 100);

        const signalDirection = signal === 'LONG' ? 'BUY' : 'SELL';
        activeTrade = {
          id: `TRD-${tradeCounter++}`,
          index: trades.length + 1,
          symbol,
          timeframe,
          direction: signalDirection,
          signalTime: candle.time,
          signalIndex: i,
          entryTime: candle.time,
          entryPrice,
          entryIndex: i,
          exitTime: 0,
          exitPrice: 0,
          exitIndex: 0,
          stopLoss,
          takeProfit,
          initialRiskPips: Number(initialRiskPips.toFixed(1)),
          status: 'UNRESOLVED',
          exitReason: 'UNRESOLVED',
          pnlPips: 0,
          pnlCurrency: 0,
          pnlR: 0,
          holdingBars: 0,
          riskAmount: Number(riskAmount.toFixed(2)),
          signalReason:
            params.strategyType === 'ema_pullback'
              ? `EMA Pullback: Retest of 20 EMA in ${signal === 'LONG' ? 'Bullish' : 'Bearish'} Trend`
              : params.strategyType === 'breakout_retest'
              ? `Channel Breakout: 20-bar ${signal === 'LONG' ? 'High' : 'Low'} exceeded`
              : params.strategyType === 'rsi_mean_reversion'
              ? `RSI Mean Reversion: Extreme rebound ${signal === 'LONG' ? 'Oversold' : 'Overbought'}`
              : `Momentum Crossover: Fast/Slow EMA shift`,
          h1Bias: signalDirection,
          m15Confirmation: `ATR ${currentAtr.toFixed(digits)} volatility stop (${params.atrStopMultiplier}x ATR)`,
          riskRewardRatio: params.riskRewardRatio,
        };
      }
    }
  }

  // Handle still-open trade at the end of data
  if (activeTrade) {
    const lastCandle = candles[candles.length - 1];
    activeTrade.exitTime = lastCandle.time;
    activeTrade.exitPrice = lastCandle.close;
    activeTrade.exitIndex = candles.length - 1;
    activeTrade.exitReason = 'OPEN';
    activeTrade.status = 'UNRESOLVED';
    finalizeTrade(activeTrade, pipSize, digits, currentBalance, params.riskPercent);
    trades.push(activeTrade);
  }

  const costModel = {
    spreadPips: params.includeSpread ? params.spreadPips : 0,
    commissionPerLot: params.commissionPerLot ?? 7.0,
    slippagePips: params.slippagePips ?? 0.5,
  };

  return compileBacktestResults(trades, params.accountBalance, costModel);
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
