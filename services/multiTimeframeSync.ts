import { Candle } from '@/types/trading';

export interface MultiTimeframeSyncOptions {
  m15IntervalSeconds?: number; // default 900 (15 min)
  h1IntervalSeconds?: number;  // default 3600 (1 hour)
  evaluationPoint?: 'open' | 'close'; // default 'close'
}

export interface SynchronizedBar {
  m15: Candle;
  m15Index: number;
  completedH1: Candle | null;
  completedH1Index: number;
  completedH1CloseTime: number | null;
  isLookaheadFree: boolean;
}

/**
 * Finds the latest completed higher-timeframe candle index for a lower-timeframe candle timestamp.
 * - Generic multi-timeframe synchronization: works for any timeframe pair (M15-H1, M15-H4, M5-H1, etc.).
 * - A higher-timeframe candle opening at T completes at T + higherIntervalSeconds.
 * - Under standard close evaluation, the latest completed HTF candle must have closed at or before lowerCandleTime + lowerIntervalSeconds.
 * - Under open evaluation, the latest completed HTF candle must have closed at or before lowerCandleTime.
 * - Strict Zero Lookahead: Never returns an in-progress or forming candle.
 * - Uses binary search O(log N) over sorted higher-timeframe candles.
 * - Handles weekend gaps, market closures, and missing candles safely.
 */
export function getLatestClosedHigherTimeframeIndex(
  lowerCandleTime: number,
  higherCandles: Candle[],
  lowerIntervalSeconds: number,
  higherIntervalSeconds: number,
  evaluationPoint: 'open' | 'close' = 'close'
): number {
  if (!higherCandles || higherCandles.length === 0) return -1;

  const targetLimitTime =
    evaluationPoint === 'open'
      ? lowerCandleTime
      : lowerCandleTime + lowerIntervalSeconds;

  let low = 0;
  let high = higherCandles.length - 1;
  let bestIdx = -1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const higherCloseTime = higherCandles[mid].time + higherIntervalSeconds;

    if (higherCloseTime <= targetLimitTime) {
      bestIdx = mid;
      low = mid + 1; // Look for a more recent completed candle
    } else {
      high = mid - 1;
    }
  }

  return bestIdx;
}

/**
 * Finds the latest completed H1 candle index for an M15 candle timestamp (3600s H1 duration).
 */
export function getLatestClosedH1Index(
  m15CandleTime: number,
  h1Candles: Candle[],
  candleIntervalSeconds: number = 900,
  evaluationPoint: 'open' | 'close' = 'close'
): number {
  return getLatestClosedHigherTimeframeIndex(
    m15CandleTime,
    h1Candles,
    candleIntervalSeconds,
    3600,
    evaluationPoint
  );
}

/**
 * Returns the latest completed H1 candle for a given M15 candle, or null if none completed yet.
 */
export function getLatestCompletedH1Candle(
  m15CandleTime: number,
  h1Candles: Candle[],
  options: MultiTimeframeSyncOptions = {}
): Candle | null {
  const m15Seconds = options.m15IntervalSeconds ?? 900;
  const evalPoint = options.evaluationPoint ?? 'close';
  const idx = getLatestClosedH1Index(m15CandleTime, h1Candles, m15Seconds, evalPoint);
  if (idx < 0 || idx >= h1Candles.length) return null;
  return h1Candles[idx];
}

/**
 * Validates that a higher-timeframe candle was strictly completed before or at the evaluation time limit.
 * Throws an explicit Error if lookahead bias is detected.
 */
export function assertNoLookaheadGeneric(
  lowerCandleTime: number,
  higherCandle: Candle | null,
  lowerIntervalSeconds: number,
  higherIntervalSeconds: number,
  evaluationPoint: 'open' | 'close' = 'close'
): void {
  if (!higherCandle) return;
  const targetLimitTime =
    evaluationPoint === 'open'
      ? lowerCandleTime
      : lowerCandleTime + lowerIntervalSeconds;
  const higherCloseTime = higherCandle.time + higherIntervalSeconds;

  if (higherCloseTime > targetLimitTime) {
    throw new Error(
      `[MultiTimeframeSync] Future-data lookahead violation detected! Higher-timeframe candle opening at ${higherCandle.time} closes at ${higherCloseTime}, which is after lower-timeframe evaluation limit ${targetLimitTime}.`
    );
  }
}

/**
 * Validates that an H1 candle was strictly completed before or at the M15 evaluation time.
 * Throws an error if lookahead bias is detected.
 */
export function assertNoLookahead(
  m15CandleTime: number,
  h1Candle: Candle | null,
  candleIntervalSeconds: number = 900,
  evaluationPoint: 'open' | 'close' = 'close'
): void {
  assertNoLookaheadGeneric(
    m15CandleTime,
    h1Candle,
    candleIntervalSeconds,
    3600,
    evaluationPoint
  );
}

/**
 * Synchronizes an array of M15 candles with their strictly completed H1 candles.
 * Handles gaps (weekends, holidays) and missing data seamlessly.
 */
export function synchronizeM15WithH1(
  m15Candles: Candle[],
  h1Candles: Candle[],
  options: MultiTimeframeSyncOptions = {}
): SynchronizedBar[] {
  if (!m15Candles || m15Candles.length === 0) return [];
  const m15Seconds = options.m15IntervalSeconds ?? 900;
  const evalPoint = options.evaluationPoint ?? 'close';

  // Ensure H1 candles are sorted ascending by time
  const sortedH1 = [...h1Candles].sort((a, b) => a.time - b.time);

  return m15Candles.map((m15, index) => {
    const h1Idx = getLatestClosedH1Index(m15.time, sortedH1, m15Seconds, evalPoint);
    const completedH1 = h1Idx >= 0 ? sortedH1[h1Idx] : null;
    const completedH1CloseTime = completedH1 ? completedH1.time + 3600 : null;

    // Verify lookahead safety
    const isLookaheadFree = completedH1
      ? (completedH1.time + 3600 <= (evalPoint === 'open' ? m15.time : m15.time + m15Seconds))
      : true;

    return {
      m15,
      m15Index: index,
      completedH1,
      completedH1Index: h1Idx,
      completedH1CloseTime,
      isLookaheadFree,
    };
  });
}
