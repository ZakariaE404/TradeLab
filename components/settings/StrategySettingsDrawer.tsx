'use client';

import React from 'react';
import { StrategyParameters, StrategyType } from '@/types/trading';
import { StrategyAParameters } from '@/types/strategyA';
import { STRATEGY_PRESETS, DEFAULT_STRATEGY_PARAMS } from '@/services/backtestEngine';
import { DEFAULT_STRATEGY_A_PARAMS } from '@/services/strategyA';
import { DEFAULT_STRATEGY_CONFIG, StrategyConfiguration } from '@/services/strategy/types';
import {
  X,
  Sliders,
  RotateCcw,
  Play,
  Sparkles,
  ShieldCheck,
  TrendingUp,
  Percent,
  Check,
  Compass,
  Layers,
  Filter,
  Activity,
  Target,
} from 'lucide-react';

interface StrategySettingsDrawerProps {
  isOpen: boolean;
  onClose: () => void;
  params: StrategyParameters;
  onChangeParams: (newParams: StrategyParameters) => void;
  onApplyAndRun: () => void;
}

export function StrategySettingsDrawer({
  isOpen,
  onClose,
  params,
  onChangeParams,
  onApplyAndRun,
}: StrategySettingsDrawerProps) {
  if (!isOpen) return null;

  const stratA = params.strategyA || DEFAULT_STRATEGY_A_PARAMS;
  const tradeLabConfig: StrategyConfiguration = {
    ...DEFAULT_STRATEGY_CONFIG,
    ...(params.tradeLabConfig || {}),
  };

  const handleUpdate = <K extends keyof StrategyParameters>(
    key: K,
    value: StrategyParameters[K]
  ) => {
    onChangeParams({
      ...params,
      [key]: value,
    });
  };

  const handleUpdateTradeLabConfig = <K extends keyof StrategyConfiguration>(
    key: K,
    value: StrategyConfiguration[K]
  ) => {
    const updated = {
      ...tradeLabConfig,
      [key]: value,
    };
    onChangeParams({
      ...params,
      tradeLabConfig: updated,
      riskRewardRatio: key === 'riskRewardRatio' ? (value as number) : params.riskRewardRatio,
    });
  };

  const handleUpdateStratA = <K extends keyof StrategyAParameters>(
    key: K,
    value: StrategyAParameters[K]
  ) => {
    const updated = {
      ...stratA,
      [key]: value,
    };
    onChangeParams({
      ...params,
      strategyA: updated,
      riskRewardRatio: key === 'riskRewardRatio' ? (value as number) : params.riskRewardRatio,
    });
  };

  const handleApplyPreset = (presetId: string) => {
    const preset = STRATEGY_PRESETS.find((p) => p.id === presetId);
    if (preset) {
      onChangeParams({
        ...params,
        ...preset.params,
      });
    }
  };

  const handleResetDefaults = () => {
    onChangeParams({ ...DEFAULT_STRATEGY_PARAMS });
  };

  return (
    <div className="fixed inset-y-0 right-0 w-80 md:w-96 bg-[#0c101a] border-l border-slate-800 shadow-2xl z-30 flex flex-col select-none">
      {/* Header */}
      <div className="h-14 px-4 bg-[#080b11] border-b border-slate-800 flex items-center justify-between shrink-0">
        <div className="flex items-center gap-2">
          <Sliders className="w-4 h-4 text-emerald-400" />
          <h2 className="text-sm font-bold text-slate-100">Strategy & Risk Engine</h2>
        </div>
        <button
          onClick={onClose}
          className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      {/* Scrollable Form Body */}
      <div className="flex-1 overflow-y-auto p-4 space-y-5 text-xs">
        {/* Section 1: Presets */}
        <div>
          <label className="block text-[11px] uppercase tracking-wider text-slate-400 font-semibold mb-2">
            Strategy Presets
          </label>
          <div className="grid grid-cols-1 gap-1.5">
            {STRATEGY_PRESETS.map((preset) => (
              <button
                key={preset.id}
                onClick={() => handleApplyPreset(preset.id)}
                className="text-left p-2 rounded bg-[#111726] hover:bg-[#161f33] border border-slate-800 hover:border-slate-700 transition-all group"
              >
                <div className="flex items-center justify-between">
                  <span className="font-semibold text-slate-200 group-hover:text-emerald-400 transition-colors">
                    {preset.name}
                  </span>
                </div>
                <div className="text-[10px] text-slate-400 mt-0.5 line-clamp-1">
                  {preset.description}
                </div>
              </button>
            ))}
          </div>
        </div>

        {/* Section 2: Strategy Architecture */}
        <div className="pt-3 border-t border-slate-800/80">
          <label className="block text-[11px] uppercase tracking-wider text-slate-400 font-semibold mb-2">
            Algorithm Logic
          </label>
          <select
            value={params.strategyType}
            onChange={(e) => handleUpdate('strategyType', e.target.value as StrategyType)}
            className="w-full bg-[#111726] border border-slate-800 rounded p-2 text-slate-200 font-mono text-xs focus:outline-none focus:border-emerald-500"
          >
            <option value="tradelab_strategy">★ TradeLab Multi-Regime Engine (Phase 3)</option>
            <option value="strategy_a">Strategy A: H1 Trend + M15 Rejection (Legacy)</option>
            <option value="ema_pullback">EMA Trend Pullback (Trend-Following)</option>
            <option value="breakout_retest">Donchian Breakout Channel</option>
            <option value="rsi_mean_reversion">RSI Extreme Reversion + Bollinger</option>
            <option value="macd_momentum">Fast/Slow Momentum Crossover</option>
          </select>
        </div>

        {/* Section 2A: TradeLab Phase 3 Multi-Regime Strategy Parameters */}
        {params.strategyType === 'tradelab_strategy' && (
          <div className="pt-3 border-t border-slate-800/80 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-[11px] uppercase tracking-wider text-emerald-400 font-semibold flex items-center gap-1.5">
                <Sparkles className="w-3.5 h-3.5" />
                <span>TradeLab Rule Parameters</span>
              </label>
              <span className="text-[10px] font-mono text-slate-400">Phase 3 Engine</span>
            </div>

            {/* Matrix Permutation Controls: Regime, Pattern, Direction */}
            <div className="p-2.5 rounded bg-[#111726] border border-slate-800 space-y-2.5">
              <div className="text-slate-200 font-semibold text-[11px] flex items-center gap-1.5">
                <Layers className="w-3.5 h-3.5 text-sky-400" />
                <span>Regime & Pattern Matrix</span>
              </div>

              {/* Regime Selector */}
              <div>
                <span className="text-[10px] text-slate-400 block mb-1">Market Regime</span>
                <div className="grid grid-cols-3 gap-1">
                  {(['TRENDING', 'RANGING', 'BOTH'] as const).map((reg) => (
                    <button
                      key={reg}
                      type="button"
                      onClick={() => handleUpdateTradeLabConfig('regime', reg)}
                      className={`py-1 text-[10px] font-bold rounded border transition-colors ${
                        tradeLabConfig.regime === reg
                          ? 'bg-sky-500 text-slate-950 border-sky-400 shadow-sm'
                          : 'bg-[#0a0f1d] text-slate-300 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      {reg}
                    </button>
                  ))}
                </div>
              </div>

              {/* Pattern Selector */}
              <div>
                <span className="text-[10px] text-slate-400 block mb-1">Entry Pattern</span>
                <div className="grid grid-cols-3 gap-1">
                  {(['REJECTION', 'ENGULFING', 'BOTH'] as const).map((pat) => (
                    <button
                      key={pat}
                      type="button"
                      onClick={() => handleUpdateTradeLabConfig('pattern', pat)}
                      className={`py-1 text-[10px] font-bold rounded border transition-colors ${
                        tradeLabConfig.pattern === pat
                          ? 'bg-emerald-500 text-slate-950 border-emerald-400 shadow-sm'
                          : 'bg-[#0a0f1d] text-slate-300 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      {pat}
                    </button>
                  ))}
                </div>
              </div>

              {/* Direction Selector */}
              <div>
                <span className="text-[10px] text-slate-400 block mb-1">Trade Direction</span>
                <div className="grid grid-cols-3 gap-1">
                  {(['BUY', 'SELL', 'BOTH'] as const).map((dir) => (
                    <button
                      key={dir}
                      type="button"
                      onClick={() => handleUpdateTradeLabConfig('direction', dir)}
                      className={`py-1 text-[10px] font-bold rounded border transition-colors ${
                        tradeLabConfig.direction === dir
                          ? 'bg-amber-500 text-slate-950 border-amber-400 shadow-sm'
                          : 'bg-[#0a0f1d] text-slate-300 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      {dir}
                    </button>
                  ))}
                </div>
              </div>
            </div>

            {/* H1 Trend & ADX Regime Filter Box */}
            <div className="p-2.5 rounded bg-[#111726] border border-slate-800 space-y-2">
              <div className="flex items-center gap-1.5 text-slate-200 font-semibold text-[11px]">
                <Compass className="w-3.5 h-3.5 text-indigo-400" />
                <span>H1 Trend & ADX Classification</span>
              </div>

              <div className="flex items-center justify-between">
                <span className="text-[10px] text-slate-400">EMA Slope Lookback</span>
                <span className="font-mono text-slate-200 font-bold">{tradeLabConfig.emaSlopeLookback} bars</span>
              </div>
              <input
                type="range"
                min={1}
                max={10}
                value={tradeLabConfig.emaSlopeLookback}
                onChange={(e) =>
                  handleUpdateTradeLabConfig('emaSlopeLookback', parseInt(e.target.value) || 3)
                }
                className="w-full accent-indigo-500 cursor-pointer"
              />

              <div className="grid grid-cols-2 gap-2 text-[10px] pt-1">
                <div>
                  <span className="text-slate-400">Trending ADX Threshold</span>
                  <input
                    type="number"
                    min={15}
                    max={40}
                    step={1}
                    value={tradeLabConfig.adxTrendingThreshold}
                    onChange={(e) =>
                      handleUpdateTradeLabConfig('adxTrendingThreshold', parseFloat(e.target.value) || 25)
                    }
                    className="w-full bg-[#0a0f1d] border border-slate-800 rounded p-1 font-mono text-slate-100 text-center"
                  />
                </div>
                <div>
                  <span className="text-slate-400">Ranging ADX Threshold</span>
                  <input
                    type="number"
                    min={10}
                    max={30}
                    step={1}
                    value={tradeLabConfig.adxRangingThreshold}
                    onChange={(e) =>
                      handleUpdateTradeLabConfig('adxRangingThreshold', parseFloat(e.target.value) || 20)
                    }
                    className="w-full bg-[#0a0f1d] border border-slate-800 rounded p-1 font-mono text-slate-100 text-center"
                  />
                </div>
              </div>
            </div>

            {/* Support/Resistance & Pattern Detection Box */}
            <div className="p-2.5 rounded bg-[#111726] border border-slate-800 space-y-2">
              <div className="flex items-center gap-1.5 text-slate-200 font-semibold text-[11px]">
                <Target className="w-3.5 h-3.5 text-emerald-400" />
                <span>Support/Resistance & Pattern Validation</span>
              </div>

              <div className="grid grid-cols-2 gap-2 text-[10px]">
                <div>
                  <span className="text-slate-400">Swing Left/Right Lag</span>
                  <input
                    type="number"
                    min={1}
                    max={6}
                    value={tradeLabConfig.swingRightBars}
                    onChange={(e) => {
                      const v = parseInt(e.target.value) || 3;
                      handleUpdateTradeLabConfig('swingRightBars', v);
                      handleUpdateTradeLabConfig('swingLeftBars', v);
                    }}
                    className="w-full bg-[#0a0f1d] border border-slate-800 rounded p-1 font-mono text-slate-100 text-center"
                  />
                </div>
                <div>
                  <span className="text-slate-400">Zone Tolerance (pips)</span>
                  <input
                    type="number"
                    min={0.5}
                    max={10}
                    step={0.5}
                    value={tradeLabConfig.zoneTolerancePips}
                    onChange={(e) =>
                      handleUpdateTradeLabConfig('zoneTolerancePips', parseFloat(e.target.value) || 2.0)
                    }
                    className="w-full bg-[#0a0f1d] border border-slate-800 rounded p-1 font-mono text-slate-100 text-center"
                  />
                </div>
              </div>

              <div>
                <div className="flex items-center justify-between text-slate-300">
                  <span className="text-[10px]">Min Rejection Wick / Body</span>
                  <span className="font-mono font-bold text-emerald-400">
                    {(tradeLabConfig.minRejectionWickRatio ?? 2.0).toFixed(1)}x
                  </span>
                </div>
                <input
                  type="range"
                  min="1.0"
                  max="4.0"
                  step="0.2"
                  value={tradeLabConfig.minRejectionWickRatio}
                  onChange={(e) =>
                    handleUpdateTradeLabConfig('minRejectionWickRatio', parseFloat(e.target.value) || 2.0)
                  }
                  className="w-full accent-emerald-500 cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between pt-1 border-t border-slate-800/60">
                <span className="text-[10px] text-slate-300">Require M15 EMA 50/200 Trend Filter</span>
                <input
                  type="checkbox"
                  checked={tradeLabConfig.requireM15EmaFilter}
                  onChange={(e) =>
                    handleUpdateTradeLabConfig('requireM15EmaFilter', e.target.checked)
                  }
                  className="w-3.5 h-3.5 accent-emerald-500 cursor-pointer"
                />
              </div>
            </div>

            {/* Disciplined SL & TP Configuration */}
            <div className="p-2.5 rounded bg-[#111726] border border-slate-800 space-y-2">
              <div className="flex items-center gap-1.5 text-slate-200 font-semibold text-[11px]">
                <ShieldCheck className="w-3.5 h-3.5 text-rose-400" />
                <span>Stop Loss & Take Profit Engine</span>
              </div>

              {/* SL Method Selection */}
              <div>
                <span className="text-[10px] text-slate-400 block mb-1">Stop Loss Method</span>
                <div className="grid grid-cols-2 gap-1">
                  {(['SWING', 'ATR'] as const).map((method) => (
                    <button
                      key={method}
                      type="button"
                      onClick={() => handleUpdateTradeLabConfig('stopLossMethod', method)}
                      className={`py-1 text-[10px] font-bold rounded border transition-colors ${
                        tradeLabConfig.stopLossMethod === method
                          ? 'bg-rose-500 text-white border-rose-400 shadow-sm'
                          : 'bg-[#0a0f1d] text-slate-300 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      {method} Stop Loss
                    </button>
                  ))}
                </div>
              </div>

              {tradeLabConfig.stopLossMethod === 'ATR' && (
                <div>
                  <span className="text-[10px] text-slate-400 block mb-1">ATR Multiplier</span>
                  <div className="grid grid-cols-3 gap-1">
                    {[1.0, 1.5, 2.0].map((mul) => (
                      <button
                        key={mul}
                        type="button"
                        onClick={() => handleUpdateTradeLabConfig('atrMultiplier', mul)}
                        className={`py-1 text-[10px] font-bold rounded border transition-colors ${
                          tradeLabConfig.atrMultiplier === mul
                            ? 'bg-amber-500 text-slate-950 border-amber-400'
                            : 'bg-[#0a0f1d] text-slate-300 border-slate-800'
                        }`}
                      >
                        {mul}x ATR
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {tradeLabConfig.stopLossMethod === 'SWING' && (
                <div className="grid grid-cols-2 gap-2 text-[10px]">
                  <div>
                    <span className="text-slate-400">SL Buffer (Pips)</span>
                    <input
                      type="number"
                      min={0.5}
                      max={10}
                      step={0.5}
                      value={tradeLabConfig.stopLossBufferPips}
                      onChange={(e) =>
                        handleUpdateTradeLabConfig('stopLossBufferPips', parseFloat(e.target.value) || 2.0)
                      }
                      className="w-full bg-[#0a0f1d] border border-slate-800 rounded p-1 font-mono text-slate-100 text-center"
                    />
                  </div>
                  <div>
                    <span className="text-slate-400">Min SL (Pips)</span>
                    <input
                      type="number"
                      min={2}
                      max={25}
                      step={1}
                      value={tradeLabConfig.minStopLossPips}
                      onChange={(e) =>
                        handleUpdateTradeLabConfig('minStopLossPips', parseFloat(e.target.value) || 5.0)
                      }
                      className="w-full bg-[#0a0f1d] border border-slate-800 rounded p-1 font-mono text-slate-100 text-center"
                    />
                  </div>
                </div>
              )}

              {/* Take Profit Method */}
              <div className="pt-1 border-t border-slate-800/60">
                <span className="text-[10px] text-slate-400 block mb-1">Take Profit Method</span>
                <div className="grid grid-cols-2 gap-1">
                  {(['RR', 'SUPPORT_RESISTANCE'] as const).map((method) => (
                    <button
                      key={method}
                      type="button"
                      onClick={() => handleUpdateTradeLabConfig('takeProfitMethod', method)}
                      className={`py-1 text-[10px] font-bold rounded border transition-colors ${
                        tradeLabConfig.takeProfitMethod === method
                          ? 'bg-emerald-500 text-slate-950 border-emerald-400 shadow-sm'
                          : 'bg-[#0a0f1d] text-slate-300 border-slate-800 hover:border-slate-700'
                      }`}
                    >
                      {method === 'RR' ? 'Risk:Reward (RR)' : 'Opposing S/R Zone'}
                    </button>
                  ))}
                </div>
              </div>

              {tradeLabConfig.takeProfitMethod === 'RR' && (
                <div>
                  <span className="text-[10px] text-slate-400 block mb-1">Risk:Reward Ratio</span>
                  <div className="grid grid-cols-4 gap-1">
                    {[1.0, 1.5, 2.0, 3.0].map((rr) => (
                      <button
                        key={rr}
                        type="button"
                        onClick={() => handleUpdateTradeLabConfig('riskRewardRatio', rr)}
                        className={`py-1 text-[10px] font-bold rounded border transition-colors ${
                          tradeLabConfig.riskRewardRatio === rr
                            ? 'bg-emerald-500 text-slate-950 border-emerald-400'
                            : 'bg-[#0a0f1d] text-slate-300 border-slate-800'
                        }`}
                      >
                        1:{rr}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="flex items-center justify-between pt-1 border-t border-slate-800/60">
                <span className="text-[10px] text-slate-300">Prevent Duplicate Open Trades</span>
                <input
                  type="checkbox"
                  checked={!tradeLabConfig.allowMultiplePositions}
                  onChange={(e) =>
                    handleUpdateTradeLabConfig('allowMultiplePositions', !e.target.checked)
                  }
                  className="w-3.5 h-3.5 accent-emerald-500 cursor-pointer"
                />
              </div>
            </div>
          </div>
        )}

        {/* Section 2B: Strategy A Specific Parameters */}
        {params.strategyType === 'strategy_a' && (
          <div className="pt-3 border-t border-slate-800/80 space-y-3">
            <div className="flex items-center justify-between">
              <label className="text-[11px] uppercase tracking-wider text-emerald-400 font-semibold">
                Strategy A Rule Parameters
              </label>
              <span className="text-[10px] font-mono text-slate-400">Multi-Timeframe</span>
            </div>

            {/* H1 Trend Filter Box */}
            <div className="p-2.5 rounded bg-[#111726] border border-slate-800 space-y-2">
              <div className="flex items-center gap-1.5 text-slate-200 font-semibold text-[11px]">
                <Compass className="w-3.5 h-3.5 text-sky-400" />
                <span>H1 Trend Filter</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[10px]">
                <div>
                  <span className="text-slate-400">Fast EMA (50)</span>
                  <input
                    type="number"
                    min={10}
                    max={100}
                    value={stratA.h1FastEmaPeriod}
                    onChange={(e) =>
                      handleUpdateStratA('h1FastEmaPeriod', parseInt(e.target.value) || 50)
                    }
                    className="w-full bg-[#0a0f1d] border border-slate-800 rounded p-1 font-mono text-slate-100 text-center"
                  />
                </div>
                <div>
                  <span className="text-slate-400">Slow EMA (200)</span>
                  <input
                    type="number"
                    min={50}
                    max={400}
                    value={stratA.h1SlowEmaPeriod}
                    onChange={(e) =>
                      handleUpdateStratA('h1SlowEmaPeriod', parseInt(e.target.value) || 200)
                    }
                    className="w-full bg-[#0a0f1d] border border-slate-800 rounded p-1 font-mono text-slate-100 text-center"
                  />
                </div>
              </div>

              <div className="flex items-center justify-between pt-1">
                <span className="text-[10px] text-slate-400">H1 Swing Lookback</span>
                <span className="font-mono text-slate-200 font-bold">{stratA.h1SwingLookback} bars</span>
              </div>
              <input
                type="range"
                min={2}
                max={6}
                value={stratA.h1SwingLookback}
                onChange={(e) =>
                  handleUpdateStratA('h1SwingLookback', parseInt(e.target.value))
                }
                className="w-full accent-sky-500 cursor-pointer"
              />

              <div className="flex items-center justify-between pt-1 border-t border-slate-800/60">
                <span className="text-[10px] text-slate-300">Require Confirmed Structure (HH/HL)</span>
                <input
                  type="checkbox"
                  checked={stratA.requireH1Structure}
                  onChange={(e) => handleUpdateStratA('requireH1Structure', e.target.checked)}
                  className="w-3.5 h-3.5 accent-emerald-500 cursor-pointer"
                />
              </div>
            </div>

            {/* M15 Entry Rules Box */}
            <div className="p-2.5 rounded bg-[#111726] border border-slate-800 space-y-2">
              <div className="flex items-center gap-1.5 text-slate-200 font-semibold text-[11px]">
                <Layers className="w-3.5 h-3.5 text-emerald-400" />
                <span>M15 Entry Conditions</span>
              </div>

              <div>
                <div className="flex items-center justify-between text-slate-300">
                  <span className="text-[10px]">Min Rejection Wick Ratio</span>
                  <span className="font-mono font-bold text-emerald-400">
                    {Math.round(stratA.minRejectionWickRatio * 100)}%
                  </span>
                </div>
                <input
                  type="range"
                  min="0.2"
                  max="0.6"
                  step="0.05"
                  value={stratA.minRejectionWickRatio}
                  onChange={(e) =>
                    handleUpdateStratA('minRejectionWickRatio', parseFloat(e.target.value))
                  }
                  className="w-full accent-emerald-500 cursor-pointer"
                />
              </div>

              <div>
                <div className="flex items-center justify-between text-slate-300">
                  <span className="text-[10px]">Support/Resistance Zone Buffer</span>
                  <span className="font-mono font-bold text-amber-400">
                    {stratA.zoneTolerancePips.toFixed(1)} pips
                  </span>
                </div>
                <input
                  type="range"
                  min="1.0"
                  max="10.0"
                  step="0.5"
                  value={stratA.zoneTolerancePips}
                  onChange={(e) =>
                    handleUpdateStratA('zoneTolerancePips', parseFloat(e.target.value))
                  }
                  className="w-full accent-amber-500 cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between pt-1 border-t border-slate-800/60">
                <span className="text-[10px] text-slate-300">M15 EMA 50/200 Direction Filter</span>
                <input
                  type="checkbox"
                  checked={stratA.requireM15EmaFilter}
                  onChange={(e) => handleUpdateStratA('requireM15EmaFilter', e.target.checked)}
                  className="w-3.5 h-3.5 accent-emerald-500 cursor-pointer"
                />
              </div>

              <div className="flex items-center justify-between pt-1 border-t border-slate-800/60">
                <span className="text-[10px] text-slate-300">Prevent Duplicate Open Trades</span>
                <input
                  type="checkbox"
                  checked={!stratA.allowMultiplePositions}
                  onChange={(e) => handleUpdateStratA('allowMultiplePositions', !e.target.checked)}
                  className="w-3.5 h-3.5 accent-emerald-500 cursor-pointer"
                />
              </div>
            </div>

            {/* Swing Stop Loss Configuration */}
            <div className="p-2.5 rounded bg-[#111726] border border-slate-800 space-y-2">
              <div className="flex items-center gap-1.5 text-slate-200 font-semibold text-[11px]">
                <ShieldCheck className="w-3.5 h-3.5 text-rose-400" />
                <span>Confirmed Swing Stop Loss</span>
              </div>
              <div className="grid grid-cols-2 gap-2 text-[10px]">
                <div>
                  <span className="text-slate-400">SL Buffer (Pips)</span>
                  <input
                    type="number"
                    min={0.5}
                    max={10}
                    step={0.5}
                    value={stratA.stopLossBufferPips}
                    onChange={(e) =>
                      handleUpdateStratA('stopLossBufferPips', parseFloat(e.target.value) || 2.0)
                    }
                    className="w-full bg-[#0a0f1d] border border-slate-800 rounded p-1 font-mono text-slate-100 text-center"
                  />
                </div>
                <div>
                  <span className="text-slate-400">Min SL (Pips)</span>
                  <input
                    type="number"
                    min={2}
                    max={25}
                    step={1}
                    value={stratA.minStopLossPips}
                    onChange={(e) =>
                      handleUpdateStratA('minStopLossPips', parseFloat(e.target.value) || 5.0)
                    }
                    className="w-full bg-[#0a0f1d] border border-slate-800 rounded p-1 font-mono text-slate-100 text-center"
                  />
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Section 3: Indicator Parameters */}
        <div className="pt-3 border-t border-slate-800/80 space-y-3">
          <label className="block text-[11px] uppercase tracking-wider text-slate-400 font-semibold mb-1">
            Indicator Windows
          </label>

          <div className="grid grid-cols-3 gap-2">
            <div>
              <span className="text-[10px] text-sky-400 font-mono">Fast EMA</span>
              <input
                type="number"
                min={5}
                max={100}
                value={params.fastEma}
                onChange={(e) => handleUpdate('fastEma', Math.max(2, parseInt(e.target.value) || 20))}
                className="w-full bg-[#111726] border border-slate-800 rounded p-1.5 font-mono text-center text-slate-100"
              />
            </div>
            <div>
              <span className="text-[10px] text-amber-400 font-mono">Slow EMA</span>
              <input
                type="number"
                min={10}
                max={200}
                value={params.slowEma}
                onChange={(e) => handleUpdate('slowEma', Math.max(5, parseInt(e.target.value) || 50))}
                className="w-full bg-[#111726] border border-slate-800 rounded p-1.5 font-mono text-center text-slate-100"
              />
            </div>
            <div>
              <span className="text-[10px] text-purple-400 font-mono">Trend EMA</span>
              <input
                type="number"
                min={20}
                max={500}
                value={params.trendEma}
                onChange={(e) =>
                  handleUpdate('trendEma', Math.max(10, parseInt(e.target.value) || 200))
                }
                className="w-full bg-[#111726] border border-slate-800 rounded p-1.5 font-mono text-center text-slate-100"
              />
            </div>
          </div>

          {/* RSI Parameters if applicable */}
          {params.strategyType === 'rsi_mean_reversion' && (
            <div className="grid grid-cols-3 gap-2 pt-2">
              <div>
                <span className="text-[10px] text-slate-400 font-mono">RSI Period</span>
                <input
                  type="number"
                  min={5}
                  max={50}
                  value={params.rsiPeriod}
                  onChange={(e) =>
                    handleUpdate('rsiPeriod', Math.max(2, parseInt(e.target.value) || 14))
                  }
                  className="w-full bg-[#111726] border border-slate-800 rounded p-1.5 font-mono text-center text-slate-100"
                />
              </div>
              <div>
                <span className="text-[10px] text-emerald-400 font-mono">Oversold</span>
                <input
                  type="number"
                  min={10}
                  max={45}
                  value={params.rsiOversold}
                  onChange={(e) =>
                    handleUpdate('rsiOversold', Math.max(5, parseInt(e.target.value) || 30))
                  }
                  className="w-full bg-[#111726] border border-slate-800 rounded p-1.5 font-mono text-center text-slate-100"
                />
              </div>
              <div>
                <span className="text-[10px] text-rose-400 font-mono">Overbought</span>
                <input
                  type="number"
                  min={55}
                  max={90}
                  value={params.rsiOverbought}
                  onChange={(e) =>
                    handleUpdate('rsiOverbought', Math.min(95, parseInt(e.target.value) || 70))
                  }
                  className="w-full bg-[#111726] border border-slate-800 rounded p-1.5 font-mono text-center text-slate-100"
                />
              </div>
            </div>
          )}
        </div>

        {/* Section 4: Risk-Reward & Stop Loss */}
        <div className="pt-3 border-t border-slate-800/80 space-y-3">
          <label className="block text-[11px] uppercase tracking-wider text-slate-400 font-semibold mb-1">
            Exit Rules & Risk/Reward
          </label>

          <div>
            <div className="flex items-center justify-between text-slate-300 mb-1">
              <span>Risk : Reward Ratio</span>
              <span className="font-mono font-bold text-emerald-400">
                1 : {params.riskRewardRatio.toFixed(1)}
              </span>
            </div>
            <input
              type="range"
              min="1.0"
              max="4.0"
              step="0.5"
              value={params.riskRewardRatio}
              onChange={(e) => handleUpdate('riskRewardRatio', parseFloat(e.target.value))}
              className="w-full accent-emerald-500 cursor-pointer"
            />
            <div className="flex justify-between text-[10px] text-slate-500 font-mono">
              <span>1:1</span>
              <span>1:2</span>
              <span>1:3</span>
              <span>1:4</span>
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between text-slate-300 mb-1">
              <span>Stop Loss ATR Multiplier</span>
              <span className="font-mono font-bold text-rose-400">
                {params.atrStopMultiplier.toFixed(1)}x ATR
              </span>
            </div>
            <input
              type="range"
              min="0.8"
              max="3.0"
              step="0.2"
              value={params.atrStopMultiplier}
              onChange={(e) => handleUpdate('atrStopMultiplier', parseFloat(e.target.value))}
              className="w-full accent-rose-500 cursor-pointer"
            />
          </div>

          {/* Trailing Stop Toggle */}
          <div className="flex items-center justify-between p-2 rounded bg-[#111726] border border-slate-800">
            <div>
              <div className="font-medium text-slate-200">Trailing Stop Loss</div>
              <div className="text-[10px] text-slate-400">
                Move SL to BE at +{params.trailingStopTriggerR}R
              </div>
            </div>
            <input
              type="checkbox"
              checked={params.useTrailingStop}
              onChange={(e) => handleUpdate('useTrailingStop', e.target.checked)}
              className="w-4 h-4 accent-emerald-500 cursor-pointer"
            />
          </div>
        </div>

        {/* Section 5: Money Management & Spread Drag */}
        <div className="pt-3 border-t border-slate-800/80 space-y-3">
          <label className="block text-[11px] uppercase tracking-wider text-slate-400 font-semibold mb-1">
            Account & Execution Model
          </label>

          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="text-[10px] text-slate-400">Simulated Capital</span>
              <select
                value={params.accountBalance}
                onChange={(e) => handleUpdate('accountBalance', parseInt(e.target.value))}
                className="w-full bg-[#111726] border border-slate-800 rounded p-1.5 text-slate-200 font-mono"
              >
                <option value={5000}>$5,000</option>
                <option value={10000}>$10,000</option>
                <option value={25000}>$25,000</option>
                <option value={50000}>$50,000</option>
                <option value={100000}>$100,000</option>
              </select>
            </div>

            <div>
              <span className="text-[10px] text-slate-400">Risk per Trade</span>
              <select
                value={params.riskPercent}
                onChange={(e) => handleUpdate('riskPercent', parseFloat(e.target.value))}
                className="w-full bg-[#111726] border border-slate-800 rounded p-1.5 text-slate-200 font-mono"
              >
                <option value={0.5}>0.5% (Conservative)</option>
                <option value={1.0}>1.0% (Standard)</option>
                <option value={2.0}>2.0% (Aggressive)</option>
              </select>
            </div>
          </div>

          <div className="flex items-center justify-between p-2 rounded bg-[#111726] border border-slate-800">
            <div>
              <div className="font-medium text-slate-200">Include Spread Drag</div>
              <div className="text-[10px] text-slate-400">
                Deduct {params.spreadPips} pips on fills
              </div>
            </div>
            <input
              type="checkbox"
              checked={params.includeSpread}
              onChange={(e) => handleUpdate('includeSpread', e.target.checked)}
              className="w-4 h-4 accent-emerald-500 cursor-pointer"
            />
          </div>

          {/* Slippage & Commission */}
          <div className="grid grid-cols-2 gap-2">
            <div>
              <span className="text-[10px] text-slate-400">Execution Slippage</span>
              <div className="flex items-center gap-1 mt-1">
                <input
                  type="number"
                  min="0"
                  max="5"
                  step="0.1"
                  value={params.slippagePips !== undefined ? params.slippagePips : 0.5}
                  onChange={(e) => handleUpdate('slippagePips', parseFloat(e.target.value) || 0)}
                  className="w-full bg-[#111726] border border-slate-800 rounded p-1.5 text-slate-200 font-mono text-xs"
                />
                <span className="text-[10px] text-slate-400">pips</span>
              </div>
            </div>

            <div>
              <span className="text-[10px] text-slate-400">ECN Commission</span>
              <div className="flex items-center gap-1 mt-1">
                <input
                  type="number"
                  min="0"
                  max="20"
                  step="0.5"
                  value={params.commissionPerLot !== undefined ? params.commissionPerLot : 7.0}
                  onChange={(e) => handleUpdate('commissionPerLot', parseFloat(e.target.value) || 0)}
                  className="w-full bg-[#111726] border border-slate-800 rounded p-1.5 text-slate-200 font-mono text-xs"
                />
                <span className="text-[10px] text-slate-400">$/lot</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Footer Actions */}
      <div className="p-3 bg-[#080b11] border-t border-slate-800 flex items-center justify-between gap-2 shrink-0">
        <button
          onClick={handleResetDefaults}
          className="px-3 py-2 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 hover:text-white text-xs flex items-center gap-1.5 transition-colors"
          title="Reset all settings to default"
        >
          <RotateCcw className="w-3.5 h-3.5" />
          <span>Reset</span>
        </button>

        <button
          onClick={() => {
            onApplyAndRun();
            onClose();
          }}
          className="flex-1 py-2 px-3 rounded bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold text-xs flex items-center justify-center gap-1.5 shadow-md shadow-emerald-500/20 active:scale-95 transition-all"
        >
          <Play className="w-3.5 h-3.5 fill-slate-950" />
          <span>Apply & Backtest</span>
        </button>
      </div>
    </div>
  );
}
