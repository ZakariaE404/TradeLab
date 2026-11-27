import { Candle, Trade } from '@/types/trading';

export const MAX_CHART_CANDLES = 8000;

/**
 * Binary search for an item by exact ascending timestamp in O(log n) with zero Map allocations.
 */
export function binarySearchByTime<T extends { time: number }>(
  items: readonly T[],
  targetTime: number
): T | null {
  let lo = 0;
  let hi = items.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const t = items[mid].time;
    if (t === targetTime) return items[mid];
    if (t < targetTime) lo = mid + 1;
    else hi = mid - 1;
  }
  return null;
}

export function findInsertionIndexByTime(candles: readonly Candle[], targetTime: number): number {
  let lo = 0;
  let hi = candles.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    const t = candles[mid].time;
    if (t === targetTime) return mid;
    if (t < targetTime) lo = mid + 1;
    else hi = mid - 1;
  }
  return Math.min(lo, Math.max(0, candles.length - 1));
}

/**
 * Computes the [startIndex, endIndex) window of at most `maxCandles` to render on chart.
 * Defaults to the latest window, or centers around selectedTrade if it lies outside the tail window.
 */
export function getChartCandleWindowRange(
  candles: readonly Candle[],
  selectedTrade: Trade | null,
  maxCandles: number = MAX_CHART_CANDLES
): { startIndex: number; endIndex: number } {
  const total = candles.length;
  if (total === 0) return { startIndex: 0, endIndex: 0 };
  if (total <= maxCandles) return { startIndex: 0, endIndex: total };

  let startIndex = total - maxCandles;
  if (selectedTrade && selectedTrade.entryTime > 0) {
    const tailStartTime = candles[startIndex].time;
    if (selectedTrade.entryTime < tailStartTime) {
      const targetIdx = findInsertionIndexByTime(candles, selectedTrade.entryTime);
      startIndex = Math.max(
        0,
        Math.min(total - maxCandles, targetIdx - Math.floor(maxCandles / 2))
      );
    }
  }
  return { startIndex, endIndex: startIndex + maxCandles };
}

/**
 * Limits rendered chart candles to MAX_CHART_CANDLES while preserving the full dataset for backtesting.
 */
export function selectChartCandleWindow(
  candles: readonly Candle[],
  selectedTrade: Trade | null,
  maxCandles: number = MAX_CHART_CANDLES
): { displayCandles: Candle[]; startIndex: number; endIndex: number } {
  const { startIndex, endIndex } = getChartCandleWindowRange(candles, selectedTrade, maxCandles);
  const displayCandles =
    startIndex === 0 && endIndex === candles.length
      ? (candles as Candle[])
      : candles.slice(startIndex, endIndex);
  return { displayCandles, startIndex, endIndex };
}
