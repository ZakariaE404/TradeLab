'use client';

import React from 'react';
import {
  ForexSymbol,
  Timeframe,
  StrategyParameters,
  DataSourceMode,
  RealDataState,
} from '@/types/trading';
import { FOREX_SYMBOLS, TIMEFRAMES, MarketRegime } from '@/services/marketData';
import {
  SlidersHorizontal,
  Play,
  RotateCw,
  Upload,
  Activity,
  CheckCircle2,
  FileSpreadsheet,
  ChevronDown,
  Layers,
  Sparkles,
  Info,
  Database,
  Trash2,
  Loader2,
  Globe,
  Radio,
  RefreshCw,
  AlertTriangle,
} from 'lucide-react';

interface TopNavProps {
  symbol: ForexSymbol;
  onSelectSymbol: (symbol: ForexSymbol) => void;
  timeframe: Timeframe;
  onSelectTimeframe: (tf: Timeframe) => void;
  candleCount: number;
  marketRegime: MarketRegime;
  onChangeRegime: (regime: MarketRegime) => void;
  onRunBacktest: () => void;
  onRegenerateData: () => void;
  onOpenImportModal: () => void;
  onToggleSettings: () => void;
  isSettingsOpen: boolean;
  isCustomData: boolean;
  strategyParams: StrategyParameters;
  calculationStatus?: 'idle' | 'computing' | 'cached' | 'calculated';
  lastCalculatedAt?: number | null;
  onClearCache?: () => void;
  // Real Market Data Props
  dataSourceMode: DataSourceMode;
  onSelectDataSourceMode: (mode: DataSourceMode) => void;
  realDataState?: RealDataState;
  onRefreshRealData?: () => void;
  onChangeOutputsize?: (size: number) => void;
  outputsize?: number;
}

export function TopNav({
  symbol,
  onSelectSymbol,
  timeframe,
  onSelectTimeframe,
  candleCount,
  marketRegime,
  onChangeRegime,
  onRunBacktest,
  onRegenerateData,
  onOpenImportModal,
  onToggleSettings,
  isSettingsOpen,
  isCustomData,
  strategyParams,
  calculationStatus = 'calculated',
  lastCalculatedAt = null,
  onClearCache,
  dataSourceMode,
  onSelectDataSourceMode,
  realDataState,
  onRefreshRealData,
  onChangeOutputsize,
  outputsize = 500,
}: TopNavProps) {
  const symbolMeta = FOREX_SYMBOLS[symbol] || FOREX_SYMBOLS['XAUUSDm'];
  const allSymbols = Object.keys(FOREX_SYMBOLS) as ForexSymbol[];
  const allTimeframes = Object.keys(TIMEFRAMES) as Timeframe[];

  return (
    <header className="h-14 bg-[#080b11] border-b border-slate-800/90 px-3 md:px-4 flex items-center justify-between gap-3 select-none shrink-0 z-20">
      {/* Left: Branding & Pairs */}
      <div className="flex items-center gap-3 md:gap-4 overflow-x-auto no-scrollbar py-1">
        {/* Logo */}
        <div className="flex items-center gap-2 pr-2 border-r border-slate-800">
          <div className="w-7 h-7 rounded-md bg-gradient-to-br from-emerald-500 to-teal-700 flex items-center justify-center shadow-lg shadow-emerald-500/20 text-black font-black text-xs tracking-tighter">
            TL
          </div>
          <div>
            <div className="flex items-center gap-1.5 leading-none">
              <span className="font-bold text-sm tracking-tight text-white font-mono">
                Trade<span className="text-emerald-400">Lab</span>
              </span>
              <span className="text-[9px] uppercase tracking-wider px-1 py-0.5 rounded bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 font-semibold">
                MVP
              </span>
            </div>
            <div className="text-[9px] text-slate-500 hidden sm:block tracking-wide">
              Forex Strategy & Backtest Terminal
            </div>
          </div>
        </div>

        {/* Mode Selector Pill: DEMO vs REAL */}
        <div className="flex items-center bg-[#111726] p-0.5 rounded border border-slate-800 shrink-0">
          <button
            onClick={() => onSelectDataSourceMode('DEMO')}
            className={`px-2.5 py-1 rounded text-xs font-mono font-bold transition-all cursor-pointer ${
              dataSourceMode === 'DEMO'
                ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 shadow-sm'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            DEMO
          </button>
          <button
            onClick={() => onSelectDataSourceMode('REAL')}
            className={`px-2.5 py-1 rounded text-xs font-mono font-bold transition-all flex items-center gap-1 cursor-pointer ${
              dataSourceMode === 'REAL'
                ? 'bg-amber-500 text-slate-950 shadow-md shadow-amber-500/20'
                : 'text-amber-400 hover:text-amber-300 hover:bg-amber-500/10'
            }`}
          >
            <Radio className="w-3 h-3" />
            <span>REAL (Twelve Data)</span>
          </button>
        </div>

        {/* Symbol Selector Dropdown */}
        <div className="relative flex items-center">
          <select
            value={symbol}
            onChange={(e) => onSelectSymbol(e.target.value as ForexSymbol)}
            className="appearance-none bg-[#111726] hover:bg-[#161f33] text-slate-100 text-xs font-mono font-bold pl-2.5 pr-7 py-1.5 rounded border border-slate-800 hover:border-slate-700 focus:outline-none focus:border-emerald-500 cursor-pointer transition-colors"
          >
            {allSymbols.map((s) => (
              <option key={s} value={s} className="bg-[#111726] text-slate-200">
                {dataSourceMode === 'REAL'
                  ? `[REAL] ${s === 'XAUUSDm' ? 'XAU/USD' : s} (${FOREX_SYMBOLS[s].name.split('/')[0].trim()})`
                  : `[DEMO] ${s} (${FOREX_SYMBOLS[s].name.split('/')[0].trim()})`}
              </option>
            ))}
          </select>
          <ChevronDown className="w-3.5 h-3.5 text-slate-400 absolute right-2 pointer-events-none" />
        </div>

        {/* Timeframe Buttons */}
        <div className="flex items-center bg-[#111726] p-0.5 rounded border border-slate-800">
          {allTimeframes.map((tf) => (
            <button
              key={tf}
              onClick={() => onSelectTimeframe(tf)}
              className={`px-2 py-1 rounded text-xs font-mono font-medium transition-colors ${
                timeframe === tf
                  ? dataSourceMode === 'REAL'
                    ? 'bg-amber-500 text-slate-950 font-bold shadow-sm'
                    : 'bg-emerald-500 text-slate-950 font-bold shadow-sm'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
              }`}
            >
              {TIMEFRAMES[tf].label}
            </button>
          ))}
        </div>

        {/* Data Status Indicator */}
        <div className="hidden lg:flex items-center gap-2 pl-2 border-l border-slate-800 text-xs text-slate-400">
          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-[#0d1322] border border-slate-800/80">
            <span
              className={`w-2 h-2 rounded-full ${
                dataSourceMode === 'REAL'
                  ? realDataState?.isLoading
                    ? 'bg-amber-400 animate-spin'
                    : realDataState?.error
                    ? 'bg-rose-500'
                    : 'bg-amber-400'
                  : isCustomData
                  ? 'bg-amber-400'
                  : 'bg-emerald-400 animate-pulse'
              }`}
            />
            <span className="font-mono text-[11px] text-slate-300 font-semibold">
              {dataSourceMode === 'REAL'
                ? 'TWELVE DATA'
                : isCustomData
                ? 'CUSTOM CSV'
                : 'SYNTHETIC DEMO'}
            </span>
            <span className="text-slate-600">|</span>
            <span className="font-mono text-[11px] text-slate-400">{candleCount} Bars</span>
            <span className="text-slate-600">|</span>
            <span className="text-[10px] text-slate-500 font-mono">
              Sprd: {symbolMeta.typicalSpreadPips}p
            </span>
            {dataSourceMode === 'REAL' && realDataState?.isCurrentCandleForming && (
              <>
                <span className="text-slate-600">|</span>
                <span className="px-1.5 py-0.2 rounded bg-amber-500/15 text-amber-300 text-[10px] font-mono border border-amber-500/30">
                  Forming Bar
                </span>
              </>
            )}
          </div>

          {/* Historical Bar Count / Date Range Selector (for REAL data) */}
          {dataSourceMode === 'REAL' && onChangeOutputsize && (
            <div className="flex items-center">
              <select
                value={outputsize}
                onChange={(e) => onChangeOutputsize(parseInt(e.target.value, 10))}
                className="bg-[#111726] hover:bg-[#161f33] text-[11px] font-mono text-slate-300 py-1 px-2 rounded border border-slate-800 hover:border-slate-700 focus:outline-none cursor-pointer"
                title="Select historical sample depth from Twelve Data"
              >
                <option value={300}>Last 300 Bars</option>
                <option value={500}>Last 500 Bars</option>
                <option value={1000}>Last 1,000 Bars</option>
                <option value={2000}>Last 2,000 Bars</option>
              </select>
            </div>
          )}

          {/* Engine Calculation & Cache Status Badge */}
          <div className="flex items-center gap-1.5 px-2 py-1 rounded bg-[#0f172a] border border-slate-800/80 text-[11px] font-mono">
            {calculationStatus === 'computing' ? (
              <span className="flex items-center gap-1 text-amber-400 font-semibold animate-pulse">
                <Loader2 className="w-3 h-3 animate-spin" />
                <span>Computing...</span>
              </span>
            ) : calculationStatus === 'cached' ? (
              <span
                className="flex items-center gap-1 text-sky-400 font-semibold"
                title="Loaded from IndexedDB local cache"
              >
                <Database className="w-3 h-3 text-sky-400" />
                <span>Cached</span>
                {lastCalculatedAt && (
                  <span className="text-slate-400 text-[10px] ml-0.5">
                    ({new Date(lastCalculatedAt).toISOString().substring(11, 19)})
                  </span>
                )}
              </span>
            ) : (
              <span className="flex items-center gap-1 text-emerald-400 font-semibold">
                <CheckCircle2 className="w-3 h-3 text-emerald-400" />
                <span>Computed</span>
                {lastCalculatedAt && (
                  <span className="text-slate-400 text-[10px] ml-0.5">
                    ({new Date(lastCalculatedAt).toISOString().substring(11, 19)})
                  </span>
                )}
              </span>
            )}
          </div>

          {/* Market Regime Switcher (only for synthetic DEMO data) */}
          {dataSourceMode === 'DEMO' && !isCustomData && (
            <div className="flex items-center">
              <select
                value={marketRegime}
                onChange={(e) => onChangeRegime(e.target.value as MarketRegime)}
                className="bg-[#111726] hover:bg-[#161f33] text-[11px] text-slate-300 py-1 px-2 rounded border border-slate-800 hover:border-slate-700 focus:outline-none cursor-pointer"
                title="Select simulated market environment"
              >
                <option value="mixed">Regime: Mixed Cycles</option>
                <option value="trending_bull">Regime: Bullish Trend</option>
                <option value="trending_bear">Regime: Bearish Trend</option>
                <option value="ranging_high_vol">Regime: Volatile Range</option>
              </select>
            </div>
          )}
        </div>
      </div>

      {/* Right: Actions & Settings */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Real Data Manual Refresh Button */}
        {dataSourceMode === 'REAL' && onRefreshRealData && (
          <button
            onClick={onRefreshRealData}
            disabled={realDataState?.isLoading}
            title="Fetch fresh real market data from Twelve Data"
            className="p-1.5 px-2.5 rounded bg-amber-500/10 hover:bg-amber-500/20 border border-amber-500/30 text-amber-300 hover:text-white text-xs font-mono font-semibold flex items-center gap-1.5 transition-colors cursor-pointer disabled:opacity-40"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${realDataState?.isLoading ? 'animate-spin' : ''}`} />
            <span className="hidden sm:inline">Refresh Data</span>
          </button>
        )}

        {/* Clear Cache Button */}
        {onClearCache && (
          <button
            onClick={onClearCache}
            title="Clear IndexedDB & LocalStorage cache"
            className="p-1.5 text-slate-400 hover:text-rose-300 hover:bg-rose-500/10 border border-transparent hover:border-rose-500/30 rounded transition-colors flex items-center gap-1 text-xs cursor-pointer"
          >
            <Trash2 className="w-3.5 h-3.5" />
            <span className="hidden 2xl:inline">Clear Cache</span>
          </button>
        )}

        {/* Re-generate Demo Data (DEMO only) */}
        {dataSourceMode === 'DEMO' && !isCustomData && (
          <button
            onClick={onRegenerateData}
            title="Generate new deterministic sample"
            className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-[#111726] border border-transparent hover:border-slate-800 rounded transition-colors hidden sm:flex items-center gap-1.5 text-xs"
          >
            <RotateCw className="w-3.5 h-3.5" />
            <span className="hidden xl:inline">New Sample</span>
          </button>
        )}

        {/* Import CSV Modal Button */}
        {dataSourceMode === 'DEMO' && (
          <button
            onClick={onOpenImportModal}
            title="Import custom OHLCV CSV data"
            className="p-1.5 text-slate-400 hover:text-slate-200 hover:bg-[#111726] border border-transparent hover:border-slate-800 rounded transition-colors flex items-center gap-1.5 text-xs"
          >
            <Upload className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">Import CSV</span>
          </button>
        )}

        {/* Primary Action: Run Backtest */}
        <button
          onClick={onRunBacktest}
          className="flex items-center gap-1.5 px-3 py-1.5 rounded bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs shadow-md shadow-emerald-500/20 active:scale-95 transition-all cursor-pointer"
        >
          <Play className="w-3.5 h-3.5 fill-slate-950" />
          <span>Run Backtest</span>
        </button>

        {/* Strategy Settings Drawer Toggle */}
        <button
          onClick={onToggleSettings}
          className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded border text-xs font-medium transition-colors ${
            isSettingsOpen
              ? 'bg-[#1e273d] border-emerald-500/50 text-emerald-400'
              : 'bg-[#111726] border-slate-800 hover:border-slate-700 text-slate-300 hover:text-white'
          }`}
          title="Adjust strategy parameters & risk controls"
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          <span className="hidden md:inline">Strategy</span>
        </button>
      </div>
    </header>
  );
}
