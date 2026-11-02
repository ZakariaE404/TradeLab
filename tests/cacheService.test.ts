import { describe, it, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import {
  fastHash,
  getCandlesCacheKey,
  getCandlesIdentityHash,
  getEmaCacheKey,
  getBacktestCacheKey,
  clearAllCache,
  getCachedCandles,
  setCachedCandles,
  getCachedBacktest,
  setCachedBacktest,
  CACHE_SCHEMA_VERSION,
} from '../services/cacheService';
import { Candle, StrategyParameters } from '../types/trading';
import { DEFAULT_STRATEGY_PARAMS } from '../services/backtestEngine';

function createDummyCandles(count: number, basePrice: number = 2000): Candle[] {
  const candles: Candle[] = [];
  for (let i = 0; i < count; i++) {
    candles.push({
      time: 1700000000 + i * 900,
      open: basePrice + i,
      high: basePrice + i + 2,
      low: basePrice + i - 2,
      close: basePrice + i + 1,
      volume: 1000,
    });
  }
  return candles;
}

describe('Cache Keys & Stability', () => {
  it('should generate stable deterministic hashes for identical inputs', () => {
    const hash1 = fastHash({ symbol: 'XAUUSDm', period: 50 });
    const hash2 = fastHash({ symbol: 'XAUUSDm', period: 50 });
    assert.equal(hash1, hash2, 'Identical objects must yield identical hashes');

    const diffHash = fastHash({ symbol: 'XAUUSDm', period: 200 });
    assert.notEqual(hash1, diffHash, 'Different objects must yield different hashes');
  });

  it('should include cache schema version in all keys', () => {
    const candleKey = getCandlesCacheKey('EUR/USD', '15m', 42, 'mixed');
    assert.ok(candleKey.includes(`_v${CACHE_SCHEMA_VERSION}_`));

    const emaKey = getEmaCacheKey('hash123', 50, 'EUR/USD', '15m');
    assert.ok(emaKey.includes(`_v${CACHE_SCHEMA_VERSION}_`));

    const btKey = getBacktestCacheKey('hash123', 'EUR/USD', '15m', DEFAULT_STRATEGY_PARAMS);
    assert.ok(btKey.includes(`_v${CACHE_SCHEMA_VERSION}_`));
  });

  it('should invalidate candle identity hash when candle data changes', () => {
    const candles1 = createDummyCandles(100, 2000);
    const candles2 = createDummyCandles(100, 2500); // Different prices
    const candles3 = createDummyCandles(105, 2000); // Different length

    const hash1 = getCandlesIdentityHash(candles1);
    const hash2 = getCandlesIdentityHash(candles2);
    const hash3 = getCandlesIdentityHash(candles3);

    assert.notEqual(hash1, hash2, 'Altered prices must produce different candle hash');
    assert.notEqual(hash1, hash3, 'Altered candle count must produce different candle hash');
  });

  it('should invalidate backtest cache key whenever strategy parameters change', () => {
    const candleHash = 'test_candle_hash_abc';
    const key1 = getBacktestCacheKey(candleHash, 'XAUUSDm', '15m', DEFAULT_STRATEGY_PARAMS);

    // Modify riskRewardRatio
    const alteredParams: StrategyParameters = {
      ...DEFAULT_STRATEGY_PARAMS,
      riskRewardRatio: 3.0,
    };
    const key2 = getBacktestCacheKey(candleHash, 'XAUUSDm', '15m', alteredParams);

    assert.notEqual(key1, key2, 'Changing riskRewardRatio must generate a new cache key');

    // Modify strategy type
    const emaParams: StrategyParameters = {
      ...DEFAULT_STRATEGY_PARAMS,
      strategyType: 'ema_pullback',
      fastEma: 21,
    };
    const key3 = getBacktestCacheKey(candleHash, 'XAUUSDm', '15m', emaParams);

    assert.notEqual(key1, key3, 'Changing strategyType must generate a new cache key');
  });
});

describe('In-Memory / Storage Fallback & Cache Eviction', () => {
  beforeEach(async () => {
    await clearAllCache();
  });

  it('should store and retrieve candles in memory fallback', async () => {
    const key = 'test_candle_key_1';
    const candles = createDummyCandles(20);

    await setCachedCandles(key, candles);
    const retrieved = await getCachedCandles(key);

    assert.ok(retrieved !== null);
    assert.equal(retrieved.length, 20);
    assert.equal(retrieved[0].close, candles[0].close);
  });

  it('should store and retrieve backtest results with timestamp', async () => {
    const key = 'test_bt_key_1';
    const mockBacktestResult: any = {
      trades: [],
      totalTrades: 5,
      winningTrades: 3,
      losingTrades: 2,
      breakevenTrades: 0,
      winRate: 60,
      profitFactor: 1.8,
      netR: 3.5,
      totalPnlCurrency: 350,
      maxDrawdownR: 1.5,
      maxDrawdownPercent: 1.5,
      maxConsecutiveWins: 2,
      maxConsecutiveLosses: 1,
      avgWinR: 2.0,
      avgLossR: 1.0,
      expectancyR: 0.8,
      longTradesCount: 3,
      longWinRate: 66.7,
      shortTradesCount: 2,
      shortWinRate: 50,
      equityCurve: [],
    };

    const savedAt = await setCachedBacktest(key, mockBacktestResult);
    assert.ok(savedAt > 0);

    const cached = await getCachedBacktest(key);
    assert.ok(cached !== null);
    assert.equal(cached.result.totalTrades, 5);
    assert.equal(cached.result.netR, 3.5);
  });

  it('should completely clear all cached entries on clearAllCache()', async () => {
    const candleKey = 'test_candle_evict';
    const btKey = 'test_bt_evict';

    await setCachedCandles(candleKey, createDummyCandles(10));
    await setCachedBacktest(btKey, { trades: [] } as any);

    assert.ok((await getCachedCandles(candleKey)) !== null);
    assert.ok((await getCachedBacktest(btKey)) !== null);

    const cleared = await clearAllCache();
    assert.equal(cleared, true);

    assert.equal(await getCachedCandles(candleKey), null);
    assert.equal(await getCachedBacktest(btKey), null);
  });
});
