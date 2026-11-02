'use client';

import React, { useState, useEffect, useMemo, useCallback } from 'react';
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

  // 2. Active Strategy Parameters
  const [strategyParams, setStrategyParams] = useState<StrategyParameters>(DEFAULT_STRATEGY_PARAMS);

  // 3. Indicator Configuration
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

  // 5. Candles Generation / Retrieval
  const activeCandles = useMemo(() => {
    if (customCandles) {
      return customCandles.candles;
    }
    return generateForexCandles(symbol, timeframe, marketSeed, undefined, marketRegime);
  }, [symbol, timeframe, marketSeed, marketRegime, customCandles]);

  // 6. Backtest Execution
  const backtestResult = useMemo(() => {
    return runBacktest(activeCandles, strategyParams, symbol, timeframe);
  }, [activeCandles, strategyParams, symbol, timeframe]);

  // Derive selected trade from result
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
    setCustomCandles(null); // Clear custom CSV when switching symbols
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

  const handleToggleIndicator = (key: keyof IndicatorConfig) => {
    setIndicatorConfig((prev) => ({
      ...prev,
      [key]: !prev[key],
    }));
  };

  const handleImportCandles = (candles: Candle[], fileName: string) => {
    setCustomCandles({ fileName, candles });
    setSelectedTradeId(null);
  };

  const handleRunManualBacktest = () => {
    // Triggers recalculation by forcing refresh or re-evaluating with feedback animation
    setStrategyParams((prev) => ({ ...prev }));
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
