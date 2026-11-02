'use client';

import React, { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import {
  BacktestResult,
  Candle,
  ForexSymbol,
  IndicatorConfig,
  StrategyParameters,
  Timeframe,
  Trade,
} from '@/types/trading';
import {
  generateForexCandles,
  FOREX_SYMBOLS,
  MarketRegime,
} from '@/services/marketData';
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

  // 5. Cache & Performance State
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

  // 6. Candle Generation & IndexedDB Caching
  useEffect(() => {
    let isCancelled = false;

    async function loadCandles() {
      if (customCandles) {
        setActiveCandles(customCandles.candles);
        return;
      }

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
  }, [symbol, timeframe, marketSeed, marketRegime, customCandles]);

  // 7. Backtest Execution with IndexedDB Caching Layer
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

          const result = runBacktest(activeCandles, strategyParams, symbol, timeframe);
          const savedTimestamp = await setCachedBacktest(cacheKey, result);

          if (evaluationIdRef.current !== currentEvalId) return;

          setBacktestResult(result);
          setLastCalculatedAt(savedTimestamp);
          setCalculationStatus('calculated');
        });
      }
    })();
  }, [activeCandles, strategyParams, symbol, timeframe]);

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
      />

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
        onChangeParams={(newParams) => setStrategyParams(newParams)}
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
