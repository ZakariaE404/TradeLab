import { Candle, ForexSymbol, Timeframe } from '@/types/trading';
import { getLatestClosedH1Index, assertNoLookahead } from '@/services/multiTimeframeSync';
import { TIMEFRAMES } from '@/services/marketData';

export type TimeframeCandleMap = Partial<Record<Timeframe, Candle[]>>;

export interface StrategyBarContext<P extends Record<string, any> = Record<string, any>> {
  symbol: ForexSymbol;
  primaryTimeframe: Timeframe;
  currentIndex: number;
  currentCandle: Candle;
  currentTime: number;
  evaluationTime: number; // Candle close timestamp
  parameters: P;

  // Multi-Timeframe Accessors (Strict Zero-Lookahead)
  getLatestClosedCandle(timeframe: Timeframe): Candle | null;
  getClosedCandles(timeframe: Timeframe, count?: number): Candle[];
  getLatestClosedIndex(timeframe: Timeframe): number;
  getPrimaryHistory(count?: number): Candle[];

  // Indicator lookup by timestamp (O(1))
  getIndicatorValue<T = number>(indicatorName: string, timeframe?: Timeframe): T | null;
}

/**
 * Precomputed Multi-Timeframe Synchronization Manager
 * Maps primary timeframe bar indices to completed higher timeframe bar indices in O(1) time.
 */
export class MultiTimeframeMarketContext<P extends Record<string, any> = Record<string, any>> {
  readonly symbol: ForexSymbol;
  readonly primaryTimeframe: Timeframe;
  readonly requiredTimeframes: Timeframe[];
  readonly candlesByTimeframe: Map<Timeframe, Candle[]>;
  readonly primaryCandles: Candle[];
  readonly primarySeconds: number;

  // Precomputed index map: higherTf -> array of indices matching primaryCandles index
  private syncIndices: Map<Timeframe, Int32Array> = new Map();

  // Registered indicator maps: indicatorKey -> Map<time, value>
  private indicatorMaps: Map<string, Map<number, any>> = new Map();

  constructor(
    symbol: ForexSymbol,
    primaryTimeframe: Timeframe,
    candlesByTimeframe: TimeframeCandleMap
  ) {
    this.symbol = symbol;
    this.primaryTimeframe = primaryTimeframe;
    this.candlesByTimeframe = new Map();

    for (const [tf, candles] of Object.entries(candlesByTimeframe)) {
      if (candles && Array.isArray(candles)) {
        this.candlesByTimeframe.set(tf as Timeframe, candles);
      }
    }

    this.primaryCandles = this.candlesByTimeframe.get(primaryTimeframe) || [];
    this.primarySeconds = TIMEFRAMES[primaryTimeframe]?.seconds || 900;
    this.requiredTimeframes = Array.from(this.candlesByTimeframe.keys());

    this.precomputeSynchronizationMaps();
  }

  /**
   * Precomputes exact synchronized indices between primary timeframe and all higher timeframes.
   * Guarantees strict zero lookahead with O(1) retrieval during evaluation loop.
   */
  private precomputeSynchronizationMaps(): void {
    const primaryLen = this.primaryCandles.length;

    for (const [tf, higherCandles] of this.candlesByTimeframe.entries()) {
      if (tf === this.primaryTimeframe) continue;

      const indices = new Int32Array(primaryLen);
      const higherSeconds = TIMEFRAMES[tf]?.seconds || 3600;

      for (let i = 0; i < primaryLen; i++) {
        const primaryBar = this.primaryCandles[i];
        // Standard close evaluation: evaluation occurs at the close of the primary bar
        const closedIdx = getLatestClosedH1Index(
          primaryBar.time,
          higherCandles,
          this.primarySeconds,
          'close'
        );

        indices[i] = closedIdx;

        // Double check no-lookahead assertion
        if (closedIdx >= 0) {
          const closedHigherBar = higherCandles[closedIdx];
          assertNoLookahead(primaryBar.time, closedHigherBar, this.primarySeconds, 'close');
        }
      }

      this.syncIndices.set(tf, indices);
    }
  }

  /**
   * Register a precomputed indicator map (e.g. EMA 50, EMA 200, ATR 14) for O(1) lookup
   */
  public registerIndicatorMap(name: string, timeframe: Timeframe, map: Map<number, any>): void {
    const key = `${name}_${timeframe}`;
    this.indicatorMaps.set(key, map);
  }

  /**
   * Factory method to create an immutable bar context for index `i` of the primary timeframe
   */
  public createBarContext(index: number, parameters: P): StrategyBarContext<P> {
    const currentCandle = this.primaryCandles[index];
    const evaluationTime = currentCandle.time + this.primarySeconds;
    const self = this;

    return {
      symbol: self.symbol,
      primaryTimeframe: self.primaryTimeframe,
      currentIndex: index,
      currentCandle,
      currentTime: currentCandle.time,
      evaluationTime,
      parameters,

      getLatestClosedCandle(timeframe: Timeframe): Candle | null {
        if (timeframe === self.primaryTimeframe) {
          return currentCandle;
        }

        const indices = self.syncIndices.get(timeframe);
        if (!indices || index >= indices.length) return null;

        const higherIdx = indices[index];
        if (higherIdx < 0) return null;

        const higherCandles = self.candlesByTimeframe.get(timeframe);
        return higherCandles ? higherCandles[higherIdx] : null;
      },

      getClosedCandles(timeframe: Timeframe, count?: number): Candle[] {
        if (timeframe === self.primaryTimeframe) {
          const start = count !== undefined ? Math.max(0, index + 1 - count) : 0;
          return self.primaryCandles.slice(start, index + 1);
        }

        const indices = self.syncIndices.get(timeframe);
        if (!indices || index >= indices.length) return [];

        const higherIdx = indices[index];
        if (higherIdx < 0) return [];

        const higherCandles = self.candlesByTimeframe.get(timeframe);
        if (!higherCandles) return [];

        const start = count !== undefined ? Math.max(0, higherIdx + 1 - count) : 0;
        return higherCandles.slice(start, higherIdx + 1);
      },

      getLatestClosedIndex(timeframe: Timeframe): number {
        if (timeframe === self.primaryTimeframe) return index;
        const indices = self.syncIndices.get(timeframe);
        if (!indices || index >= indices.length) return -1;
        return indices[index];
      },

      getPrimaryHistory(count?: number): Candle[] {
        const start = count !== undefined ? Math.max(0, index + 1 - count) : 0;
        return self.primaryCandles.slice(start, index + 1);
      },

      getIndicatorValue<T = number>(indicatorName: string, timeframe: Timeframe = self.primaryTimeframe): T | null {
        const key = `${indicatorName}_${timeframe}`;
        const map = self.indicatorMaps.get(key);
        if (!map) return null;

        if (timeframe === self.primaryTimeframe) {
          return (map.get(currentCandle.time) ?? null) as T | null;
        }

        const closedHigherCandle = this.getLatestClosedCandle(timeframe);
        if (!closedHigherCandle) return null;

        return (map.get(closedHigherCandle.time) ?? null) as T | null;
      },
    };
  }
}
