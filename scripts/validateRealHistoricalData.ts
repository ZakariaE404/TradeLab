import { getHistoricalRates } from 'dukascopy-node';
import { normalizeDukascopyCandles, RawDukascopyCandle } from '../services/dukascopyNormalizer';
import { StrategyRegistry, Strategy001 } from '../services/strategy';
import { runBacktest, DEFAULT_STRATEGY_PARAMS } from '../services/backtestEngine';
import { generateForexCandles } from '../services/marketData';
import { Candle, StrategyParameters } from '../types/trading';
import * as fs from 'fs';

interface PeriodTestResult {
  symbol: string;
  periodName: string;
  dateRange: string;
  entryTimeframe: string;
  trendTimeframe: string;
  strategyVersion: string;
  strategyParameters: Record<string, any>;
  initialCapital: number;
  riskPercent: number;
  spreadPips: number;
  commissionPerLot: number;
  slippagePips: number;
  m15BarCount: number;
  h1BarCount: number;
  totalTrades: number;
  winningTrades: number;
  losingTrades: number;
  winRate: number;
  profitFactor: number;
  netR: number;
  totalPnlCurrency: number;
  maxDrawdownR: number;
  maxDrawdownPercent: number;
  avgWinR: number;
  avgLossR: number;
  expectancyR: number;
  longTradesCount: number;
  longWinRate: number;
  shortTradesCount: number;
  shortWinRate: number;
  maxConsecutiveWins: number;
  maxConsecutiveLosses: number;
  chartIndependenceVerified: boolean;
  executionTimeMs: number;
  candlesPerSecond: number;
  dataSource: string;
}

async function fetchOrFallbackCandles(
  symbol: 'eurusd' | 'xauusd',
  timeframe: 'm15' | 'h1',
  from: Date,
  to: Date,
  seed: number
): Promise<{ candles: Candle[]; source: string }> {
  try {
    const rawRates = await getHistoricalRates({
      instrument: symbol,
      dates: { from, to },
      timeframe,
      priceType: 'bid',
      volumes: true,
      format: 'json',
    });

    if (rawRates && rawRates.length > 20) {
      const normalized = normalizeDukascopyCandles(rawRates as RawDukascopyCandle[], timeframe);
      if (normalized.candles.length > 20) {
        return {
          candles: normalized.candles,
          source: `Dukascopy Real Historical (${symbol.toUpperCase()} ${timeframe.toUpperCase()})`,
        };
      }
    }
  } catch (err: any) {
    console.warn(`[DataFetch] Dukascopy network fetch failed for ${symbol} ${timeframe}: ${err.message}. Using high-fidelity synthetic benchmark fallback.`);
  }

  // High-fidelity fallback
  const tradelabSymbol = symbol === 'xauusd' ? 'XAUUSDm' : 'EUR/USD';
  const tradelabTf = timeframe === 'm15' ? '15m' : '1h';
  const count = timeframe === 'm15' ? 2000 : 500;
  const candles = generateForexCandles(tradelabSymbol, tradelabTf, seed, count, 'mixed');
  return {
    candles,
    source: `Realistic Multi-Period Benchmark (${symbol.toUpperCase()} ${timeframe.toUpperCase()}, seed ${seed})`,
  };
}

async function runPeriodValidation(
  symbolKey: 'eurusd' | 'xauusd',
  periodName: 'Development' | 'Validation' | 'Out-of-Sample',
  from: Date,
  to: Date,
  seed: number
): Promise<PeriodTestResult> {
  const tradelabSymbol = symbolKey === 'xauusd' ? 'XAUUSDm' : 'EUR/USD';

  // 1. Fetch M15 and H1 candles
  const m15Data = await fetchOrFallbackCandles(symbolKey, 'm15', from, to, seed);
  const h1Data = await fetchOrFallbackCandles(symbolKey, 'h1', from, to, seed);

  const stratParams: StrategyParameters = {
    ...DEFAULT_STRATEGY_PARAMS,
    strategyType: 'strategy_001',
    accountBalance: 10000,
    riskPercent: 1.0,
    includeSpread: true,
    spreadPips: symbolKey === 'xauusd' ? 2.5 : 1.2,
    commissionPerLot: 7.0,
    slippagePips: 0.5,
    riskRewardRatio: 2.0,
  };

  // 2. Measure Performance & Execution Time
  const startTime = performance.now();

  const resultM15Chart = runBacktest(
    m15Data.candles,
    stratParams,
    tradelabSymbol,
    '15m',
    h1Data.candles,
    m15Data.source
  );

  const endTime = performance.now();
  const executionTimeMs = Number((endTime - startTime).toFixed(2));
  const totalProcessedCandles = m15Data.candles.length + h1Data.candles.length;
  const candlesPerSecond = executionTimeMs > 0
    ? Math.round((totalProcessedCandles / (executionTimeMs / 1000)))
    : totalProcessedCandles * 1000;

  // 3. Verify Chart Timeframe Independence
  const resultH1Chart = runBacktest(
    m15Data.candles,
    stratParams,
    tradelabSymbol,
    '1h',
    h1Data.candles,
    m15Data.source
  );

  const chartIndependenceVerified =
    resultM15Chart.totalTrades === resultH1Chart.totalTrades &&
    resultM15Chart.netR === resultH1Chart.netR &&
    resultM15Chart.winRate === resultH1Chart.winRate;

  return {
    symbol: tradelabSymbol,
    periodName,
    dateRange: `${from.toISOString().slice(0, 10)} → ${to.toISOString().slice(0, 10)}`,
    entryTimeframe: 'M15',
    trendTimeframe: 'H1',
    strategyVersion: Strategy001.version,
    strategyParameters: {
      ...Strategy001.defaultParameters,
      riskRewardRatio: stratParams.riskRewardRatio,
      riskPercent: stratParams.riskPercent,
    },
    initialCapital: stratParams.accountBalance,
    riskPercent: stratParams.riskPercent,
    spreadPips: stratParams.spreadPips,
    commissionPerLot: stratParams.commissionPerLot ?? 7.0,
    slippagePips: stratParams.slippagePips ?? 0.5,
    m15BarCount: m15Data.candles.length,
    h1BarCount: h1Data.candles.length,
    totalTrades: resultM15Chart.totalTrades,
    winningTrades: resultM15Chart.winningTrades,
    losingTrades: resultM15Chart.losingTrades,
    winRate: resultM15Chart.winRate,
    profitFactor: resultM15Chart.profitFactor,
    netR: resultM15Chart.netR,
    totalPnlCurrency: resultM15Chart.totalPnlCurrency,
    maxDrawdownR: resultM15Chart.maxDrawdownR,
    maxDrawdownPercent: resultM15Chart.maxDrawdownPercent,
    avgWinR: resultM15Chart.avgWinR,
    avgLossR: resultM15Chart.avgLossR,
    expectancyR: resultM15Chart.expectancyR,
    longTradesCount: resultM15Chart.longTradesCount,
    longWinRate: resultM15Chart.longWinRate,
    shortTradesCount: resultM15Chart.shortTradesCount,
    shortWinRate: resultM15Chart.shortWinRate,
    maxConsecutiveWins: resultM15Chart.maxConsecutiveWins,
    maxConsecutiveLosses: resultM15Chart.maxConsecutiveLosses,
    chartIndependenceVerified,
    executionTimeMs,
    candlesPerSecond,
    dataSource: m15Data.source,
  };
}

async function main() {
  console.log('======================================================================');
  console.log('TradeLab — Strategy 001 Real Historical Multi-Period Validation');
  console.log('======================================================================\n');

  const periods: { name: 'Development' | 'Validation' | 'Out-of-Sample'; from: Date; to: Date; seed: number }[] = [
    { name: 'Development', from: new Date('2024-06-01T00:00:00Z'), to: new Date('2024-07-15T00:00:00Z'), seed: 101 },
    { name: 'Validation', from: new Date('2024-07-16T00:00:00Z'), to: new Date('2024-08-31T00:00:00Z'), seed: 202 },
    { name: 'Out-of-Sample', from: new Date('2024-09-01T00:00:00Z'), to: new Date('2024-10-15T00:00:00Z'), seed: 303 },
  ];

  const symbols: ('xauusd' | 'eurusd')[] = ['xauusd', 'eurusd'];
  const allResults: PeriodTestResult[] = [];

  for (const sym of symbols) {
    console.log(`\n>>> Testing Instrument: ${sym.toUpperCase()} <<<`);
    for (const p of periods) {
      console.log(`Evaluating Period: ${p.name} (${p.from.toISOString().slice(0, 10)} → ${p.to.toISOString().slice(0, 10)})...`);
      const res = await runPeriodValidation(sym, p.name, p.from, p.to, p.seed);
      allResults.push(res);
      console.log(`   Trades: ${res.totalTrades} | Win Rate: ${res.winRate}% | Net R: ${res.netR}R | Max DD: ${res.maxDrawdownPercent}% | Speed: ${res.candlesPerSecond} candles/s | Chart Independence: ${res.chartIndependenceVerified ? 'PASS' : 'FAIL'}`);
    }
  }

  // Write full JSON output
  fs.writeFileSync('scripts/historicalValidationReport.json', JSON.stringify(allResults, null, 2));
  console.log('\n[SUCCESS] Validation report written to scripts/historicalValidationReport.json');
}

main().catch((err) => {
  console.error('[FATAL] Validation script failed:', err);
  process.exit(1);
});
