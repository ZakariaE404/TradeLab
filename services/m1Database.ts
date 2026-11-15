import { Candle } from '@/types/trading';
import {
  CanonicalM1Candle,
  DerivedCacheRecord,
  SymbolCoverageRecord,
  TimeRangeInterval,
} from '@/types/historicalData';

export const DB_NAME = 'TradeLab_Historical_v1';
export const DB_VERSION = 2;

export const STORES = {
  DATASETS: 'historical_datasets',
  CANONICAL_M1: 'canonical_m1_candles',
  COVERAGE: 'symbol_coverage',
  DERIVED_CACHE: 'derived_timeframe_cache',
} as const;

let dbPromise: Promise<IDBDatabase | null> | null = null;

// In-Memory Fallbacks (for SSR & Node.js / test environments)
const inMemoryM1 = new Map<string, CanonicalM1Candle>();
const inMemoryCoverage = new Map<string, SymbolCoverageRecord>();
const inMemoryDerived = new Map<string, DerivedCacheRecord>();

/**
 * Initializes and upgrades IndexedDB schema safely
 */
export function getM1Database(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !window.indexedDB) {
    return Promise.resolve(null);
  }

  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    try {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;

        // 1. Preserve original datasets store
        if (!db.objectStoreNames.contains(STORES.DATASETS)) {
          db.createObjectStore(STORES.DATASETS, { keyPath: 'id' });
        }

        // 2. Canonical M1 Candles store
        if (!db.objectStoreNames.contains(STORES.CANONICAL_M1)) {
          const m1Store = db.createObjectStore(STORES.CANONICAL_M1, { keyPath: 'id' });
          m1Store.createIndex('symbol', 'symbol', { unique: false });
          m1Store.createIndex('time', 'time', { unique: false });
          m1Store.createIndex('symbol_time', ['symbol', 'time'], { unique: true });
        }

        // 3. Symbol Coverage store
        if (!db.objectStoreNames.contains(STORES.COVERAGE)) {
          db.createObjectStore(STORES.COVERAGE, { keyPath: 'symbol' });
        }

        // 4. Derived Timeframe Cache store
        if (!db.objectStoreNames.contains(STORES.DERIVED_CACHE)) {
          const derivedStore = db.createObjectStore(STORES.DERIVED_CACHE, { keyPath: 'id' });
          derivedStore.createIndex('symbol_timeframe', ['symbol', 'timeframe'], { unique: false });
        }
      };

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        console.warn('[M1Database] IndexedDB open error, falling back to memory stores.');
        resolve(null);
      };
    } catch (err) {
      console.warn('[M1Database] IndexedDB init exception:', err);
      resolve(null);
    }
  });

  return dbPromise;
}

/**
 * Normalizes instrument symbol string (e.g. 'EUR/USD' -> 'eurusd', 'XAUUSDm' -> 'xauusd')
 */
export function normalizeSymbolKey(sym: string): string {
  if (!sym) return 'eurusd';
  return sym.toLowerCase().replace(/[^a-z0-9]/g, '').replace(/m$/, '');
}

/**
 * Merges overlapping or adjacent time intervals into minimal non-overlapping set
 */
export function mergeIntervals(intervals: TimeRangeInterval[]): TimeRangeInterval[] {
  if (!intervals || intervals.length === 0) return [];

  const sorted = [...intervals].sort((a, b) => a.start - b.start);
  const merged: TimeRangeInterval[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const current = sorted[i];
    const last = merged[merged.length - 1];

    // If overlapping or adjacent (within 120s), combine
    if (current.start <= last.end + 120) {
      last.end = Math.max(last.end, current.end);
    } else {
      merged.push({ ...current });
    }
  }

  return merged;
}

/**
 * Subtracts covered intervals from a requested interval [start, end]
 * Returns array of remaining missing intervals.
 */
export function subtractIntervals(
  target: TimeRangeInterval,
  covered: TimeRangeInterval[]
): TimeRangeInterval[] {
  if (target.start >= target.end) return [];
  if (!covered || covered.length === 0) return [target];

  const mergedCovered = mergeIntervals(covered);
  const missing: TimeRangeInterval[] = [];
  let currentStart = target.start;

  for (const c of mergedCovered) {
    if (c.end <= currentStart) {
      continue;
    }
    if (c.start >= target.end) {
      break;
    }

    if (c.start > currentStart) {
      missing.push({
        start: currentStart,
        end: Math.min(c.start, target.end),
      });
    }

    currentStart = Math.max(currentStart, c.end);
    if (currentStart >= target.end) {
      break;
    }
  }

  if (currentStart < target.end) {
    missing.push({
      start: currentStart,
      end: target.end,
    });
  }

  return missing;
}

/**
 * Checks if a given timestamp falls into the standard Forex weekend closure:
 * Friday 22:00 UTC to Sunday 21:00 UTC.
 */
export function isWeekendMarketClosed(timestampSec: number): boolean {
  const date = new Date(timestampSec * 1000);
  const day = date.getUTCDay(); // 0 = Sun, 5 = Fri, 6 = Sat
  const hour = date.getUTCHours();
  const minute = date.getUTCMinutes();

  if (day === 5 && (hour > 22 || (hour === 22 && minute >= 0))) {
    return true; // Friday 22:00+ UTC
  }
  if (day === 6) {
    return true; // Saturday all day
  }
  if (day === 0 && hour < 21) {
    return true; // Sunday before 21:00 UTC
  }

  return false;
}

/**
 * Trims or strips weekend closure ranges from missing intervals so we never
 * launch pointless queries for weekend market closures.
 */
export function filterWeekendClosures(intervals: TimeRangeInterval[]): TimeRangeInterval[] {
  const result: TimeRangeInterval[] = [];

  for (const interval of intervals) {
    let cur = interval.start;
    const end = interval.end;

    while (cur < end) {
      if (isWeekendMarketClosed(cur)) {
        // Skip ahead by 1 hour until market reopens
        cur += 3600;
        continue;
      }

      // Found an open period start, find when it closes or reaches end
      const openStart = cur;
      while (cur < end && !isWeekendMarketClosed(cur)) {
        cur += 3600;
      }
      const openEnd = Math.min(cur, end);

      if (openEnd > openStart) {
        result.push({
          start: openStart,
          end: openEnd,
        });
      }
    }
  }

  return mergeIntervals(result);
}

/**
 * Save canonical M1 candles in bulk into IndexedDB with atomic coverage updates.
 * Updates symbol_coverage and invalidates affected derived timeframe caches.
 */
export async function saveCanonicalM1Candles(
  symbol: string,
  candles: Candle[],
  dataSource: string = 'Dukascopy'
): Promise<number> {
  if (!candles || candles.length === 0) return 0;

  const symKey = normalizeSymbolKey(symbol);
  const validCandles: CanonicalM1Candle[] = [];
  let minTime = Infinity;
  let maxTime = -Infinity;

  for (const c of candles) {
    if (!c || typeof c.time !== 'number' || c.time <= 0 || isNaN(c.time)) continue;

    // Normalize timestamp to beginning of M1 minute (UTC multiple of 60)
    const time = Math.floor(c.time / 60) * 60;
    const open = Number(c.open);
    const high = Number(c.high);
    const low = Number(c.low);
    const close = Number(c.close);
    const volume = Number(c.volume || 0);

    if (
      !Number.isFinite(open) ||
      !Number.isFinite(high) ||
      !Number.isFinite(low) ||
      !Number.isFinite(close) ||
      open <= 0 ||
      low <= 0 ||
      high < low ||
      high < open ||
      high < close ||
      low > open ||
      low > close
    ) {
      continue;
    }

    const record: CanonicalM1Candle = {
      id: `${symKey}_${time}`,
      symbol: symKey,
      time,
      open,
      high,
      low,
      close,
      volume,
      dataSource,
      isComplete: true,
    };

    validCandles.push(record);
    if (time < minTime) minTime = time;
    if (time > maxTime) maxTime = time;

    // Always maintain in-memory map
    inMemoryM1.set(record.id, record);
  }

  if (validCandles.length === 0) return 0;

  // 1. Bulk write to IndexedDB
  try {
    const db = await getM1Database();
    if (db) {
      const BATCH_SIZE = 5000;
      for (let i = 0; i < validCandles.length; i += BATCH_SIZE) {
        const batch = validCandles.slice(i, i + BATCH_SIZE);
        await new Promise<void>((resolve, reject) => {
          const tx = db.transaction(STORES.CANONICAL_M1, 'readwrite');
          const store = tx.objectStore(STORES.CANONICAL_M1);
          for (const item of batch) {
            store.put(item);
          }
          tx.oncomplete = () => resolve();
          tx.onerror = () => reject(tx.error);
        });
      }
    }
  } catch (err) {
    console.warn('[M1Database] Bulk insert into IndexedDB failed, memory active:', err);
  }

  // 2. Update Symbol Coverage
  const newInterval: TimeRangeInterval = {
    start: minTime,
    end: maxTime + 60, // exclusive
  };
  await updateSymbolCoverage(symKey, newInterval, validCandles.length);

  // 3. Invalidate overlapping derived caches
  await invalidateDerivedCache(symKey, minTime, maxTime + 60);

  return validCandles.length;
}

/**
 * Updates coverage index for a symbol with newly downloaded interval
 */
async function updateSymbolCoverage(
  symbol: string,
  newInterval: TimeRangeInterval,
  candleCountAdded: number
): Promise<void> {
  const existing = await getSymbolCoverage(symbol);
  const intervals = existing?.intervals ? [...existing.intervals, newInterval] : [newInterval];
  const merged = mergeIntervals(intervals);

  const firstTime = merged.length > 0 ? merged[0].start : newInterval.start;
  const lastTime = merged.length > 0 ? merged[merged.length - 1].end : newInterval.end;
  const totalCount = (existing?.totalCandlesCount || 0) + candleCountAdded;

  const coverageRecord: SymbolCoverageRecord = {
    symbol,
    intervals: merged,
    totalCandlesCount: totalCount,
    firstCandleTime: firstTime,
    lastCandleTime: lastTime,
    lastUpdated: Date.now(),
  };

  inMemoryCoverage.set(symbol, coverageRecord);

  try {
    const db = await getM1Database();
    if (db) {
      await new Promise<void>((resolve, reject) => {
        const tx = db.transaction(STORES.COVERAGE, 'readwrite');
        const store = tx.objectStore(STORES.COVERAGE);
        const req = store.put(coverageRecord);
        req.onerror = () => reject(req.error);
        tx.oncomplete = () => resolve();
        tx.onerror = () => reject(tx.error);
      });
    }
  } catch (err) {
    console.warn('[M1Database] Error updating coverage in IndexedDB:', err);
  }
}

/**
 * Retrieves coverage record for an instrument
 */
export async function getSymbolCoverage(symbol: string): Promise<SymbolCoverageRecord | null> {
  const symKey = normalizeSymbolKey(symbol);
  if (inMemoryCoverage.has(symKey)) {
    return inMemoryCoverage.get(symKey)!;
  }

  try {
    const db = await getM1Database();
    if (!db) return null;

    return new Promise((resolve) => {
      const tx = db.transaction(STORES.COVERAGE, 'readonly');
      const store = tx.objectStore(STORES.COVERAGE);
      const req = store.get(symKey);
      req.onsuccess = () => {
        if (req.result) {
          inMemoryCoverage.set(symKey, req.result);
          resolve(req.result);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    });
  } catch (err) {
    console.warn('[M1Database] Error reading coverage:', err);
    return null;
  }
}

/**
 * Calculates true missing intervals for a requested date range,
 * taking existing database coverage and market weekend closures into account.
 */
export async function calculateMissingM1Intervals(
  symbol: string,
  requestStartSec: number,
  requestEndSec: number
): Promise<TimeRangeInterval[]> {
  const symKey = normalizeSymbolKey(symbol);
  const coverage = await getSymbolCoverage(symKey);

  const target: TimeRangeInterval = {
    start: Math.floor(requestStartSec / 60) * 60,
    end: Math.ceil(requestEndSec / 60) * 60,
  };

  if (!coverage || !coverage.intervals || coverage.intervals.length === 0) {
    return filterWeekendClosures([target]);
  }

  const rawMissing = subtractIntervals(target, coverage.intervals);
  return filterWeekendClosures(rawMissing);
}

/**
 * Retrieves canonical M1 candles from IndexedDB / memory store
 */
export async function getCanonicalM1Candles(
  symbol: string,
  fromSec?: number,
  toSec?: number
): Promise<Candle[]> {
  const symKey = normalizeSymbolKey(symbol);
  const minTime = fromSec !== undefined ? Math.floor(fromSec) : 0;
  const maxTime = toSec !== undefined ? Math.ceil(toSec) : Infinity;

  // 1. Check IndexedDB
  try {
    const db = await getM1Database();
    if (db) {
      return new Promise((resolve) => {
        const tx = db.transaction(STORES.CANONICAL_M1, 'readonly');
        const store = tx.objectStore(STORES.CANONICAL_M1);
        const index = store.index('symbol_time');

        const range = IDBKeyRange.bound([symKey, minTime], [symKey, maxTime]);
        const req = index.getAll(range);

        req.onsuccess = () => {
          const results = req.result as CanonicalM1Candle[];
          if (results && results.length > 0) {
            const mapped: Candle[] = results.map((r) => ({
              time: r.time,
              open: r.open,
              high: r.high,
              low: r.low,
              close: r.close,
              volume: r.volume,
            }));
            // Sort ascending chronologically
            mapped.sort((a, b) => a.time - b.time);
            resolve(mapped);
            return;
          }
          // Fallback to in-memory if empty in IDB
          resolve(getMemoryM1Candles(symKey, minTime, maxTime));
        };

        req.onerror = () => {
          resolve(getMemoryM1Candles(symKey, minTime, maxTime));
        };
      });
    }
  } catch (err) {
    console.warn('[M1Database] Error fetching M1 candles from IDB:', err);
  }

  return getMemoryM1Candles(symKey, minTime, maxTime);
}

function getMemoryM1Candles(symKey: string, minTime: number, maxTime: number): Candle[] {
  const out: Candle[] = [];
  for (const c of inMemoryM1.values()) {
    if (c.symbol === symKey && c.time >= minTime && c.time <= maxTime) {
      out.push({
        time: c.time,
        open: c.open,
        high: c.high,
        low: c.low,
        close: c.close,
        volume: c.volume,
      });
    }
  }
  out.sort((a, b) => a.time - b.time);
  return out;
}

/**
 * Invalidates derived timeframe caches that overlap a given time range
 */
export async function invalidateDerivedCache(
  symbol: string,
  startSec?: number,
  endSec?: number
): Promise<void> {
  const symKey = normalizeSymbolKey(symbol);

  // Invalidate memory cache
  for (const [id, rec] of inMemoryDerived.entries()) {
    if (rec.symbol === symKey) {
      if (
        startSec === undefined ||
        endSec === undefined ||
        (rec.rangeStart <= endSec && rec.rangeEnd >= startSec)
      ) {
        inMemoryDerived.delete(id);
      }
    }
  }

  // Invalidate IDB
  try {
    const db = await getM1Database();
    if (!db) return;

    await new Promise<void>((resolve) => {
      const tx = db.transaction(STORES.DERIVED_CACHE, 'readwrite');
      const store = tx.objectStore(STORES.DERIVED_CACHE);
      const cursorReq = store.openCursor();

      cursorReq.onsuccess = (e) => {
        const cursor = (e.target as IDBRequest).result as IDBCursorWithValue;
        if (cursor) {
          const rec = cursor.value as DerivedCacheRecord;
          if (rec.symbol === symKey) {
            if (
              startSec === undefined ||
              endSec === undefined ||
              (rec.rangeStart <= endSec && rec.rangeEnd >= startSec)
            ) {
              cursor.delete();
            }
          }
          cursor.continue();
        } else {
          resolve();
        }
      };

      cursorReq.onerror = () => resolve();
      tx.oncomplete = () => resolve();
    });
  } catch (err) {
    console.warn('[M1Database] Error invalidating derived cache:', err);
  }
}

/**
 * Saves a generated derived timeframe series to cache
 */
export async function saveDerivedCache(record: DerivedCacheRecord): Promise<void> {
  inMemoryDerived.set(record.id, record);

  try {
    const db = await getM1Database();
    if (!db) return;

    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORES.DERIVED_CACHE, 'readwrite');
      const store = tx.objectStore(STORES.DERIVED_CACHE);
      const req = store.put(record);
      req.onerror = () => reject(req.error);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch (err) {
    console.warn('[M1Database] Error storing derived cache in IDB:', err);
  }
}

/**
 * Retrieves a cached derived timeframe series
 */
export async function getDerivedCache(id: string): Promise<DerivedCacheRecord | null> {
  if (inMemoryDerived.has(id)) {
    return inMemoryDerived.get(id)!;
  }

  try {
    const db = await getM1Database();
    if (!db) return null;

    return new Promise((resolve) => {
      const tx = db.transaction(STORES.DERIVED_CACHE, 'readonly');
      const store = tx.objectStore(STORES.DERIVED_CACHE);
      const req = store.get(id);

      req.onsuccess = () => {
        if (req.result) {
          inMemoryDerived.set(id, req.result);
          resolve(req.result);
        } else {
          resolve(null);
        }
      };
      req.onerror = () => resolve(null);
    });
  } catch (err) {
    console.warn('[M1Database] Error reading derived cache from IDB:', err);
    return null;
  }
}

/**
 * Completely purges all canonical M1 data and coverage for a symbol or all symbols
 */
export async function clearM1Database(symbol?: string): Promise<void> {
  const symKey = symbol ? normalizeSymbolKey(symbol) : null;

  if (symKey) {
    for (const [id, c] of inMemoryM1.entries()) {
      if (c.symbol === symKey) inMemoryM1.delete(id);
    }
    inMemoryCoverage.delete(symKey);
    for (const [id, r] of inMemoryDerived.entries()) {
      if (r.symbol === symKey) inMemoryDerived.delete(id);
    }
  } else {
    inMemoryM1.clear();
    inMemoryCoverage.clear();
    inMemoryDerived.clear();
  }

  try {
    const db = await getM1Database();
    if (!db) return;

    if (!symKey) {
      await new Promise<void>((resolve) => {
        const tx = db.transaction(
          [STORES.CANONICAL_M1, STORES.COVERAGE, STORES.DERIVED_CACHE],
          'readwrite'
        );
        tx.objectStore(STORES.CANONICAL_M1).clear();
        tx.objectStore(STORES.COVERAGE).clear();
        tx.objectStore(STORES.DERIVED_CACHE).clear();
        tx.oncomplete = () => resolve();
      });
    }
  } catch (err) {
    console.warn('[M1Database] Error clearing database:', err);
  }
}
