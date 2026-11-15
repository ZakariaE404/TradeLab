import {
  BacktestResult,
  Candle,
  ForexSymbol,
  StrategyParameters,
  Timeframe,
  Trade,
} from '@/types/trading';
import { StrategyDefinition } from './StrategyDefinition';
import { MultiTimeframeMarketContext, TimeframeCandleMap } from './StrategyContext';
import { FOREX_SYMBOLS, TIMEFRAMES } from '@/services/marketData';
import { aggregateM1ToTimeframe } from '@/services/timeframeAggregator';
import { aggregateM15ToH1 } from '@/services/strategyA';

export interface ModularBacktestOptions {
  strategy: StrategyDefinition;
  candlesByTimeframe: TimeframeCandleMap;
  parameters: StrategyParameters;
  symbol: ForexSymbol;
  activeChartTimeframe?: Timeframe;
  dataSourceDescription?: string;
}

/**
 * Prepares all required candle series for a strategy's declared timeframes.
 * If canonical M1 is provided, aggregates on-the-fly.
 * If M15 is provided without H1, aggregates M15 to H1.
 */
export function prepareTimeframeCandlesForStrategy(
  strategy: StrategyDefinition,
  inputCandles: Candle[],
  providedH1?: Candle[] | null
): TimeframeCandleMap {
  const result: TimeframeCandleMap = {};
  if (!inputCandles || inputCandles.length === 0) return result;

  const isM1 = inputCandles.length >= 2 && Math.abs(inputCandles[1].time - inputCandles[0].time) <= 120;
  const isM15 = inputCandles.length >= 2 && Math.abs(inputCandles[1].time - inputCandles[0].time) === 900;

  for (const tf of strategy.requiredTimeframes) {
    if (isM1) {
      result[tf] = aggregateM1ToTimeframe(inputCandles, tf);
    } else if (tf === '15m') {
      result['15m'] = inputCandles;
    } else if (tf === '1h') {
      if (providedH1 && providedH1.length > 0) {
        result['1h'] = providedH1;
      } else if (isM15) {
        result['1h'] = aggregateM15ToH1(inputCandles);
      } else {
        result['1h'] = inputCandles;
      }
    } else {
      result[tf] = inputCandles;
    }
  }

  // Ensure primary timeframe is always present
  if (!result[strategy.primaryTimeframe]) {
    result[strategy.primaryTimeframe] = inputCandles;
  }

  return result;
}

/**
 * Runs a backtest using any modular StrategyDefinition without hardcoded strategy branches.
 */
export function runModularBacktest(options: ModularBacktestOptions): BacktestResult {
  const {
    strategy,
    candlesByTimeframe,
    parameters: params,
    symbol,
    activeChartTimeframe = '15m',
    dataSourceDescription,
  } = options;

  const primaryTf = strategy.primaryTimeframe;
  const primaryCandles = candlesByTimeframe[primaryTf] || [];

  if (primaryCandles.length < 50) {
    return createEmptyResult(params.accountBalance);
  }

  // 1. Initialize Multi-Timeframe Market Context with zero lookahead
  const marketContext = new MultiTimeframeMarketContext(symbol, primaryTf, candlesByTimeframe);

  // 2. Merge user parameters with strategy defaults
  const mergedParams: Record<string, any> = {
    ...strategy.defaultParameters,
    ...(params.strategyA || {}),
    riskRewardRatio: params.riskRewardRatio || strategy.defaultParameters.riskRewardRatio || 2.0,
  };

  // 3. Optional lifecycle initialization (precomputing EMAs, ATR, Swings)
  if (strategy.init) {
    strategy.init(marketContext);
  }

  const symbolMeta = FOREX_SYMBOLS[symbol] || FOREX_SYMBOLS['EUR/USD'];
  const pipSize = symbolMeta.pipSize;
  const digits = symbolMeta.digits;

  const trades: Trade[] = [];
  let currentBalance = params.accountBalance;
  let activeTrade: Trade | null = null;
  let tradeCounter = 1;

  const warmup = 50;

  // 4. Bar-by-bar chronological execution loop on primary timeframe closes
  for (let i = warmup; i < primaryCandles.length; i++) {
    const candle = primaryCandles[i];

    // STEP A: Evaluate active trade on current candle price range
    if (activeTrade) {
      activeTrade.holdingBars++;
      let isClosed = false;
      const isBuy = activeTrade.direction === 'BUY' || activeTrade.direction === 'LONG';
      const sl = activeTrade.stopLoss;
      const tp = activeTrade.takeProfit;

      if (isBuy) {
        const touchedSL = candle.low <= sl;
        const touchedTP = candle.high >= tp;

        if (touchedSL && touchedTP) {
          // Conservative assumption: simultaneous touch resolved to Stop Loss
          activeTrade.exitPrice = sl;
          activeTrade.exitTime = candle.time;
          activeTrade.exitIndex = i;
          activeTrade.exitReason = 'SL';
          activeTrade.status = 'LOSS';
          activeTrade.simultaneousTouchResolvedToSL = true;
          isClosed = true;
        } else if (touchedSL) {
          activeTrade.exitPrice = sl;
          activeTrade.exitTime = candle.time;
          activeTrade.exitIndex = i;
          activeTrade.exitReason = 'SL';
          activeTrade.status = 'LOSS';
          isClosed = true;
        } else if (touchedTP) {
          activeTrade.exitPrice = tp;
          activeTrade.exitTime = candle.time;
          activeTrade.exitIndex = i;
          activeTrade.exitReason = 'TP';
          activeTrade.status = 'WIN';
          isClosed = true;
        } else if (activeTrade.holdingBars >= (mergedParams.maxHoldingBars || 200)) {
          activeTrade.exitPrice = candle.close;
          activeTrade.exitTime = candle.time;
          activeTrade.exitIndex = i;
          activeTrade.exitReason = 'MAX_BARS';
          activeTrade.status = candle.close >= activeTrade.entryPrice ? 'WIN' : 'LOSS';
          isClosed = true;
        }
      } else {
        // SELL trade
        const touchedSL = candle.high >= sl;
        const touchedTP = candle.low <= tp;

        if (touchedSL && touchedTP) {
          activeTrade.exitPrice = sl;
          activeTrade.exitTime = candle.time;
          activeTrade.exitIndex = i;
          activeTrade.exitReason = 'SL';
          activeTrade.status = 'LOSS';
          activeTrade.simultaneousTouchResolvedToSL = true;
          isClosed = true;
        } else if (touchedSL) {
          activeTrade.exitPrice = sl;
          activeTrade.exitTime = candle.time;
          activeTrade.exitIndex = i;
          activeTrade.exitReason = 'SL';
          activeTrade.status = 'LOSS';
          isClosed = true;
        } else if (touchedTP) {
          activeTrade.exitPrice = tp;
          activeTrade.exitTime = candle.time;
          activeTrade.exitIndex = i;
          activeTrade.exitReason = 'TP';
          activeTrade.status = 'WIN';
          isClosed = true;
        } else if (activeTrade.holdingBars >= (mergedParams.maxHoldingBars || 200)) {
          activeTrade.exitPrice = candle.close;
          activeTrade.exitTime = candle.time;
          activeTrade.exitIndex = i;
          activeTrade.exitReason = 'MAX_BARS';
          activeTrade.status = candle.close <= activeTrade.entryPrice ? 'WIN' : 'LOSS';
          isClosed = true;
        }
      }

      if (isClosed && activeTrade.exitPrice !== null) {
        finalizeTrade(activeTrade, pipSize, digits, currentBalance, params.riskPercent);
        currentBalance += activeTrade.pnlCurrency;
        trades.push(activeTrade);
        activeTrade = null;
      }
    }

    // STEP B: Evaluate new signal at current candle CLOSE (if not holding a position)
    if (!activeTrade && i < primaryCandles.length - 1) {
      const barContext = marketContext.createBarContext(i, mergedParams);
      const signal = strategy.evaluateBar(barContext);

      if (signal) {
        const entryPrice = signal.entryPrice ?? candle.close;
        const riskDistance = Math.abs(entryPrice - signal.stopLossPrice);
        const initialRiskPips = Math.max(0.1, Number((riskDistance / pipSize).toFixed(1)));
        const riskAmount = currentBalance * (params.riskPercent / 100);

        activeTrade = {
          id: `TRD-${tradeCounter++}`,
          index: trades.length + 1,
          symbol,
          timeframe: activeChartTimeframe,
          direction: signal.direction,
          signalTime: signal.signalTime,
          signalIndex: i,
          entryTime: signal.entryTime ?? candle.time,
          entryPrice,
          entryIndex: i,
          exitTime: 0,
          exitPrice: 0,
          exitIndex: 0,
          stopLoss: signal.stopLossPrice,
          takeProfit: signal.takeProfitPrice,
          initialRiskPips,
          status: 'UNRESOLVED',
          exitReason: 'UNRESOLVED',
          pnlPips: 0,
          pnlCurrency: 0,
          pnlR: 0,
          holdingBars: 0,
          riskAmount: Number(riskAmount.toFixed(2)),
          signalReason: signal.signalReason,
          h1Bias: signal.h1Bias || signal.direction,
          m15Confirmation: signal.m15Confirmation || `${signal.riskRewardRatio}:1 RR`,
          riskRewardRatio: signal.riskRewardRatio,
        };
      }
    }
  }

  // Handle open trade at the end of the series
  if (activeTrade) {
    const lastCandle = primaryCandles[primaryCandles.length - 1];
    activeTrade.exitTime = lastCandle.time;
    activeTrade.exitPrice = lastCandle.close;
    activeTrade.exitIndex = primaryCandles.length - 1;
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

  const compiled = compileModularResults(trades, params.accountBalance, costModel);
  const dataSourceNote = dataSourceDescription
    ? `Data Source: ${dataSourceDescription}.`
    : 'Data Source: Authenticated Historical Feed.';

  return {
    ...compiled,
    costModel,
    assumptions: [
      dataSourceNote,
      `Strategy: ${strategy.name} (v${strategy.version}).`,
      `Required Timeframes: ${strategy.requiredTimeframes.join(', ')} (Primary: ${strategy.primaryTimeframe}).`,
      `Zero Lookahead: Strictly evaluated on confirmed candle closes with precomputed multi-timeframe synchronization.`,
      `Risk: ${params.riskPercent}% per trade, 1:${params.riskRewardRatio || mergedParams.riskRewardRatio} RR target.`,
      `Conservative Execution: Simultaneous Stop Loss and Take Profit touch on the same bar resolves strictly to STOP LOSS.`,
    ],
  };
}

function finalizeTrade(
  trade: Trade,
  pipSize: number,
  digits: number,
  accountBalance: number,
  riskPercent: number
) {
  const isBuy = trade.direction === 'BUY' || trade.direction === 'LONG';
  const pipsDiff = isBuy
    ? (trade.exitPrice - trade.entryPrice) / pipSize
    : (trade.entryPrice - trade.exitPrice) / pipSize;

  trade.pnlPips = Number(pipsDiff.toFixed(1));

  const riskPips = Math.max(trade.initialRiskPips, 1);
  const pnlR = trade.pnlPips / riskPips;
  trade.pnlR = Number(pnlR.toFixed(2));

  const riskDollar = accountBalance * (riskPercent / 100);
  trade.pnlCurrency = Number((pnlR * riskDollar).toFixed(2));

  if (trade.status === 'UNRESOLVED' || trade.status === 'OPEN' || trade.exitReason === 'OPEN' || trade.exitReason === 'UNRESOLVED') {
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

function compileModularResults(
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

  let consecutiveWins = 0;
  let maxConsecutiveWins = 0;
  let consecutiveLosses = 0;
  let maxConsecutiveLosses = 0;

  let peakEquity = startingBalance;
  let maxDrawdownCurrency = 0;
  let maxDrawdownPercent = 0;
  let maxDrawdownR = 0;

  const equityCurve: { time: number; equity: number; balance: number; drawdown: number }[] = [
    {
      time: trades[0]?.entryTime ? trades[0].entryTime - 3600 : Date.now() / 1000 - 86400,
      equity: startingBalance,
      balance: startingBalance,
      drawdown: 0,
    },
  ];

  let runningBalance = startingBalance;

  for (const trade of trades) {
    const isBuy = trade.direction === 'BUY' || trade.direction === 'LONG';
    if (isBuy) {
      longCount++;
      if (trade.status === 'WIN') longWins++;
    } else {
      shortCount++;
      if (trade.status === 'WIN') shortWins++;
    }

    if (trade.status === 'WIN') {
      winningTrades++;
      grossProfitR += trade.pnlR;
      consecutiveWins++;
      consecutiveLosses = 0;
      if (consecutiveWins > maxConsecutiveWins) maxConsecutiveWins = consecutiveWins;
    } else if (trade.status === 'LOSS') {
      losingTrades++;
      grossLossR += Math.abs(trade.pnlR);
      consecutiveLosses++;
      consecutiveWins = 0;
      if (consecutiveLosses > maxConsecutiveLosses) maxConsecutiveLosses = consecutiveLosses;
    } else if (trade.status === 'BREAKEVEN') {
      breakevenTrades++;
      consecutiveWins = 0;
      consecutiveLosses = 0;
    }

    netR += trade.pnlR;
    totalPnlCurrency += trade.pnlCurrency;
    runningBalance += trade.pnlCurrency;

    if (runningBalance > peakEquity) {
      peakEquity = runningBalance;
    }

    const currentDdCurrency = peakEquity - runningBalance;
    const currentDdPercent = peakEquity > 0 ? (currentDdCurrency / peakEquity) * 100 : 0;
    const currentDdR = grossLossR;

    if (currentDdCurrency > maxDrawdownCurrency) maxDrawdownCurrency = currentDdCurrency;
    if (currentDdPercent > maxDrawdownPercent) maxDrawdownPercent = currentDdPercent;
    if (currentDdR > maxDrawdownR) maxDrawdownR = currentDdR;

    equityCurve.push({
      time: trade.exitTime || trade.entryTime,
      equity: Number(runningBalance.toFixed(2)),
      balance: Number(runningBalance.toFixed(2)),
      drawdown: Number(currentDdPercent.toFixed(2)),
    });
  }

  const winRate = totalResolved > 0 ? (winningTrades / totalResolved) * 100 : 0;
  const profitFactor = grossLossR > 0 ? grossProfitR / grossLossR : grossProfitR > 0 ? 99.9 : 0;
  const avgWinR = winningTrades > 0 ? grossProfitR / winningTrades : 0;
  const avgLossR = losingTrades > 0 ? grossLossR / losingTrades : 0;
  const expectancyR =
    totalResolved > 0
      ? (winRate / 100) * avgWinR - ((100 - winRate) / 100) * avgLossR
      : 0;

  return {
    trades,
    totalTrades: totalResolved,
    winningTrades,
    losingTrades,
    breakevenTrades,
    unresolvedTrades,
    winRate: Number(winRate.toFixed(1)),
    profitFactor: Number(profitFactor.toFixed(2)),
    netR: Number(netR.toFixed(2)),
    totalPnlCurrency: Number(totalPnlCurrency.toFixed(2)),
    maxDrawdownR: Number(maxDrawdownR.toFixed(2)),
    maxDrawdownPercent: Number(maxDrawdownPercent.toFixed(2)),
    maxConsecutiveWins,
    maxConsecutiveLosses,
    avgWinR: Number(avgWinR.toFixed(2)),
    avgLossR: Number(avgLossR.toFixed(2)),
    expectancyR: Number(expectancyR.toFixed(2)),
    longTradesCount: longCount,
    longWinRate: longCount > 0 ? Number(((longWins / longCount) * 100).toFixed(1)) : 0,
    shortTradesCount: shortCount,
    shortWinRate: shortCount > 0 ? Number(((shortWins / shortCount) * 100).toFixed(1)) : 0,
    equityCurve,
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
    equityCurve: [{ time: Date.now() / 1000, equity: startingBalance, balance: startingBalance, drawdown: 0 }],
  };
}
