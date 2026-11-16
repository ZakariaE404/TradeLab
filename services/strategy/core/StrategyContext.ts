import { Candle, ForexSymbol, Timeframe } from '@/types/trading';
import {
  getLatestClosedHigherTimeframeIndex,
  assertNoLookaheadGeneric,
} from '@/services/multiTimeframeSync';
import { TIMEFRAMES } from '@/services/marketData';
import { normalizeTimeframeId, TIMEFRAME_SPECS } from '@/services/timeframeAggregator';
import { ExplicitTimeframeDataset } from './StrategyTypes';

export type TimeframeCandleMap = Partial<Record<Timeframe, Candle[]>>;

export type DatasetInput =
  | TimeframeCandleMap
  | ExplicitTimeframeDataset[]
  | Record<string, ExplicitTimeframeDataset | Candle[]>;

export interface StrategyBarContext<P extends Record<string, any> = Record<string, any>> {
  symbol: ForexSymbol;
  primaryTimeframe: Timeframe;
  currentIndex: number;
  currentCandle: Candle;
  currentTime: number;
  evaluationTime: number; // Candle close timestamp
  parameters: P;

  // Multi-Timeframe Accessors (Strict Zero-Lookahead)
  getLatestClosedCandle(timeframe: Timeframe | string): Candle | null;
  getClosedCandles(timeframe: Timeframe | string, count?: number): Candle[];
  getLatestClosedIndex(timeframe: Timeframe | string): number;
  getPrimaryHistory(count?: number): Candle[];

  // Indicator lookup by timestamp (O(1))
  getIndicatorValue<T = number>(indicatorName: string, timeframe?: Timeframe | string): T | null;
}

/**
 * Validates and normalizes any timeframe identifier, throwing an explicit error if unknown.
 */
export function validateAndNormalizeTimeframe(rawTf: string): Timeframe {
  if (!rawTf || typeof rawTf !== 'string') {
    throw new Error(`[MultiTimeframeMarketContext] Timeframe identifier must be a non-empty string. Received: ${JSON.stringify(rawTf)}`);
  }
  const lower = rawTf.toLowerCase().trim();
  if (!TIMEFRAME_SPECS[lower] && lower !== '1d' && lower !== '1w') {
    throw new Error(
      `[MultiTimeframeMarketContext] Unknown or unsupported timeframe: "${rawTf}". Known timeframes are: 1m, 5m, 15m, 30m, 1h, 4h, 1D, 1W (or M1, M5, M15, M30, H1, H4, D1, W1).`
    );
  }
  return normalizeTimeframeId(rawTf);
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
    primaryTimeframe: Timeframe | string,
    candleDatasets: DatasetInput
  ) {
    this.symbol = symbol;
    this.primaryTimeframe = validateAndNormalizeTimeframe(primaryTimeframe);
    this.candlesByTimeframe = new Map();

    if (Array.isArray(candleDatasets)) {
      // Array of ExplicitTimeframeDataset objects
      for (const item of candleDatasets) {
        if (!item || typeof item !== 'object' || !item.timeframe || !Array.isArray(item.candles)) {
          throw new Error(
            `[MultiTimeframeMarketContext] Invalid ExplicitTimeframeDataset element. Expected { timeframe: string, candles: Candle[] }.`
          );
        }
        const normTf = validateAndNormalizeTimeframe(item.timeframe);
        this.candlesByTimeframe.set(normTf, item.candles);
      }
    } else if (candleDatasets && typeof candleDatasets === 'object') {
      // Record/Map of timeframe -> candles or ExplicitTimeframeDataset
      for (const [key, val] of Object.entries(candleDatasets)) {
        if (!val) continue;
        if (Array.isArray(val)) {
          const normTf = validateAndNormalizeTimeframe(key);
          this.candlesByTimeframe.set(normTf, val);
        } else if (typeof val === 'object' && 'timeframe' in val && Array.isArray((val as any).candles)) {
          const explicitItem = val as ExplicitTimeframeDataset;
          const normTf = validateAndNormalizeTimeframe(explicitItem.timeframe);
          this.candlesByTimeframe.set(normTf, explicitItem.candles);
        } else {
          throw new Error(
            `[MultiTimeframeMarketContext] Invalid dataset entry for key "${key}". Expected Candle[] or ExplicitTimeframeDataset.`
          );
        }
      }
    } else {
      throw new Error(`[MultiTimeframeMarketContext] Invalid candleDatasets input provided.`);
    }

    this.primaryCandles = this.candlesByTimeframe.get(this.primaryTimeframe) || [];
    this.primarySeconds = TIMEFRAMES[this.primaryTimeframe]?.seconds || 900;
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
      const higherSeconds = TIMEFRAMES[tf]?.seconds || TIMEFRAME_SPECS[tf]?.seconds || 3600;

      for (let i = 0; i < primaryLen; i++) {
        const primaryBar = this.primaryCandles[i];
        // Standard close evaluation: evaluation occurs at the close of the primary bar
        const closedIdx = getLatestClosedHigherTimeframeIndex(
          primaryBar.time,
          higherCandles,
          this.primarySeconds,
          higherSeconds,
          'close'
        );

        indices[i] = closedIdx;

        // Double check no-lookahead assertion
        if (closedIdx >= 0) {
          const closedHigherBar = higherCandles[closedIdx];
          assertNoLookaheadGeneric(
            primaryBar.time,
            closedHigherBar,
            this.primarySeconds,
            higherSeconds,
            'close'
          );
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

      getLatestClosedCandle(timeframe: Timeframe | string): Candle | null {
        const normTf = validateAndNormalizeTimeframe(timeframe);
        if (normTf === self.primaryTimeframe) {
          return currentCandle;
        }

        const indices = self.syncIndices.get(normTf);
        if (!indices || index >= indices.length) return null;

        const higherIdx = indices[index];
        if (higherIdx < 0) return null;

        const higherCandles = self.candlesByTimeframe.get(normTf);
        return higherCandles ? higherCandles[higherIdx] : null;
      },

      getClosedCandles(timeframe: Timeframe | string, count?: number): Candle[] {
        const normTf = validateAndNormalizeTimeframe(timeframe);
        if (normTf === self.primaryTimeframe) {
          const start = count !== undefined ? Math.max(0, index + 1 - count) : 0;
          return self.primaryCandles.slice(start, index + 1);
        }

        const indices = self.syncIndices.get(normTf);
        if (!indices || index >= indices.length) return [];

        const higherIdx = indices[index];
        if (higherIdx < 0) return [];

        const higherCandles = self.candlesByTimeframe.get(normTf);
        if (!higherCandles) return [];

        const start = count !== undefined ? Math.max(0, higherIdx + 1 - count) : 0;
        return higherCandles.slice(start, higherIdx + 1);
      },

      getLatestClosedIndex(timeframe: Timeframe | string): number {
        const normTf = validateAndNormalizeTimeframe(timeframe);
        if (normTf === self.primaryTimeframe) return index;
        const indices = self.syncIndices.get(normTf);
        if (!indices || index >= indices.length) return -1;
        return indices[index];
      },

      getPrimaryHistory(count?: number): Candle[] {
        const start = count !== undefined ? Math.max(0, index + 1 - count) : 0;
        return self.primaryCandles.slice(start, index + 1);
      },

      getIndicatorValue<T = number>(indicatorName: string, timeframe: Timeframe | string = self.primaryTimeframe): T | null {
        const normTf = validateAndNormalizeTimeframe(timeframe);
        const key = `${indicatorName}_${normTf}`;
        const map = self.indicatorMaps.get(key);
        if (!map) return null;

        if (normTf === self.primaryTimeframe) {
          return (map.get(currentCandle.time) ?? null) as T | null;
        }

        const closedHigherCandle = this.getLatestClosedCandle(normTf);
        if (!closedHigherCandle) return null;

        return (map.get(closedHigherCandle.time) ?? null) as T | null;
      },
    };
  }
}
