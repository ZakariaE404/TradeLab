import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import {
  DUKASCOPY_INSTRUMENTS,
  is24x7DukascopyInstrument,
  isValidDukascopyInstrument,
  resolveDukascopyInstrumentId,
} from '../services/dukascopyCatalog';
import { fetchDukascopyHistoricalRates } from '../services/dukascopyFetcher';
import { normalizeDukascopyCandles, RawDukascopyCandle } from '../services/dukascopyNormalizer';
import { calculateMissingM1Intervals, normalizeSymbolKey } from '../services/m1Database';
import { aggregateM1ToTimeframe } from '../services/timeframeAggregator';

const SEVEN_ASSETS = [
  { symbol: 'BTCUSD', id: 'btcusd', is24x7: true },
  { symbol: 'ETHUSD', id: 'ethusd', is24x7: true },
  { symbol: 'SPY', id: 'spyususd', is24x7: false },
  { symbol: 'QQQ', id: 'qqqususd', is24x7: false },
  { symbol: 'GLD', id: 'gldususd', is24x7: false },
  { symbol: 'SLV', id: 'slvususd', is24x7: false },
  { symbol: 'AAPL', id: 'aaplususd', is24x7: false },
];

describe('SMC Phase 1: Data Downloader & Symbol Mapping', () => {
  it('1. Maps all 7 SMC Fib assets cleanly to official Dukascopy IDs', () => {
    for (const asset of SEVEN_ASSETS) {
      assert.equal(resolveDukascopyInstrumentId(asset.symbol), asset.id);
      assert.equal(isValidDukascopyInstrument(asset.symbol), true);
      assert.equal(isValidDukascopyInstrument(asset.id), true);
      assert.equal(is24x7DukascopyInstrument(asset.symbol), asset.is24x7);
      assert.equal(normalizeSymbolKey(asset.symbol), asset.id);
      assert.ok(DUKASCOPY_INSTRUMENTS[asset.id], `Catalog missing ${asset.id}`);
    }
  });

  it('2. Crypto (24/7) preserves weekend intervals while equities/FX strip weekends', async () => {
    // Saturday 2024-10-12 00:00 UTC to Sunday 2024-10-13 12:00 UTC (inside FX weekend closure)
    const startSec = Math.floor(Date.parse('2024-10-12T00:00:00Z') / 1000);
    const endSec = Math.floor(Date.parse('2024-10-13T12:00:00Z') / 1000);

    const btcMissing = await calculateMissingM1Intervals('BTCUSD', startSec, endSec);
    assert.equal(btcMissing.length, 1, 'BTCUSD must request weekend interval');
    assert.equal(btcMissing[0].start, startSec);
    assert.equal(btcMissing[0].end, endSec);

    const spyMissing = await calculateMissingM1Intervals('SPY', startSec, endSec);
    assert.equal(spyMissing.length, 0, 'SPY must skip FX/equity weekend closure');
  });

  it('3. Aggregates M1 bars to 4H without false weekend boundary flags for crypto', () => {
    // Saturday 2024-10-12 00:00 UTC (240 M1 bars)
    const satStart = Math.floor(Date.parse('2024-10-12T00:00:00Z') / 1000);
    const m1Bars = Array.from({ length: 240 }, (_, i) => ({
      time: satStart + i * 60,
      open: 63000 + i,
      high: 63010 + i,
      low: 62990 + i,
      close: 63005 + i,
      volume: 1,
    }));

    const h4Crypto = aggregateM1ToTimeframe(m1Bars, '4h', true);
    assert.equal(h4Crypto.length, 1);
    assert.equal(h4Crypto[0].status, 'COMPLETE');
    assert.equal(h4Crypto[0].open, 63000);
    assert.equal(h4Crypto[0].close, 63244);
  });

  it('4. Fetches and normalizes live Dukascopy H4 bars for all 7 assets', async () => {
    const from = new Date('2024-10-01T00:00:00Z');
    const to = new Date('2024-10-10T00:00:00Z');

    for (const asset of SEVEN_ASSETS) {
      const raw = await fetchDukascopyHistoricalRates({
        instrument: asset.id,
        from,
        to,
        timeframe: 'h4',
        priceType: 'bid',
        retryCount: 2,
      });

      assert.ok(raw.length > 0, `Expected non-empty H4 bars for ${asset.symbol}`);
      const norm = normalizeDukascopyCandles(raw as RawDukascopyCandle[], 'h4');
      assert.equal(norm.candles.length, raw.length);
      assert.equal(norm.report.invalidOhlcFiltered, 0);

      for (let i = 1; i < norm.candles.length; i++) {
        assert.ok(norm.candles[i].time > norm.candles[i - 1].time);
      }
    }
  });
});
