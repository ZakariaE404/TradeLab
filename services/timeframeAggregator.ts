import { Candle, Timeframe } from '@/types/trading';
import {
  AggregatedCandle,
  AggregatedCandleStatus,
  DerivedCacheRecord,
  DukascopyTimeframe,
} from '@/types/historicalData';
import {
  getCanonicalM1Candles,
  getDerivedCache,
  isWeekendMarketClosed,
  normalizeSymbolKey,
  saveDerivedCache,
} from './m1Database';

export const TIMEFRAME_SPECS: Record<
  string,
  {
    standardTf: Timeframe;
    seconds: number;
    expectedM1Count: number;
    label: string;
  }
> = {
  m1: { standardTf: '1m', seconds: 60, expectedM1Count: 1, label: 'M1' },
  '1m': { standardTf: '1m', seconds: 60, expectedM1Count: 1, label: 'M1' },
  m5: { standardTf: '5m', seconds: 300, expectedM1Count: 5, label: 'M5' },
  '5m': { standardTf: '5m', seconds: 300, expectedM1Count: 5, label: 'M5' },
  m15: { standardTf: '15m', seconds: 900, expectedM1Count: 15, label: 'M15' },
  '15m': { standardTf: '15m', seconds: 900, expectedM1Count: 15, label: 'M15' },
  m30: { standardTf: '30m', seconds: 1800, expectedM1Count: 30, label: 'M30' },
  '30m': { standardTf: '30m', seconds: 1800, expectedM1Count: 30, label: 'M30' },
  h1: { standardTf: '1h', seconds: 3600, expectedM1Count: 60, label: 'H1' },
  '1h': { standardTf: '1h', seconds: 3600, expectedM1Count: 60, label: 'H1' },
  h4: { standardTf: '4h', seconds: 14400, expectedM1Count: 240, label: 'H4' },
  '4h': { standardTf: '4h', seconds: 14400, expectedM1Count: 240, label: 'H4' },
  d1: { standardTf: '1D', seconds: 86400, expectedM1Count: 1440, label: 'D1' },
  '1D': { standardTf: '1D', seconds: 86400, expectedM1Count: 1440, label: 'D1' },
  w1: { standardTf: '1W', seconds: 604800, expectedM1Count: 7200, label: 'W1' },
  '1W': { standardTf: '1W', seconds: 604800, expectedM1Count: 7200, label: 'W1' },
};

/**
 * Normalizes any timeframe string into standard TradeLab Timeframe ('1m', '5m', '15m', etc.)
 */
export function normalizeTimeframeId(tf: string): Timeframe {
  const lower = (tf || '15m').toLowerCase().trim();
  if (TIMEFRAME_SPECS[lower]) {
    return TIMEFRAME_SPECS[lower].standardTf;
  }
  if (lower === '1d') return '1D';
  if (lower === '1w') return '1W';
  return '15m';
}

/**
 * Calculates deterministic UTC bucket start timestamp for a given M1 candle timestamp
 */
export function getBucketStartTimestamp(timestampSec: number, targetTimeframe: Timeframe): number {
  const spec = TIMEFRAME_SPECS[targetTimeframe] || TIMEFRAME_SPECS['15m'];

  if (targetTimeframe === '1m') {
    return Math.floor(timestampSec / 60) * 60;
  }

  // Intra-day timeframes (M5, M15, M30, H1, H4):
  // Cleanly divide 86400 (day) and are anchored at 00:00:00 UTC
  if (spec.seconds < 86400) {
    return Math.floor(timestampSec / spec.seconds) * spec.seconds;
  }

  // Daily (D1): UTC day start (00:00:00 UTC)
  if (targetTimeframe === '1D') {
    return Math.floor(timestampSec / 86400) * 86400;
  }

  // Weekly (W1):
  // Financial convention: trading week starts Monday 00:00:00 UTC.
  // Sunday evening open (>= 21:00 UTC) belongs to the upcoming Monday trading week.
  const date = new Date(timestampSec * 1000);
  const dow = date.getUTCDay(); // 0 = Sun, 1 = Mon, ..., 6 = Sat
  const hours = date.getUTCHours();
  const dayStartSec = Math.floor(timestampSec / 86400) * 86400;

  if (dow === 0) {
    if (hours >= 21) {
      // Sunday evening market open belongs to the upcoming week starting Monday
      return dayStartSec + 86400;
    }
    // Sunday prior to 21:00 belongs to prior week
    return dayStartSec - 6 * 86400;
  }

  // Monday (1) through Saturday (6)
  return dayStartSec - (dow - 1) * 86400;
}

/**
 * Checks if a bucket interval intersects market session boundaries (Friday close / Sunday open)
 */
function isSessionBoundaryBucket(bucketStart: number, periodSeconds: number): boolean {
  const bucketEnd = bucketStart + periodSeconds;
  // If bucket contains Friday 22:00 UTC or Sunday 21:00 UTC
  const isStartClosed = isWeekendMarketClosed(bucketStart);
  const isEndClosed = isWeekendMarketClosed(bucketEnd - 60);

  // If one end is closed and the other is open, it's a boundary bar
  return isStartClosed !== isEndClosed;
}

/**
 * Core Aggregation Engine:
 * Converts canonical M1 candles into any higher timeframe (M5, M15, M30, H1, H4, D1, W1)
 *
 * Rules:
 * - Open = first constituent open
 * - High = max constituent high
 * - Low = min constituent low
 * - Close = last constituent close
 * - Volume = sum of constituent volumes
 * - Strictly NO price forward-filling or fabrication of missing candles.
 * - If no M1 candles exist in an interval, NO higher-timeframe bar is created.
 * - Distinguishes between COMPLETE, INCOMPLETE, and SESSION_BOUNDARY bars.
 */
export function aggregateM1ToTimeframe(
  m1Candles: Candle[],
  targetTimeframe: Timeframe | DukascopyTimeframe | string
): AggregatedCandle[] {
  if (!m1Candles || m1Candles.length === 0) return [];

  const normTf = normalizeTimeframeId(targetTimeframe);
  const spec = TIMEFRAME_SPECS[normTf] || TIMEFRAME_SPECS['15m'];

  if (normTf === '1m') {
    return m1Candles.map((c) => ({
      ...c,
      constituentCount: 1,
      expectedConstituents: 1,
      isComplete: true,
      hasGaps: false,
      status: 'COMPLETE',
    }));
  }

  // 1. Group M1 candles into chronological buckets
  const bucketMap = new Map<number, Candle[]>();

  for (const c of m1Candles) {
    if (!c || typeof c.time !== 'number' || isNaN(c.time)) continue;

    const bucketTime = getBucketStartTimestamp(c.time, normTf);
    let list = bucketMap.get(bucketTime);
    if (!list) {
      list = [];
      bucketMap.set(bucketTime, list);
    }
    list.push(c);
  }

  // 2. Aggregate each bucket deterministically
  const sortedBucketTimes = Array.from(bucketMap.keys()).sort((a, b) => a - b);
  const result: AggregatedCandle[] = [];

  for (const bTime of sortedBucketTimes) {
    const constituents = bucketMap.get(bTime)!;
    if (constituents.length === 0) continue;

    // Sort constituents chronologically
    constituents.sort((a, b) => a.time - b.time);

    const open = constituents[0].open;
    const close = constituents[constituents.length - 1].close;
    let high = -Infinity;
    let low = Infinity;
    let volume = 0;

    for (const item of constituents) {
      if (item.high > high) high = item.high;
      if (item.low < low) low = item.low;
      volume += item.volume || 0;
    }

    const count = constituents.length;
    const expected = spec.expectedM1Count;
    const isBoundary = isSessionBoundaryBucket(bTime, spec.seconds);

    let status: AggregatedCandleStatus = 'COMPLETE';
    let isComplete = true;
    let hasGaps = false;

    if (count < expected) {
      if (isBoundary || normTf === '1D' || normTf === '1W') {
        status = 'SESSION_BOUNDARY';
        isComplete = true; // Valid boundary candle without error
        hasGaps = false;
      } else {
        status = 'INCOMPLETE';
        isComplete = false;
        hasGaps = true;
      }
    }

    result.push({
      time: bTime,
      open,
      high,
      low,
      close,
      volume,
      constituentCount: count,
      expectedConstituents: expected,
      isComplete,
      hasGaps,
      status,
    });
  }

  return result;
}

/**
 * Retrieves derived timeframe series from cache or aggregates on-the-fly from canonical M1 data.
 * M1 is always the single source of truth.
 */
export async function getOrComputeDerivedTimeframe(
  symbol: string,
  timeframe: Timeframe | DukascopyTimeframe | string,
  fromSec?: number,
  toSec?: number
): Promise<Candle[]> {
  const symKey = normalizeSymbolKey(symbol);
  const normTf = normalizeTimeframeId(timeframe);

  const startSec = fromSec !== undefined ? Math.floor(fromSec) : 0;
  const endSec = toSec !== undefined ? Math.ceil(toSec) : 2147483647; // 2038 or unbounded

  // If 1m is requested, directly fetch canonical M1
  if (normTf === '1m') {
    return getCanonicalM1Candles(symKey, startSec, endSec);
  }

  // 1. Check versioned derived cache
  const cacheId = `${symKey}_${normTf}_${startSec}_${endSec}_v1`;
  const cached = await getDerivedCache(cacheId);
  if (cached && cached.candles && cached.candles.length > 0) {
    return cached.candles;
  }

  // 2. Fetch canonical M1 data
  const m1Candles = await getCanonicalM1Candles(symKey, startSec, endSec);
  if (m1Candles.length === 0) {
    return [];
  }

  // 3. Aggregate M1 to target timeframe
  const aggregated = aggregateM1ToTimeframe(m1Candles, normTf);

  // 4. Save to derived cache for fast future lookups
  const derivedRecord: DerivedCacheRecord = {
    id: cacheId,
    symbol: symKey,
    timeframe: normTf,
    rangeStart: startSec,
    rangeEnd: endSec,
    candles: aggregated,
    version: 1,
    createdAt: Date.now(),
  };

  await saveDerivedCache(derivedRecord);

  return aggregated;
}
