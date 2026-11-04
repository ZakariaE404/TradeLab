'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  BacktestResult,
  Candle,
  DataSourceMode,
  ForexSymbol,
  IndicatorConfig,
  RealDataState,
  StrategyParameters,
  Timeframe,
  Trade,
} from '@/types/trading';
import {
  generateForexCandles,
  FOREX_SYMBOLS,
  MarketRegime,
} from '@/services/marketData';
import { fetchTwelveDataCandles } from '@/services/realMarketData';
import {
  DEFAULT_STRATEGY_PARAMS,
  runBacktest,
} from '@/services/backtestEngine';
import {
  CalculationStatus,
  clearAllCache,
  getCachedBacktest,
  getCachedCandles,
  getCandlesCacheKey,
  getCandlesIdentityHash,
  getBacktestCacheKey,
  getStoredIndicatorConfig,
  getStoredStrategySettings,
  saveStoredIndicatorConfig,
  saveStoredStrategySettings,
  setCachedBacktest,
  setCachedCandles,
} from '@/services/cacheService';
import dynamic from 'next/dynamic';
import { TopNav } from '@/components/layout/TopNav';
import { StatsBar } from '@/components/stats/StatsBar';
import { TradeHistoryPanel } from '@/components/trades/TradeHistoryPanel';
import { StrategySettingsDrawer } from '@/components/settings/StrategySettingsDrawer';
import { ImportDataModal } from '@/components/common/ImportDataModal';
import { AlertTriangle, RefreshCw } from 'lucide-react';

const TradingChart = dynamic(
  () => import('@/components/chart/TradingChart').then((mod) => mod.TradingChart),
  {
    ssr: false,
    loading: () => (
      <div className="flex-1 w-full h-full flex items-center justify-center bg-[#090d16] text-slate-500 font-mono text-xs select-none">
        <div className="flex items-center gap-2">
          <div className="w-2 h-2 rounded-full bg-emerald-400 animate-pulse" />
          <span>Initializing Terminal Chart Engine...</span>
        </div>
      </div>
    ),
  }
);

export default function TradeLabPage() {
  // 1. Terminal Market State
  const [symbol, setSymbol] = useState<ForexSymbol>('XAUUSDm');
  const [timeframe, setTimeframe] = useState<Timeframe>('15m');
  const [marketSeed, setMarketSeed] = useState<number>(42);
  const [marketRegime, setMarketRegime] = useState<MarketRegime>('mixed');
  const [customCandles, setCustomCandles] = useState<{
    fileName: string;
    candles: Candle[];
  } | null>(null);

  // 2. Active Strategy Parameters (Persisted in localStorage)
  const [strategyParams, setStrategyParams] = useState<StrategyParameters>(DEFAULT_STRATEGY_PARAMS);

  // 3. Indicator Configuration (Persisted in localStorage)
  const [indicatorConfig, setIndicatorConfig] = useState<IndicatorConfig>({
    showEma50: true,
    showEma200: true,
    showFastEma: true,
    showSlowEma: true,
    showTrendEma: false,
    showBollingerBands: false,
    showVolume: true,
    showMarkers: true,
  });

  // 4. UI Layout Panels
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isHistoryCollapsed, setIsHistoryCollapsed] = useState(false);
  const [isImportModalOpen, setIsImportModalOpen] = useState(false);
  const [selectedTradeId, setSelectedTradeId] = useState<string | null>(null);

  // 5. Data Source Mode & Real Market Data State
  const [dataSourceMode, setDataSourceMode] = useState<DataSourceMode>('DEMO');
  const [outputsize, setOutputsize] = useState<number>(500);
  const [realH1Candles, setRealH1Candles] = useState<Candle[] | null>(null);
  const [realDataState, setRealDataState] = useState<RealDataState>({
    provider: 'Twelve Data',
    instrument: 'XAU/USD',
    symbol: 'XAU/USD',
    timeframe: '15m',
    candleCount: 0,
    outputsize: 500,
    isLoading: false,
    error: null,
    lastUpdated: null,
    isCurrentCandleForming: false,
    formingCandle: null,
    closedCandlesCount: 0,
    missingGapsCount: 0,
  });

  // 6. Cache & Performance State
  const [activeCandles, setActiveCandles] = useState<Candle[]>(() =>
    generateForexCandles('XAUUSDm', '15m', 42, undefined, 'mixed')
  );
  const [backtestResult, setBacktestResult] = useState<BacktestResult>(() =>
    runBacktest(activeCandles, DEFAULT_STRATEGY_PARAMS, 'XAUUSDm', '15m')
  );
  const [calculationStatus, setCalculationStatus] = useState<CalculationStatus>('calculated');
  const [lastCalculatedAt, setLastCalculatedAt] = useState<number | null>(() => Date.now());

  // Load localStorage preferences on client mount
  useEffect(() => {
    const storedParams = getStoredStrategySettings(DEFAULT_STRATEGY_PARAMS);
    const storedIndicators = getStoredIndicatorConfig({
      showEma50: true,
      showEma200: true,
      showFastEma: true,
      showSlowEma: true,
      showTrendEma: false,
      showBollingerBands: false,
      showVolume: true,
      showMarkers: true,
    });
    setStrategyParams(storedParams);
    setIndicatorConfig(storedIndicators);
  }, []);

  // Save changes to localStorage
  const handleUpdateParams = (newParams: StrategyParameters) => {
    setStrategyParams(newParams);
    saveStoredStrategySettings(newParams);
  };

  const handleToggleIndicator = (key: keyof IndicatorConfig) => {
    setIndicatorConfig((prev) => {
      const updated = { ...prev, [key]: !prev[key] };
      saveStoredIndicatorConfig(updated);
      return updated;
    });
  };

  // 7. Candle Generation, Real Data Fetching & IndexedDB Caching
  useEffect(() => {
    let isCancelled = false;

    async function loadCandles() {
      if (customCandles) {
        setActiveCandles(customCandles.candles);
        return;
      }

      if (dataSourceMode === 'REAL') {
        setRealDataState((prev) => ({
          ...prev,
          isLoading: true,
          error: null,
          symbol: symbol === 'XAUUSDm' ? 'XAU/USD' : symbol,
          timeframe,
        }));

        try {
          const result = await fetchTwelveDataCandles(symbol, timeframe, { outputsize });
          if (isCancelled) return;

          if (result.success && result.candles.length > 0) {
            setActiveCandles(result.candles);
            setRealDataState({
              provider: 'Twelve Data',
              instrument: symbol === 'XAUUSDm' ? 'XAU/USD' : symbol,
              symbol: symbol === 'XAUUSDm' ? 'XAU/USD' : symbol,
              timeframe,
              candleCount: result.candles.length,
              outputsize,
              isLoading: false,
              error: null,
              lastUpdated: result.meta.lastUpdated,
              isCurrentCandleForming: result.meta.isCurrentCandleForming,
              formingCandle: result.formingCandle,
              closedCandlesCount: result.closedCandles.length,
              missingGapsCount: result.meta.missingGaps.length,
            });

            // Fetch H1 candles for multi-timeframe Strategy A if current timeframe is 15m
            if (timeframe === '15m') {
              const h1Result = await fetchTwelveDataCandles(symbol, '1h', {
                outputsize: Math.max(100, Math.ceil(outputsize / 4)),
              });
              if (!isCancelled && h1Result.success && h1Result.candles.length > 0) {
                setRealH1Candles(h1Result.candles);
              }
            } else {
              setRealH1Candles(null);
            }
          } else {
            setRealDataState((prev) => ({
              ...prev,
              isLoading: false,
              error: result.error || 'Failed to fetch real market data',
              errorCode: result.errorCode,
            }));
          }
        } catch (err: any) {
          if (isCancelled) return;
          setRealDataState((prev) => ({
            ...prev,
            isLoading: false,
            error: err.message || 'Network error fetching Twelve Data candles',
          }));
        }
        return;
      }

      // DEMO mode
      setRealH1Candles(null);
      setRealDataState((prev) => ({ ...prev, error: null, isLoading: false }));

      const cacheKey = getCandlesCacheKey(symbol, timeframe, marketSeed, marketRegime);
      const cached = await getCachedCandles(cacheKey);

      if (isCancelled) return;

      if (cached && cached.length > 0) {
        setActiveCandles(cached);
      } else {
        const generated = generateForexCandles(symbol, timeframe, marketSeed, undefined, marketRegime);
        if (isCancelled) return;
        setActiveCandles(generated);
        setCachedCandles(cacheKey, generated);
      }
    }

    loadCandles();

    return () => {
      isCancelled = true;
    };
  }, [dataSourceMode, symbol, timeframe, outputsize, marketSeed, marketRegime, customCandles]);

  // 8. Manual Refresh Handler for Real Market Data
  const handleRefreshRealData = useCallback(async () => {
    if (dataSourceMode !== 'REAL') return;

    setRealDataState((prev) => ({ ...prev, isLoading: true, error: null }));
    try {
      const result = await fetchTwelveDataCandles(symbol, timeframe, {
        outputsize,
        forceRefresh: true,
      });

      if (result.success && result.candles.length > 0) {
        setActiveCandles(result.candles);
        setRealDataState({
          provider: 'Twelve Data',
          instrument: symbol === 'XAUUSDm' ? 'XAU/USD' : symbol,
          symbol: symbol === 'XAUUSDm' ? 'XAU/USD' : symbol,
          timeframe,
          candleCount: result.candles.length,
          outputsize,
          isLoading: false,
          error: null,
          lastUpdated: result.meta.lastUpdated,
          isCurrentCandleForming: result.meta.isCurrentCandleForming,
          formingCandle: result.formingCandle,
          closedCandlesCount: result.closedCandles.length,
          missingGapsCount: result.meta.missingGaps.length,
        });

        if (timeframe === '15m') {
          const h1Result = await fetchTwelveDataCandles(symbol, '1h', {
            outputsize: Math.max(100, Math.ceil(outputsize / 4)),
            forceRefresh: true,
          });
          if (h1Result.success && h1Result.candles.length > 0) {
            setRealH1Candles(h1Result.candles);
          }
        }
      } else {
        setRealDataState((prev) => ({
          ...prev,
          isLoading: false,
          error: result.error || 'Failed to refresh real market data',
          errorCode: result.errorCode,
        }));
      }
    } catch (err: any) {
      setRealDataState((prev) => ({
        ...prev,
        isLoading: false,
        error: err.message || 'Network error refreshing Twelve Data candles',
      }));
    }
  }, [dataSourceMode, symbol, timeframe, outputsize]);

  // 9. Backtest Execution with IndexedDB Caching Layer
  const evaluationIdRef = useRef(0);

  useEffect(() => {
    if (!activeCandles || activeCandles.length === 0) return;

    const currentEvalId = ++evaluationIdRef.current;
    setCalculationStatus('computing');

    const candlesHash = getCandlesIdentityHash(activeCandles);
    const cacheKey = getBacktestCacheKey(candlesHash, symbol, timeframe, strategyParams);

    // Run async cache lookup then fallback to computation
    (async () => {
      const cached = await getCachedBacktest(cacheKey);

      if (evaluationIdRef.current !== currentEvalId) return; // Discard superseded evaluation

      if (cached) {
        setBacktestResult(cached.result);
        setLastCalculatedAt(cached.timestamp);
        setCalculationStatus('cached');
      } else {
        // Small delay via requestAnimationFrame to keep UI responsive
        requestAnimationFrame(async () => {
          if (evaluationIdRef.current !== currentEvalId) return;

          const result = runBacktest(activeCandles, strategyParams, symbol, timeframe, realH1Candles);
          const savedTimestamp = await setCachedBacktest(cacheKey, result);

          if (evaluationIdRef.current !== currentEvalId) return;

          setBacktestResult(result);
          setLastCalculatedAt(savedTimestamp);
          setCalculationStatus('calculated');
        });
      }
    })();
  }, [activeCandles, strategyParams, symbol, timeframe, realH1Candles]);

  // Derive selected trade from current result
  const selectedTrade = useMemo(() => {
    if (!selectedTradeId) return null;
    return backtestResult.trades.find((t) => t.id === selectedTradeId) || null;
  }, [backtestResult.trades, selectedTradeId]);

  // Keyboard shortcuts (Escape closes modals/drawers or deselects trade)
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        if (isImportModalOpen) setIsImportModalOpen(false);
        else if (isSettingsOpen) setIsSettingsOpen(false);
        else if (selectedTradeId) setSelectedTradeId(null);
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isImportModalOpen, isSettingsOpen, selectedTradeId]);

  // Handlers
  const handleSelectSymbol = (newSymbol: ForexSymbol) => {
    setSymbol(newSymbol);
    setCustomCandles(null);
    setSelectedTradeId(null);
  };

  const handleSelectTimeframe = (newTf: Timeframe) => {
    setTimeframe(newTf);
    setSelectedTradeId(null);
  };

  const handleRegenerateData = () => {
    if (dataSourceMode === 'REAL') {
      handleRefreshRealData();
      return;
    }
    setMarketSeed(Math.floor(Math.random() * 100000) + 1);
    setCustomCandles(null);
    setSelectedTradeId(null);
  };

  const handleImportCandles = (candles: Candle[], fileName: string) => {
    setCustomCandles({ fileName, candles });
    setSelectedTradeId(null);
  };

  const handleRunManualBacktest = () => {
    // Force recalculation by generating a new evaluation timestamp
    setStrategyParams((prev) => ({ ...prev }));
  };

  const handleClearCache = async () => {
    setCalculationStatus('computing');
    await clearAllCache();

    if (dataSourceMode === 'REAL') {
      await handleRefreshRealData();
      return;
    }

    // Re-generate fresh candles and compute
    const freshSeed = Math.floor(Math.random() * 100000) + 1;
    setMarketSeed(freshSeed);
    const freshCandles = generateForexCandles(symbol, timeframe, freshSeed, undefined, marketRegime);
    setActiveCandles(freshCandles);

    const candlesHash = getCandlesIdentityHash(freshCandles);
    const cacheKey = getBacktestCacheKey(candlesHash, symbol, timeframe, strategyParams);
    const result = runBacktest(freshCandles, strategyParams, symbol, timeframe);
    const savedTimestamp = await setCachedBacktest(cacheKey, result);

    setBacktestResult(result);
    setLastCalculatedAt(savedTimestamp);
    setCalculationStatus('calculated');
    setSelectedTradeId(null);
  };

  return (
    <div className="flex flex-col h-screen w-screen bg-[#070a10] text-slate-100 overflow-hidden font-sans">
      {/* 1. Top Navigation Bar */}
      <TopNav
        symbol={symbol}
        onSelectSymbol={handleSelectSymbol}
        timeframe={timeframe}
        onSelectTimeframe={handleSelectTimeframe}
        candleCount={activeCandles.length}
        marketRegime={marketRegime}
        onChangeRegime={(r) => {
          setMarketRegime(r);
          setCustomCandles(null);
          setSelectedTradeId(null);
        }}
        onRunBacktest={handleRunManualBacktest}
        onRegenerateData={handleRegenerateData}
        onOpenImportModal={() => setIsImportModalOpen(true)}
        onToggleSettings={() => setIsSettingsOpen(!isSettingsOpen)}
        isSettingsOpen={isSettingsOpen}
        isCustomData={!!customCandles}
        strategyParams={strategyParams}
        calculationStatus={calculationStatus}
        lastCalculatedAt={lastCalculatedAt}
        onClearCache={handleClearCache}
        dataSourceMode={dataSourceMode}
        onSelectDataSourceMode={(mode) => {
          setDataSourceMode(mode);
          setCustomCandles(null);
          setSelectedTradeId(null);
        }}
        realDataState={realDataState}
        onRefreshRealData={handleRefreshRealData}
        outputsize={outputsize}
        onChangeOutputsize={(size) => setOutputsize(size)}
      />

      {/* Real Data Error Alert Banner */}
      {dataSourceMode === 'REAL' && realDataState.error && (
        <div className="bg-rose-950/90 border-b border-rose-500/40 px-4 py-2 flex items-center justify-between text-xs text-rose-200 shrink-0 z-10 animate-fadeIn">
          <div className="flex items-center gap-2">
            <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
            <div>
              <span className="font-semibold text-white">Twelve Data API:</span>{' '}
              <span>{realDataState.error}</span>
              {realDataState.errorCode === 'MISSING_API_KEY' && (
                <span className="ml-1 text-rose-300 font-mono">
                  (Configure TWELVE_DATA_API_KEY in your environment or .env.local)
                </span>
              )}
            </div>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            <button
              onClick={handleRefreshRealData}
              className="px-2 py-0.5 bg-rose-800 hover:bg-rose-700 text-white rounded text-[11px] font-medium transition cursor-pointer flex items-center gap-1"
            >
              <RefreshCw className="w-3 h-3" />
              <span>Retry</span>
            </button>
            <button
              onClick={() => setDataSourceMode('DEMO')}
              className="px-2 py-0.5 bg-slate-800 hover:bg-slate-700 text-slate-200 rounded text-[11px] font-medium transition cursor-pointer"
            >
              Switch to Demo
            </button>
          </div>
        </div>
      )}

      {/* 2. Compact Statistics Strip */}
      <StatsBar
        result={backtestResult}
        accountBalance={strategyParams.accountBalance}
      />

      {/* 3. Main Central Workspace: Candlestick Chart (Prioritized Screen Space) */}
      <main className="flex-1 w-full min-h-0 relative flex flex-col bg-[#090d16]">
        <TradingChart
          candles={activeCandles}
          symbol={symbol}
          timeframe={timeframe}
          onSelectTimeframe={handleSelectTimeframe}
          trades={backtestResult.trades}
          selectedTrade={selectedTrade}
          onSelectTrade={(t) => setSelectedTradeId(t.id)}
          indicatorConfig={indicatorConfig}
          onToggleIndicator={handleToggleIndicator}
          onClearSelectedTrade={() => setSelectedTradeId(null)}
        />
      </main>

      {/* 4. Collapsible Trade History & Equity Curve Panel */}
      <TradeHistoryPanel
        result={backtestResult}
        selectedTrade={selectedTrade}
        onSelectTrade={(t) => setSelectedTradeId(t.id)}
        isCollapsed={isHistoryCollapsed}
        onToggleCollapse={() => setIsHistoryCollapsed(!isHistoryCollapsed)}
      />

      {/* 5. Strategy & Risk Parameters Drawer */}
      <StrategySettingsDrawer
        isOpen={isSettingsOpen}
        onClose={() => setIsSettingsOpen(false)}
        params={strategyParams}
        onChangeParams={handleUpdateParams}
        onApplyAndRun={handleRunManualBacktest}
      />

      {/* 6. Custom Data Import Modal */}
      <ImportDataModal
        isOpen={isImportModalOpen}
        onClose={() => setIsImportModalOpen(false)}
        onImportCandles={handleImportCandles}
      />
    </div>
  );
}
