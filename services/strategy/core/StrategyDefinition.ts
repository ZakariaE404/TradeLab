import { Timeframe } from '@/types/trading';
import { ParameterDefinition, StrategyMetadata, StrategySignal } from './StrategyTypes';
import { MultiTimeframeMarketContext, StrategyBarContext } from './StrategyContext';

export interface StrategyDefinition<P extends Record<string, any> = Record<string, any>>
  extends StrategyMetadata {
  /** Parameter metadata for auto-generating UI settings */
  parameterSchema: ParameterDefinition[];

  /** Default values for all strategy parameters */
  defaultParameters: P;

  /**
   * Optional initialization hook called once before the evaluation loop starts.
   * Useful for precomputing series-wide indicators (e.g. EMAs, ATR, ADX).
   */
  init?(marketContext: MultiTimeframeMarketContext<P>): void;

  /**
   * Bar-by-bar evaluation hook executed at the close of every primary timeframe candle.
   * Receives StrategyBarContext which gives O(1), zero-lookahead access to all declared timeframes.
   * Returns a StrategySignal if entry conditions are met, or null otherwise.
   */
  evaluateBar(context: StrategyBarContext<P>): StrategySignal | null;
}
