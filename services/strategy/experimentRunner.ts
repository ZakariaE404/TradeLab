import { HistoricalDataset } from '@/types/trading';
import { ConfirmedSwingPoint } from '@/types/strategyA';
import { SimulationConfig, SimulationResult } from '@/types/simulation';
import { StrategyConfiguration } from './types';
import { TradeLabStrategyEngine } from './strategyRules';
import { runHistoricalSimulation } from '../simulationEngine';
import { detectConfirmedSwings } from './supportResistance';

export interface StrategyExperimentResult {
  id: string;
  label: string;
  regime: 'TRENDING' | 'RANGING';
  pattern: 'REJECTION' | 'ENGULFING';
  direction: 'BUY' | 'SELL';
  config: StrategyConfiguration;
  result: SimulationResult;
}

export interface StrategyExperimentSuite {
  baseConfig: StrategyConfiguration;
  experiments: StrategyExperimentResult[];
  totalExperiments: number;
  primaryResult: SimulationResult;
}

/**
 * Runs independent strategy experiments without merging equity curves or polluting trade histories.
 * When the user selects 'BOTH' for regime, pattern, or direction, permutations are executed as
 * completely isolated backtests with distinct IDs, performance statistics, and diagnostics.
 */
export function runStrategyExperiments(params: {
  dataset: HistoricalDataset;
  strategyConfig: StrategyConfiguration;
  simulationConfig: SimulationConfig;
  swings?: ConfirmedSwingPoint[];
}): StrategyExperimentSuite {
  const { dataset, strategyConfig, simulationConfig } = params;

  // Pre-calculate or reuse confirmed swing points on M15 candles
  const swings =
    params.swings && params.swings.length > 0
      ? params.swings
      : detectConfirmedSwings(
          dataset.m15Candles,
          strategyConfig.swingLeftBars || 3,
          strategyConfig.swingRightBars || 3
        );

  const regimes: Array<'TRENDING' | 'RANGING'> =
    strategyConfig.regime === 'BOTH'
      ? ['TRENDING', 'RANGING']
      : [strategyConfig.regime as 'TRENDING' | 'RANGING'];

  const patterns: Array<'REJECTION' | 'ENGULFING'> =
    strategyConfig.pattern === 'BOTH'
      ? ['REJECTION', 'ENGULFING']
      : [strategyConfig.pattern as 'REJECTION' | 'ENGULFING'];

  const directions: Array<'BUY' | 'SELL'> =
    strategyConfig.direction === 'BOTH'
      ? ['BUY', 'SELL']
      : [strategyConfig.direction as 'BUY' | 'SELL'];

  const experiments: StrategyExperimentResult[] = [];

  for (const regime of regimes) {
    for (const pattern of patterns) {
      for (const direction of directions) {
        const expId = `EXP_${regime}_${pattern}_${direction}`;
        const label = `${formatTitle(regime)} + ${formatTitle(pattern)} (${direction})`;

        const discreteConfig: StrategyConfiguration = {
          ...strategyConfig,
          id: expId,
          name: label,
          regime,
          pattern,
          direction,
        };

        const engine = new TradeLabStrategyEngine(discreteConfig, expId, label);

        const simResult = runHistoricalSimulation({
          dataset,
          signalGenerator: engine,
          config: simulationConfig,
          swings,
        });

        experiments.push({
          id: expId,
          label,
          regime,
          pattern,
          direction,
          config: discreteConfig,
          result: simResult,
        });
      }
    }
  }

  // Primary result is the first experiment
  const primaryResult = experiments[0]?.result || {
    trades: [],
    equityCurve: [],
    performance: {
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
    },
    diagnostics: {
      warmUpConfidence: 'STABILIZED',
      warnings: [],
      assumptions: [],
      totalBarsEvaluated: 0,
      totalSignalsGenerated: 0,
      totalTradesExecuted: 0,
      rejectedSignalsCount: 0,
      unexecutedFinalBarSignalsCount: 0,
      openTradesAtEndCount: 0,
      simultaneousTouchCount: 0,
      instrumentMetadata: {
        symbol: dataset.symbol,
        name: String(dataset.symbol),
        pipSize: 0.1,
        pipMultiplier: 10,
        contractSize: 100,
        digits: 2,
        isKnownInstrument: true,
      },
      evaluationStartTime: 0,
      evaluationEndTime: 0,
    },
  };

  return {
    baseConfig: strategyConfig,
    experiments,
    totalExperiments: experiments.length,
    primaryResult,
  };
}

function formatTitle(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1).toLowerCase();
}
