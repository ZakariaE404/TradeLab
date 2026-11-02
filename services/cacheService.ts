/**
 * TradeLab Client-Side Storage & Caching Layer
 * Provides high-speed IndexedDB caching for large datasets (candles, indicators, backtests)
 * and localStorage for small user settings and preferences.
 */

import { BacktestResult, Candle, IndicatorConfig, StrategyParameters } from '@/types/trading';
import { IndicatorPoint } from './indicators';

export const CACHE_SCHEMA_VERSION = 1;
const DB_NAME = `TradeLab_Cache_v${CACHE_SCHEMA_VERSION}`;
const DB_VERSION = 1;

export type CalculationStatus = 'idle' | 'computing' | 'cached' | 'calculated';

export interface CacheMetadata {
  status: CalculationStatus;
  lastCalculatedAt: number | null; // epoch ms
  source: 'cache' | 'computed';
  key?: string;
}

// LocalStorage Keys
export const STORAGE_KEYS = {
  STRATEGY_SETTINGS: `tradelab_settings_v${CACHE_SCHEMA_VERSION}`,
  INDICATOR_CONFIG: `tradelab_indicators_v${CACHE_SCHEMA_VERSION}`,
  MARKET_PREFS: `tradelab_market_prefs_v${CACHE_SCHEMA_VERSION}`,
};

let dbPromise: Promise<IDBDatabase | null> | null = null;

/**
 * Initializes and returns the IndexedDB instance safely
 */
function getIDBDatabase(): Promise<IDBDatabase | null> {
  if (typeof window === 'undefined' || !window.indexedDB) {
    return Promise.resolve(null);
  }

  if (dbPromise) return dbPromise;

  dbPromise = new Promise((resolve) => {
    try {
      const request = window.indexedDB.open(DB_NAME, DB_VERSION);

      request.onupgradeneeded = (event) => {
        const db = (event.target as IDBOpenDBRequest).result;
        if (!db.objectStoreNames.contains('candles')) {
          db.createObjectStore('candles', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('indicators')) {
          db.createObjectStore('indicators', { keyPath: 'key' });
        }
        if (!db.objectStoreNames.contains('backtests')) {
          db.createObjectStore('backtests', { keyPath: 'key' });
        }
      };

      request.onsuccess = () => {
        resolve(request.result);
      };

      request.onerror = () => {
        console.warn('[CacheService] IndexedDB open error, falling back to in-memory');
        resolve(null);
      };
    } catch (err) {
      console.warn('[CacheService] IndexedDB initialization failed:', err);
      resolve(null);
    }
  });

  return dbPromise;
}

/**
 * Fast deterministic hash for strings and objects
 */
export function fastHash(value: unknown): string {
  const str = typeof value === 'string' ? value : JSON.stringify(value);
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = (hash * 33) ^ str.charCodeAt(i);
  }
  return (hash >>> 0).toString(36);
}

/**
 * Generates a stable key for candle datasets
 */
export function getCandlesCacheKey(
  symbol: string,
  timeframe: string,
  seed: number,
  regime: string,
  customFileName?: string
): string {
  if (customFileName) {
    return `candles_v${CACHE_SCHEMA_VERSION}_custom_${fastHash(customFileName)}`;
  }
  return `candles_v${CACHE_SCHEMA_VERSION}_${symbol}_${timeframe}_${seed}_${regime}`;
}

/**
 * Generates a deterministic hash representing candle dataset identity
 */
export function getCandlesIdentityHash(candles: Candle[]): string {
  if (!candles || candles.length === 0) return 'empty';
  const first = candles[0];
  const mid = candles[Math.floor(candles.length / 2)];
  const last = candles[candles.length - 1];
  return fastHash(
    `${candles.length}_${first.time}_${first.close}_${mid.time}_${mid.close}_${last.time}_${last.close}`
  );
}

/**
 * Generates a stable key for EMA indicators
 */
export function getEmaCacheKey(
  candlesHash: string,
  period: number,
  symbol: string,
  timeframe: string
): string {
  return `ema_v${CACHE_SCHEMA_VERSION}_${symbol}_${timeframe}_${period}_${candlesHash}`;
}

/**
 * Generates a stable key for Backtest results
 */
export function getBacktestCacheKey(
  candlesHash: string,
  symbol: string,
  timeframe: string,
  params: StrategyParameters
): string {
  // Extract strictly relevant parameters for stable invalidation
  const stratType = params.strategyType;
  const relevantParams = {
    stratType,
    rr: params.riskRewardRatio,
    riskPct: params.riskPercent,
    spread: params.includeSpread ? params.spreadPips : 0,
    ...(stratType === 'strategy_a' ? params.strategyA : {}),
    ...(stratType === 'ema_pullback'
      ? { fast: params.fastEma, slow: params.slowEma, trend: params.trendEma, mult: params.atrStopMultiplier }
      : {}),
    ...(stratType === 'breakout_retest' ? { fast: params.fastEma, mult: params.atrStopMultiplier } : {}),
    ...(stratType === 'rsi_mean_reversion'
      ? { rsiPeriod: params.rsiPeriod, ob: params.rsiOverbought, os: params.rsiOversold }
      : {}),
  };

  const paramsHash = fastHash(relevantParams);
  return `backtest_v${CACHE_SCHEMA_VERSION}_${symbol}_${timeframe}_${candlesHash}_${paramsHash}`;
}

// In-memory fallback caches
const memCandles = new Map<string, Candle[]>();
const memIndicators = new Map<string, IndicatorPoint[]>();
const memBacktests = new Map<string, { result: BacktestResult; timestamp: number }>();

/**
 * Candle Caching in IndexedDB
 */
export async function getCachedCandles(key: string): Promise<Candle[] | null> {
  if (memCandles.has(key)) {
    return memCandles.get(key)!;
  }

  try {
    const db = await getIDBDatabase();
    if (!db) return null;

    return new Promise((resolve) => {
      const tx = db.transaction('candles', 'readonly');
      const store = tx.objectStore('candles');
      const req = store.get(key);

      req.onsuccess = () => {
        if (req.result && Array.isArray(req.result.data)) {
          memCandles.set(key, req.result.data);
          resolve(req.result.data);
        } else {
          resolve(null);
        }
      };

      req.onerror = () => resolve(null);
    });
  } catch (err) {
    console.warn('[CacheService] Failed to read candles cache:', err);
    return null;
  }
}

export async function setCachedCandles(key: string, data: Candle[]): Promise<void> {
  memCandles.set(key, data);

  try {
    const db = await getIDBDatabase();
    if (!db) return;

    const tx = db.transaction('candles', 'readwrite');
    const store = tx.objectStore('candles');
    store.put({ key, data, timestamp: Date.now() });
  } catch (err) {
    console.warn('[CacheService] Failed to save candles cache:', err);
  }
}

/**
 * Indicator Caching in IndexedDB
 */
export async function getCachedIndicator(key: string): Promise<IndicatorPoint[] | null> {
  if (memIndicators.has(key)) {
    return memIndicators.get(key)!;
  }

  try {
    const db = await getIDBDatabase();
    if (!db) return null;

    return new Promise((resolve) => {
      const tx = db.transaction('indicators', 'readonly');
      const store = tx.objectStore('indicators');
      const req = store.get(key);

      req.onsuccess = () => {
        if (req.result && Array.isArray(req.result.data)) {
          memIndicators.set(key, req.result.data);
          resolve(req.result.data);
        } else {
          resolve(null);
        }
      };

      req.onerror = () => resolve(null);
    });
  } catch {
    return null;
  }
}

export async function setCachedIndicator(key: string, data: IndicatorPoint[]): Promise<void> {
  memIndicators.set(key, data);

  try {
    const db = await getIDBDatabase();
    if (!db) return;

    const tx = db.transaction('indicators', 'readwrite');
    const store = tx.objectStore('indicators');
    store.put({ key, data, timestamp: Date.now() });
  } catch {
    // Graceful no-op
  }
}

/**
 * Backtest Result Caching in IndexedDB
 */
export async function getCachedBacktest(
  key: string
): Promise<{ result: BacktestResult; timestamp: number } | null> {
  if (memBacktests.has(key)) {
    return memBacktests.get(key)!;
  }

  try {
    const db = await getIDBDatabase();
    if (!db) return null;

    return new Promise((resolve) => {
      const tx = db.transaction('backtests', 'readonly');
      const store = tx.objectStore('backtests');
      const req = store.get(key);

      req.onsuccess = () => {
        if (req.result && req.result.data && Array.isArray(req.result.data.trades)) {
          const entry = { result: req.result.data, timestamp: req.result.timestamp || Date.now() };
          memBacktests.set(key, entry);
          resolve(entry);
        } else {
          resolve(null);
        }
      };

      req.onerror = () => resolve(null);
    });
  } catch (err) {
    console.warn('[CacheService] Failed to read backtest cache:', err);
    return null;
  }
}

export async function setCachedBacktest(key: string, data: BacktestResult): Promise<number> {
  const timestamp = Date.now();
  memBacktests.set(key, { result: data, timestamp });

  try {
    const db = await getIDBDatabase();
    if (!db) return timestamp;

    const tx = db.transaction('backtests', 'readwrite');
    const store = tx.objectStore('backtests');
    store.put({ key, data, timestamp });
  } catch (err) {
    console.warn('[CacheService] Failed to save backtest cache:', err);
  }

  return timestamp;
}

/**
 * LocalStorage Settings & UI Preferences
 */
export function getStoredStrategySettings(fallback: StrategyParameters): StrategyParameters {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.STRATEGY_SETTINGS);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return { ...fallback, ...parsed };
  } catch {
    return fallback;
  }
}

export function saveStoredStrategySettings(params: StrategyParameters): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEYS.STRATEGY_SETTINGS, JSON.stringify(params));
  } catch {
    // Quota exceeded fallback
  }
}

export function getStoredIndicatorConfig(fallback: IndicatorConfig): IndicatorConfig {
  if (typeof window === 'undefined') return fallback;
  try {
    const raw = localStorage.getItem(STORAGE_KEYS.INDICATOR_CONFIG);
    if (!raw) return fallback;
    const parsed = JSON.parse(raw);
    return { ...fallback, ...parsed };
  } catch {
    return fallback;
  }
}

export function saveStoredIndicatorConfig(config: IndicatorConfig): void {
  if (typeof window === 'undefined') return;
  try {
    localStorage.setItem(STORAGE_KEYS.INDICATOR_CONFIG, JSON.stringify(config));
  } catch {
    // Quota exceeded fallback
  }
}

/**
 * Clear All Local Caches (IndexedDB stores & LocalStorage cache keys)
 */
export async function clearAllCache(): Promise<boolean> {
  memCandles.clear();
  memIndicators.clear();
  memBacktests.clear();

  try {
    // Clear localStorage preferences
    if (typeof window !== 'undefined') {
      localStorage.removeItem(STORAGE_KEYS.STRATEGY_SETTINGS);
      localStorage.removeItem(STORAGE_KEYS.INDICATOR_CONFIG);
      localStorage.removeItem(STORAGE_KEYS.MARKET_PREFS);
    }

    // Clear IndexedDB stores
    const db = await getIDBDatabase();
    if (db) {
      const stores = ['candles', 'indicators', 'backtests'];
      for (const s of stores) {
        if (db.objectStoreNames.contains(s)) {
          const tx = db.transaction(s, 'readwrite');
          tx.objectStore(s).clear();
        }
      }
    }
    return true;
  } catch (err) {
    console.warn('[CacheService] Error clearing cache:', err);
    return false;
  }
}
