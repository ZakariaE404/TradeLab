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
 * Finds the latest completed H1 candle index for an M15 candle timestamp.
 * - An H1 candle opening at T completes at T + 3600.
 * - An M15 candle opening at t closes at t + 900.
 * - Under standard close evaluation, the latest completed H1 must have closed at or before t + 900.
 * - Under open evaluation, the latest completed H1 must have closed at or before t.
 * - Never returns an in-progress/forming H1 candle.
 * - Uses binary search O(log N) over sorted H1 candles.
 * - Handles weekend gaps and missing candles safely.
 */
export function getLatestClosedH1Index(
  m15CandleTime: number,
  h1Candles: Candle[],
  candleIntervalSeconds: number = 900,
  evaluationPoint: 'open' | 'close' = 'close'
): number {
  if (!h1Candles || h1Candles.length === 0) return -1;

  const targetLimitTime =
    evaluationPoint === 'open'
      ? m15CandleTime
      : m15CandleTime + candleIntervalSeconds;

  let low = 0;
  let high = h1Candles.length - 1;
  let bestIdx = -1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const h1CloseTime = h1Candles[mid].time + 3600;

    if (h1CloseTime <= targetLimitTime) {
      bestIdx = mid;
      low = mid + 1; // Look for a more recent completed H1 candle
    } else {
      high = mid - 1;
    }
  }

  return bestIdx;
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
 * Validates that an H1 candle was strictly completed before or at the M15 evaluation time.
 * Throws an error if lookahead bias is detected.
 */
export function assertNoLookahead(
  m15CandleTime: number,
  h1Candle: Candle | null,
  candleIntervalSeconds: number = 900,
  evaluationPoint: 'open' | 'close' = 'close'
): void {
  if (!h1Candle) return;
  const targetLimitTime =
    evaluationPoint === 'open'
      ? m15CandleTime
      : m15CandleTime + candleIntervalSeconds;
  const h1CloseTime = h1Candle.time + 3600;

  if (h1CloseTime > targetLimitTime) {
    throw new Error(
      `[MultiTimeframeSync] Future-data lookahead violation detected! H1 candle opening at ${h1Candle.time} closes at ${h1CloseTime}, which is after M15 limit ${targetLimitTime}.`
    );
  }
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
