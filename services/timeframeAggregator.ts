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
  streamCanonicalM1Candles,
} from './m1Database';
import { is24x7DukascopyInstrument } from './dukascopyCatalog';

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
  // Pure integer arithmetic avoids allocating a Date object per candle.
  const dayIdx = Math.floor(timestampSec / 86400);
  const dow = ((dayIdx + 4) % 7 + 7) % 7; // Epoch 1970-01-01 was Thursday (4); 0 = Sun, 1 = Mon, ..., 6 = Sat
  const secInDay = timestampSec - dayIdx * 86400;
  const dayStartSec = dayIdx * 86400;

  if (dow === 0) {
    if (secInDay >= 75600) {
      // Sunday evening market open (>= 21:00 UTC) belongs to upcoming week starting Monday
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
function isSessionBoundaryBucket(
  bucketStart: number,
  periodSeconds: number,
  is24x7: boolean = false
): boolean {
  if (is24x7) return false;
  const bucketEnd = bucketStart + periodSeconds;
  // If bucket contains Friday 22:00 UTC or Sunday 21:00 UTC
  const isStartClosed = isWeekendMarketClosed(bucketStart);
  const isEndClosed = isWeekendMarketClosed(bucketEnd - 60);

  // If one end is closed and the other is open, it's a boundary bar
  return isStartClosed !== isEndClosed;
}

interface BucketAccumulator {
  time: number;
  firstTime: number;
  lastTime: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  count: number;
}

export interface StreamingTimeframeAggregator {
  pushBatch: (candles: ReadonlyArray<Candle>) => void;
  finalize: () => AggregatedCandle[];
}

function buildAggregatedCandle(
  bTime: number,
  open: number,
  high: number,
  low: number,
  close: number,
  volume: number,
  count: number,
  normTf: Timeframe,
  periodSeconds: number,
  expected: number,
  is24x7: boolean
): AggregatedCandle {
  let status: AggregatedCandleStatus = 'COMPLETE';
  let isComplete = true;
  let hasGaps = false;

  if (count < expected) {
    if (normTf === '1D' || normTf === '1W' || isSessionBoundaryBucket(bTime, periodSeconds, is24x7)) {
      status = 'SESSION_BOUNDARY';
      isComplete = true;
      hasGaps = false;
    } else {
      status = 'INCOMPLETE';
      isComplete = false;
      hasGaps = true;
    }
  }

  return {
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
  };
}

/**
 * Streaming, O(1)-working-memory M1 -> higher-timeframe aggregator.
 * Fast path handles chronological M1 streams with zero Map/array allocations and no sorting.
 * Falls back cleanly to compact scalar bucket accumulators only if out-of-order timestamps arrive.
 */
export function createTimeframeAggregator(
  targetTimeframe: Timeframe | DukascopyTimeframe | string,
  is24x7: boolean = false
): StreamingTimeframeAggregator {
  const normTf = normalizeTimeframeId(targetTimeframe);
  const spec = TIMEFRAME_SPECS[normTf] || TIMEFRAME_SPECS['15m'];
  const expected = spec.expectedM1Count;
  const periodSeconds = spec.seconds;

  const result: AggregatedCandle[] = [];

  // Fast-path scalar state for active bucket
  let hasActive = false;
  let curBucketTime = 0;
  let curFirstTime = 0;
  let curLastTime = 0;
  let curOpen = 0;
  let curHigh = -Infinity;
  let curLow = Infinity;
  let curClose = 0;
  let curVolume = 0;
  let curCount = 0;

  // Out-of-order fallback (stores compact scalar accumulators, never constituent Candle[] arrays)
  let outOfOrder = false;
  let fallbackMap: Map<number, BucketAccumulator> | null = null;

  const flushActive = () => {
    if (!hasActive) return;
    result.push(
      buildAggregatedCandle(
        curBucketTime,
        curOpen,
        curHigh,
        curLow,
        curClose,
        curVolume,
        curCount,
        normTf,
        periodSeconds,
        expected,
        is24x7
      )
    );
    hasActive = false;
  };

  const switchToOutOfOrder = () => {
    outOfOrder = true;
    fallbackMap = new Map<number, BucketAccumulator>();
    for (let i = 0; i < result.length; i++) {
      const r = result[i];
      fallbackMap.set(r.time, {
        time: r.time,
        firstTime: r.time,
        lastTime: r.time + periodSeconds - 60,
        open: r.open,
        high: r.high,
        low: r.low,
        close: r.close,
        volume: r.volume,
        count: r.constituentCount,
      });
    }
    result.length = 0;

    if (hasActive) {
      fallbackMap.set(curBucketTime, {
        time: curBucketTime,
        firstTime: curFirstTime,
        lastTime: curLastTime,
        open: curOpen,
        high: curHigh,
        low: curLow,
        close: curClose,
        volume: curVolume,
        count: curCount,
      });
      hasActive = false;
    }
  };

  const pushToFallback = (c: Candle, bucketTime: number) => {
    const map = fallbackMap!;
    const existing = map.get(bucketTime);
    const vol = c.volume || 0;
    if (!existing) {
      map.set(bucketTime, {
        time: bucketTime,
        firstTime: c.time,
        lastTime: c.time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: vol,
        count: 1,
      });
      return;
    }

    if (c.time < existing.firstTime) {
      existing.firstTime = c.time;
      existing.open = c.open;
    }
    if (c.time >= existing.lastTime) {
      existing.lastTime = c.time;
      existing.close = c.close;
    }
    if (c.high > existing.high) existing.high = c.high;
    if (c.low < existing.low) existing.low = c.low;
    existing.volume += vol;
    existing.count += 1;
  };

  return {
    pushBatch(candles: ReadonlyArray<Candle>) {
      if (!candles || candles.length === 0) return;

      if (normTf === '1m') {
        for (let i = 0; i < candles.length; i++) {
          const c = candles[i];
          if (!c || typeof c.time !== 'number' || Number.isNaN(c.time)) continue;
          result.push({
            time: c.time,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume,
            constituentCount: 1,
            expectedConstituents: 1,
            isComplete: true,
            hasGaps: false,
            status: 'COMPLETE',
          });
        }
        return;
      }

      for (let i = 0; i < candles.length; i++) {
        const c = candles[i];
        if (!c || typeof c.time !== 'number' || Number.isNaN(c.time)) continue;

        const bucketTime = getBucketStartTimestamp(c.time, normTf);

        if (outOfOrder) {
          pushToFallback(c, bucketTime);
          continue;
        }

        if (!hasActive) {
          hasActive = true;
          curBucketTime = bucketTime;
          curFirstTime = c.time;
          curLastTime = c.time;
          curOpen = c.open;
          curHigh = c.high;
          curLow = c.low;
          curClose = c.close;
          curVolume = c.volume || 0;
          curCount = 1;
          continue;
        }

        if (bucketTime === curBucketTime) {
          if (c.time < curLastTime) {
            switchToOutOfOrder();
            pushToFallback(c, bucketTime);
            continue;
          }
          if (c.high > curHigh) curHigh = c.high;
          if (c.low < curLow) curLow = c.low;
          curClose = c.close;
          curLastTime = c.time;
          curVolume += c.volume || 0;
          curCount += 1;
        } else if (bucketTime > curBucketTime) {
          flushActive();
          hasActive = true;
          curBucketTime = bucketTime;
          curFirstTime = c.time;
          curLastTime = c.time;
          curOpen = c.open;
          curHigh = c.high;
          curLow = c.low;
          curClose = c.close;
          curVolume = c.volume || 0;
          curCount = 1;
        } else {
          switchToOutOfOrder();
          pushToFallback(c, bucketTime);
        }
      }
    },

    finalize(): AggregatedCandle[] {
      if (normTf === '1m') {
        return result;
      }

      if (!outOfOrder) {
        flushActive();
        return result;
      }

      const map = fallbackMap!;
      const sortedKeys = Array.from(map.keys()).sort((a, b) => a - b);
      const out: AggregatedCandle[] = new Array(sortedKeys.length);
      for (let i = 0; i < sortedKeys.length; i++) {
        const acc = map.get(sortedKeys[i])!;
        out[i] = buildAggregatedCandle(
          acc.time,
          acc.open,
          acc.high,
          acc.low,
          acc.close,
          acc.volume,
          acc.count,
          normTf,
          periodSeconds,
          expected,
          is24x7
        );
      }
      return out;
    },
  };
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
  targetTimeframe: Timeframe | DukascopyTimeframe | string,
  is24x7: boolean = false
): AggregatedCandle[] {
  if (!m1Candles || m1Candles.length === 0) return [];

  const aggregator = createTimeframeAggregator(targetTimeframe, is24x7);
  aggregator.pushBatch(m1Candles);
  return aggregator.finalize();
}

/**
 * Retrieves derived timeframe series from cache or streams canonical M1 chunks
 * from IndexedDB directly into the streaming aggregator.
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

  // 2. Stream canonical M1 chunks directly into the aggregator (avoids loading 1M+ M1 bars at once)
  const aggregator = createTimeframeAggregator(normTf, is24x7DukascopyInstrument(symKey));
  const m1Count = await streamCanonicalM1Candles(symKey, startSec, endSec, (chunk) => {
    aggregator.pushBatch(chunk);
  });
  if (m1Count === 0) {
    return [];
  }

  // 3. Finalize aggregated candles
  const aggregated = aggregator.finalize();

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
