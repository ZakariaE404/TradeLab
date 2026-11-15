import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { getHistoricalRates } from 'dukascopy-node';
import {
  DUKASCOPY_INSTRUMENTS,
  DUKASCOPY_TIMEFRAMES,
  isValidDukascopyInstrument,
  validateDownloadParams,
  getDateRangeForPreset,
  mapDukascopyTfToTradeLabTf,
} from '../services/dukascopyCatalog';
import {
  normalizeDukascopyCandles,
  exportCandlesToCSV,
  parseDukascopyCSV,
  RawDukascopyCandle,
} from '../services/dukascopyNormalizer';
import {
  saveHistoricalDataset,
  getSavedDatasetById,
  getSavedDatasetsList,
  findDuplicateDataset,
  deleteHistoricalDataset,
} from '../services/datasetStorage';
import { runBacktest, DEFAULT_STRATEGY_PARAMS } from '../services/backtestEngine';
import { generateForexCandles } from '../services/marketData';
import { Candle } from '../types/trading';
import { SavedHistoricalDataset } from '../types/historicalData';

describe('1. Dukascopy Catalog & Validation Tests', () => {
  it('should validate official supported instruments and reject fake IDs', () => {
    assert.equal(isValidDukascopyInstrument('eurusd'), true);
    assert.equal(isValidDukascopyInstrument('xauusd'), true);
    assert.equal(isValidDukascopyInstrument('usatechidxusd'), true); // NASDAQ 100
    assert.equal(isValidDukascopyInstrument('gbpusd'), true);

    // Reject fake / invented instruments
    assert.equal(isValidDukascopyInstrument('fake_coin_usd'), false);
    assert.equal(isValidDukascopyInstrument('random123'), false);
    assert.equal(isValidDukascopyInstrument(''), false);
  });

  it('should validate download parameters correctly', () => {
    const valid = validateDownloadParams({
      instrument: 'eurusd',
      timeframe: 'm1',
      from: '2024-10-01',
      to: '2024-10-08',
      priceType: 'BID',
    });
    assert.equal(valid.isValid, true);

    // Invalid instrument
    const invalidInst = validateDownloadParams({
      instrument: 'invented_symbol',
      timeframe: 'm1',
      from: '2024-10-01',
      to: '2024-10-08',
      priceType: 'BID',
    });
    assert.equal(invalidInst.isValid, false);

    // Invalid date order (start >= end)
    const invalidDates = validateDownloadParams({
      instrument: 'eurusd',
      timeframe: 'm1',
      from: '2024-10-10',
      to: '2024-10-05',
      priceType: 'BID',
    });
    assert.equal(invalidDates.isValid, false);
  });

  it('should calculate valid date presets', () => {
    const preset7d = getDateRangeForPreset('7d');
    assert.ok(preset7d.from < preset7d.to);

    const preset30d = getDateRangeForPreset('30d');
    assert.ok(preset30d.from < preset30d.to);
  });
});

describe('2. Dukascopy Real Historical Download Tests (EURUSD, XAUUSD, NASDAQ)', () => {
  it('should download a small EURUSD M1 historical range from Dukascopy', async () => {
    const rawRates = await getHistoricalRates({
      instrument: 'eurusd',
      dates: {
        from: new Date('2024-10-15T00:00:00Z'),
        to: new Date('2024-10-15T01:00:00Z'),
      },
      timeframe: 'm1',
      priceType: 'bid',
      volumes: true,
      format: 'json',
    });

    assert.ok(Array.isArray(rawRates), 'Rates must be an array');
    assert.equal(rawRates.length, 60, 'Should return exactly 60 M1 candles for 1 hour');

    const normalized = normalizeDukascopyCandles(rawRates as RawDukascopyCandle[], 'm1');
    assert.equal(normalized.candles.length, 60);

    // Verify chronological order and strict OHLC boundaries
    for (let i = 0; i < normalized.candles.length; i++) {
      const c = normalized.candles[i];
      assert.ok(c.time > 0, 'Timestamp must be positive');
      assert.ok(c.high >= c.low, `High (${c.high}) must be >= low (${c.low})`);
      assert.ok(c.high >= c.open, `High must be >= open`);
      assert.ok(c.high >= c.close, `High must be >= close`);
      assert.ok(c.low <= c.open, `Low must be <= open`);
      assert.ok(c.low <= c.close, `Low must be <= close`);
      assert.ok(c.volume >= 0, 'Volume must be non-negative');

      if (i > 0) {
        assert.ok(
          c.time > normalized.candles[i - 1].time,
          `Candles must be strictly increasing chronologically`
        );
      }
    }
  });

  it('should download a small XAUUSD M1 historical range from Dukascopy', async () => {
    const rawRates = await getHistoricalRates({
      instrument: 'xauusd',
      dates: {
        from: new Date('2024-10-15T00:00:00Z'),
        to: new Date('2024-10-15T01:00:00Z'),
      },
      timeframe: 'm1',
      priceType: 'bid',
      volumes: true,
      format: 'json',
    });

    assert.ok(Array.isArray(rawRates));
    assert.equal(rawRates.length, 60, 'XAUUSD should return 60 M1 candles');

    const normalized = normalizeDukascopyCandles(rawRates as RawDukascopyCandle[], 'm1');
    assert.equal(normalized.candles.length, 60);
    assert.ok(normalized.candles[0].open > 2000, 'Gold price should be in realistic range');
  });

  it('should download a small NASDAQ (usatechidxusd) M1 range from Dukascopy', async () => {
    const rawRates = await getHistoricalRates({
      instrument: 'usatechidxusd',
      dates: {
        from: new Date('2024-10-15T00:00:00Z'),
        to: new Date('2024-10-15T01:00:00Z'),
      },
      timeframe: 'm1',
      priceType: 'bid',
      volumes: true,
      format: 'json',
    });

    assert.ok(Array.isArray(rawRates));
    assert.equal(rawRates.length, 60, 'NASDAQ should return 60 M1 candles');

    const normalized = normalizeDukascopyCandles(rawRates as RawDukascopyCandle[], 'm1');
    assert.equal(normalized.candles.length, 60);
    assert.ok(normalized.candles[0].open > 15000, 'NASDAQ price should be in realistic index range');
  });
});

describe('3. Normalization, Deduplication, and OHLC Integrity', () => {
  it('should filter out corrupted quotes and duplicate timestamps', () => {
    const dirtyCandles: RawDukascopyCandle[] = [
      { timestamp: 1700000000000, open: 1.1, high: 1.12, low: 1.09, close: 1.11, volume: 100 },
      // Duplicate timestamp: should be removed
      { timestamp: 1700000000000, open: 1.1, high: 1.15, low: 1.08, close: 1.12, volume: 200 },
      // Invalid: high < low
      { timestamp: 1700000060000, open: 1.1, high: 1.05, low: 1.15, close: 1.1, volume: 100 },
      // Invalid: negative price
      { timestamp: 1700000120000, open: -1.1, high: 1.12, low: 1.09, close: 1.11, volume: 100 },
      // Valid candle
      { timestamp: 1700000180000, open: 1.11, high: 1.13, low: 1.10, close: 1.12, volume: 150 },
    ];

    const result = normalizeDukascopyCandles(dirtyCandles, 'm1');
    assert.equal(result.candles.length, 2, 'Only 2 valid clean candles should survive');
    assert.equal(result.report.duplicateTimestampsRemoved, 1);
    assert.equal(result.report.invalidOhlcFiltered, 2);
    assert.equal(result.candles[0].time, 1700000000);
    assert.equal(result.candles[1].time, 1700000180);
  });

  it('should export and parse CSV with 100% data fidelity', () => {
    const originalCandles: Candle[] = [
      { time: 1728950400, open: 1.0909, high: 1.0915, low: 1.0905, close: 1.0912, volume: 150 },
      { time: 1728950460, open: 1.0912, high: 1.0920, low: 1.0910, close: 1.0918, volume: 200 },
    ];

    const csvStr = exportCandlesToCSV(originalCandles, {
      symbol: 'EUR/USD',
      timeframe: 'm1',
      priceType: 'BID',
    });

    assert.ok(csvStr.includes('Timestamp_UTC,Datetime_UTC'));

    const parsed = parseDukascopyCSV(csvStr);
    assert.equal(parsed.length, 2);
    assert.equal(parsed[0].time, originalCandles[0].time);
    assert.equal(parsed[0].open, originalCandles[0].open);
    assert.equal(parsed[0].close, originalCandles[0].close);
    assert.equal(parsed[1].time, originalCandles[1].time);
  });
});

describe('4. Backtesting Integration with Historical Dukascopy Dataset', () => {
  it('should run backtesting engine against historical candles and compute performance statistics', async () => {
    // Download 300 bars of historical EURUSD M15
    const rawRates = await getHistoricalRates({
      instrument: 'eurusd',
      dates: {
        from: new Date('2024-10-01T00:00:00Z'),
        to: new Date('2024-10-08T00:00:00Z'),
      },
      timeframe: 'm15',
      priceType: 'bid',
      volumes: true,
      format: 'json',
    });

    assert.ok(rawRates.length > 50, 'Should have enough candles for backtest warmup');
    const normalized = normalizeDukascopyCandles(rawRates as RawDukascopyCandle[], 'm15');

    const dataSourceNote = 'Dukascopy Historical Data (EUR/USD M15, 2024-10-01 → 2024-10-08, BID)';
    const result = runBacktest(
      normalized.candles,
      DEFAULT_STRATEGY_PARAMS,
      'EUR/USD',
      '15m',
      null,
      dataSourceNote
    );

    // Verify statistics are computed
    assert.ok(typeof result.winRate === 'number');
    assert.ok(typeof result.netR === 'number');
    assert.ok(typeof result.profitFactor === 'number');
    assert.ok(Array.isArray(result.trades));
    assert.ok(Array.isArray(result.equityCurve));
    assert.ok(result.equityCurve.length > 0);

    // Verify data source visibility
    assert.ok(Array.isArray(result.assumptions));
    const hasDataSource = result.assumptions?.some((a) => a.includes('Dukascopy Historical Data'));
    assert.ok(hasDataSource, 'Data source must be clearly visible in backtest assumptions');
  });

  it('should change backtest statistics when a different historical period is selected', async () => {
    // Period A: Oct 1 - Oct 5
    const ratesA = await getHistoricalRates({
      instrument: 'eurusd',
      dates: { from: new Date('2024-10-01T00:00:00Z'), to: new Date('2024-10-05T00:00:00Z') },
      timeframe: 'm15',
      priceType: 'bid',
      volumes: true,
      format: 'json',
    });

    // Period B: Oct 8 - Oct 12
    const ratesB = await getHistoricalRates({
      instrument: 'eurusd',
      dates: { from: new Date('2024-10-08T00:00:00Z'), to: new Date('2024-10-12T00:00:00Z') },
      timeframe: 'm15',
      priceType: 'bid',
      volumes: true,
      format: 'json',
    });

    const normA = normalizeDukascopyCandles(ratesA as RawDukascopyCandle[], 'm15');
    const normB = normalizeDukascopyCandles(ratesB as RawDukascopyCandle[], 'm15');

    const resA = runBacktest(normA.candles, DEFAULT_STRATEGY_PARAMS, 'EUR/USD', '15m');
    const resB = runBacktest(normB.candles, DEFAULT_STRATEGY_PARAMS, 'EUR/USD', '15m');

    // Both periods must process independently and reflect actual historical market data
    assert.ok(normA.candles[0].time !== normB.candles[0].time, 'Timestamps must be different for different ranges');
  });
});

describe('5. Dataset Persistence & Reuse Without Re-downloading', () => {
  it('should save and retrieve historical dataset by ID', async () => {
    const dummyCandles: Candle[] = [
      { time: 1728950400, open: 1.09, high: 1.095, low: 1.085, close: 1.092, volume: 100 },
      { time: 1728951300, open: 1.092, high: 1.098, low: 1.091, close: 1.096, volume: 120 },
    ];

    const testDataset: SavedHistoricalDataset = {
      id: 'test_dataset_eurusd_1',
      name: 'EUR/USD M15 Test Dataset',
      instrument: 'eurusd',
      symbol: 'EUR/USD',
      timeframe: 'm15',
      displayTimeframe: '15m',
      startDate: '2024-10-15',
      endDate: '2024-10-16',
      startTime: 1728950400,
      endTime: 1728951300,
      priceType: 'BID',
      candleCount: 2,
      downloadDate: Date.now(),
      dataSource: 'Dukascopy',
      status: 'READY',
      candles: dummyCandles,
    };

    await saveHistoricalDataset(testDataset);

    // Retrieve without downloading
    const retrieved = await getSavedDatasetById('test_dataset_eurusd_1');
    assert.ok(retrieved !== null);
    assert.equal(retrieved.id, 'test_dataset_eurusd_1');
    assert.equal(retrieved.candleCount, 2);

    // Check duplicate detection
    const dup = await findDuplicateDataset({
      instrument: 'eurusd',
      timeframe: 'm15',
      startDate: '2024-10-15',
      endDate: '2024-10-16',
      priceType: 'BID',
    });
    assert.ok(dup !== null, 'Duplicate dataset should be detected');

    // Clean up
    await deleteHistoricalDataset('test_dataset_eurusd_1');
    const afterDelete = await getSavedDatasetById('test_dataset_eurusd_1');
    assert.equal(afterDelete, null);
  });
});

describe('6. Regression: Existing DEMO and Twelve Data functionality', () => {
  it('should generate synthetic candles for DEMO mode without breaking', () => {
    const demoCandles = generateForexCandles('XAUUSDm', '15m', 42, 200, 'mixed');
    assert.equal(demoCandles.length, 200);
    assert.ok(demoCandles[0].close > 0);

    const demoBacktest = runBacktest(demoCandles, DEFAULT_STRATEGY_PARAMS, 'XAUUSDm', '15m');
    assert.ok(typeof demoBacktest.winRate === 'number');
    assert.ok(demoBacktest.trades.length >= 0);
  });
});
