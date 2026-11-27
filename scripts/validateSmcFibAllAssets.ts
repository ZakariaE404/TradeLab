import * as fs from 'fs';
import { Candle, ForexSymbol } from '../types/trading';
import { fetchDukascopyHistoricalRates } from '../services/dukascopyFetcher';
import { normalizeDukascopyCandles, RawDukascopyCandle } from '../services/dukascopyNormalizer';
import { runSmcFibBacktest } from '../services/strategy/implementations/smcFib4hV1';

interface AssetSpec {
  symbol: ForexSymbol;
  dukascopyId: string;
  assetClass: 'Crypto' | 'ETF' | 'Equity';
}

const ASSETS: AssetSpec[] = [
  { symbol: 'BTCUSD', dukascopyId: 'btcusd', assetClass: 'Crypto' },
  { symbol: 'ETHUSD', dukascopyId: 'ethusd', assetClass: 'Crypto' },
  { symbol: 'SPY', dukascopyId: 'spyususd', assetClass: 'ETF' },
  { symbol: 'QQQ', dukascopyId: 'qqqususd', assetClass: 'ETF' },
  { symbol: 'GLD', dukascopyId: 'gldususd', assetClass: 'ETF' },
  { symbol: 'SLV', dukascopyId: 'slvususd', assetClass: 'ETF' },
  { symbol: 'AAPL', dukascopyId: 'aaplususd', assetClass: 'Equity' },
];

const FROM_DATE = new Date('2022-01-01T00:00:00Z');
const TO_DATE = new Date('2025-11-01T00:00:00Z');

async function fetchH4Candles(dukascopyId: string): Promise<Candle[]> {
  const raw = await fetchDukascopyHistoricalRates({
    instrument: dukascopyId,
    from: FROM_DATE,
    to: TO_DATE,
    timeframe: 'h4',
    priceType: 'bid',
    retryCount: 3,
    pauseBetweenRetriesMs: 1000,
    batchSize: 8,
    pauseBetweenBatchesMs: 150,
  });

  const normalized = normalizeDukascopyCandles(raw as RawDukascopyCandle[], 'h4');
  return normalized.candles;
}

async function main() {
  console.log('================================================================================');
  console.log('TradeLab Phase 4 — SMC_FIB_4H_V1 Multi-Asset H4 Validation (Dukascopy Real Data)');
  console.log(`Window: ${FROM_DATE.toISOString().slice(0, 10)} → ${TO_DATE.toISOString().slice(0, 10)}`);
  console.log('================================================================================\n');

  const report: any[] = [];

  for (const asset of ASSETS) {
    process.stdout.write(`Fetching H4 data for ${asset.symbol} (${asset.dukascopyId})... `);
    const candles = await fetchH4Candles(asset.dukascopyId);
    console.log(`${candles.length} H4 bars.`);

    const qcResult = runSmcFibBacktest(
      candles,
      asset.symbol,
      { executionTiming: 'next_open' },
      `Dukascopy ${asset.dukascopyId} H4 BID`
    );

    const pineResult = runSmcFibBacktest(
      candles,
      asset.symbol,
      { executionTiming: 'close' },
      `Dukascopy ${asset.dukascopyId} H4 BID (Pine close fill)`
    );

    const chochExitsQc = qcResult.trades.filter((t) => t.exitReason === 'SIGNAL_CLOSE').length;
    const chochExitsPine = pineResult.trades.filter((t) => t.exitReason === 'SIGNAL_CLOSE').length;

    const firstDate = candles[0] ? new Date(candles[0].time * 1000).toISOString().slice(0, 10) : 'N/A';
    const lastDate = candles[candles.length - 1]
      ? new Date(candles[candles.length - 1].time * 1000).toISOString().slice(0, 10)
      : 'N/A';

    const entry = {
      symbol: asset.symbol,
      dukascopyId: asset.dukascopyId,
      assetClass: asset.assetClass,
      dateRange: `${firstDate} -> ${lastDate}`,
      h4Bars: candles.length,
      structureEvents: {
        bosCount:
          qcResult.smcOverlay?.structureEvents.filter(
            (e) => e.type === 'BULL_BOS' || e.type === 'BEAR_BOS'
          ).length ?? 0,
        chochCount:
          qcResult.smcOverlay?.structureEvents.filter(
            (e) => e.type === 'BULL_CHOCH' || e.type === 'BEAR_CHOCH'
          ).length ?? 0,
      },
      qcNextOpen: {
        totalTrades: qcResult.totalTrades,
        unresolvedTrades: qcResult.unresolvedTrades ?? 0,
        winningTrades: qcResult.winningTrades,
        losingTrades: qcResult.losingTrades,
        chochLiquidations: chochExitsQc,
        winRate: qcResult.winRate,
        profitFactor: qcResult.profitFactor,
        netR: qcResult.netR,
        totalPnlCurrency: qcResult.totalPnlCurrency,
        finalEquity: Number((100000 + qcResult.totalPnlCurrency).toFixed(2)),
        maxDrawdownR: qcResult.maxDrawdownR,
        maxDrawdownPercent: qcResult.maxDrawdownPercent,
        expectancyR: qcResult.expectancyR,
        longTrades: qcResult.longTradesCount,
        longWinRate: qcResult.longWinRate,
        shortTrades: qcResult.shortTradesCount,
        shortWinRate: qcResult.shortWinRate,
        equityCurve: qcResult.equityCurve,
      },
      pineCloseFill: {
        totalTrades: pineResult.totalTrades,
        unresolvedTrades: pineResult.unresolvedTrades ?? 0,
        winningTrades: pineResult.winningTrades,
        losingTrades: pineResult.losingTrades,
        chochLiquidations: chochExitsPine,
        winRate: pineResult.winRate,
        profitFactor: pineResult.profitFactor,
        netR: pineResult.netR,
        totalPnlCurrency: pineResult.totalPnlCurrency,
        finalEquity: Number((100000 + pineResult.totalPnlCurrency).toFixed(2)),
        maxDrawdownR: pineResult.maxDrawdownR,
        maxDrawdownPercent: pineResult.maxDrawdownPercent,
        expectancyR: pineResult.expectancyR,
        longTrades: pineResult.longTradesCount,
        longWinRate: pineResult.longWinRate,
        shortTrades: pineResult.shortTradesCount,
        shortWinRate: pineResult.shortWinRate,
        equityCurve: pineResult.equityCurve,
      },
    };

    report.push(entry);

    console.log(
      `  [QC next_open] Trades=${qcResult.totalTrades} (${qcResult.winningTrades}W/${qcResult.losingTrades}L, CHOCH=${chochExitsQc}, Open=${qcResult.unresolvedTrades}) | WR=${qcResult.winRate}% | PF=${qcResult.profitFactor} | NetR=${qcResult.netR}R | PnL=$${qcResult.totalPnlCurrency} | MaxDD=${qcResult.maxDrawdownPercent}%`
    );
    console.log(
      `  [Pine close]   Trades=${pineResult.totalTrades} (${pineResult.winningTrades}W/${pineResult.losingTrades}L, CHOCH=${chochExitsPine}, Open=${pineResult.unresolvedTrades}) | WR=${pineResult.winRate}% | PF=${pineResult.profitFactor} | NetR=${pineResult.netR}R | PnL=$${pineResult.totalPnlCurrency} | MaxDD=${pineResult.maxDrawdownPercent}%\n`
    );
  }

  fs.writeFileSync('scripts/smcFibValidationReport.json', JSON.stringify(report, null, 2));
  console.log('Saved full report to scripts/smcFibValidationReport.json');
}

main().catch((err) => {
  console.error('Validation failed:', err);
  process.exit(1);
});
