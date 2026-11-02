'use client';

import React from 'react';
import { BacktestResult } from '@/types/trading';
import {
  TrendingUp,
  TrendingDown,
  Target,
  Percent,
  ShieldAlert,
  Award,
  Zap,
  DollarSign,
} from 'lucide-react';

interface StatsBarProps {
  result: BacktestResult;
  accountBalance: number;
}

export function StatsBar({ result, accountBalance }: StatsBarProps) {
  const isNetPositive = result.netR > 0;
  const isNetZero = result.netR === 0;

  return (
    <div className="w-full bg-[#0b101b] border-b border-slate-800/80 px-3 md:px-4 py-2 shrink-0 select-none">
      <div className="flex items-center justify-between gap-3 overflow-x-auto no-scrollbar">
        {/* Core Metric 1: Net R */}
        <div className="flex items-center gap-2.5 pr-4 border-r border-slate-800/80 shrink-0">
          <div
            className={`w-7 h-7 rounded flex items-center justify-center ${
              isNetPositive
                ? 'bg-emerald-500/10 text-emerald-400'
                : isNetZero
                ? 'bg-slate-800 text-slate-400'
                : 'bg-rose-500/10 text-rose-400'
            }`}
          >
            {isNetPositive ? (
              <TrendingUp className="w-4 h-4" />
            ) : (
              <TrendingDown className="w-4 h-4" />
            )}
          </div>
          <div>
            <div className="text-[10px] text-slate-400 uppercase tracking-wider font-medium">
              Net Performance
            </div>
            <div className="flex items-baseline gap-1.5 font-mono">
              <span
                className={`text-base font-bold ${
                  isNetPositive
                    ? 'text-emerald-400'
                    : isNetZero
                    ? 'text-slate-300'
                    : 'text-rose-400'
                }`}
              >
                {result.netR > 0 ? '+' : ''}
                {result.netR.toFixed(2)} R
              </span>
              <span
                className={`text-xs ${
                  result.totalPnlCurrency >= 0 ? 'text-emerald-500/80' : 'text-rose-500/80'
                }`}
              >
                ({result.totalPnlCurrency >= 0 ? '+' : '-'}${Math.abs(result.totalPnlCurrency).toFixed(2)})
              </span>
            </div>
          </div>
        </div>

        {/* Core Metric 2: Win Rate */}
        <div className="flex items-center gap-2.5 px-3 border-r border-slate-800/80 shrink-0">
          <div className="w-7 h-7 rounded bg-sky-500/10 text-sky-400 flex items-center justify-center">
            <Percent className="w-4 h-4" />
          </div>
          <div>
            <div className="text-[10px] text-slate-400 uppercase tracking-wider font-medium">
              Win Rate
            </div>
            <div className="flex items-center gap-2">
              <span className="text-sm font-bold text-slate-100 font-mono">
                {result.winRate.toFixed(1)}%
              </span>
              <div className="w-16 h-1.5 bg-slate-800 rounded-full overflow-hidden hidden sm:block">
                <div
                  className="h-full bg-emerald-500 rounded-full"
                  style={{ width: `${Math.min(result.winRate, 100)}%` }}
                />
              </div>
            </div>
          </div>
        </div>

        {/* Core Metric 3: Total Signals & Breakdown */}
        <div className="flex items-center gap-2.5 px-3 border-r border-slate-800/80 shrink-0">
          <div className="w-7 h-7 rounded bg-purple-500/10 text-purple-400 flex items-center justify-center">
            <Zap className="w-4 h-4" />
          </div>
          <div>
            <div className="text-[10px] text-slate-400 uppercase tracking-wider font-medium">
              Signals & Trades
            </div>
            <div className="flex items-center gap-2 text-xs font-mono">
              <span className="font-bold text-slate-100">{result.totalTrades}</span>
              <span className="text-emerald-400 text-[11px] font-semibold">{result.winningTrades}W</span>
              <span className="text-rose-400 text-[11px] font-semibold">{result.losingTrades}L</span>
              {result.unresolvedTrades !== undefined && result.unresolvedTrades > 0 && (
                <span className="text-amber-400 text-[11px] font-medium">{result.unresolvedTrades}Open</span>
              )}
              {result.breakevenTrades > 0 && (
                <span className="text-slate-400 text-[11px]">{result.breakevenTrades}BE</span>
              )}
            </div>
          </div>
        </div>

        {/* Core Metric 4: Profit Factor */}
        <div className="flex items-center gap-2.5 px-3 border-r border-slate-800/80 shrink-0">
          <div className="w-7 h-7 rounded bg-amber-500/10 text-amber-400 flex items-center justify-center">
            <Award className="w-4 h-4" />
          </div>
          <div>
            <div className="text-[10px] text-slate-400 uppercase tracking-wider font-medium">
              Profit Factor
            </div>
            <div className="font-mono text-sm font-bold text-slate-100">
              {result.profitFactor > 0 ? result.profitFactor.toFixed(2) : '0.00'}
            </div>
          </div>
        </div>

        {/* Core Metric 5: Average Win & Loss R */}
        <div className="flex items-center gap-2.5 px-3 border-r border-slate-800/80 shrink-0">
          <div className="w-7 h-7 rounded bg-emerald-500/10 text-emerald-400 flex items-center justify-center">
            <Target className="w-4 h-4" />
          </div>
          <div>
            <div className="text-[10px] text-slate-400 uppercase tracking-wider font-medium">
              Avg Win / Loss
            </div>
            <div className="flex items-center gap-1.5 font-mono text-xs">
              <span className="text-emerald-400 font-bold">
                +{result.avgWinR ? result.avgWinR.toFixed(2) : '0.00'}R
              </span>
              <span className="text-slate-500">/</span>
              <span className="text-rose-400 font-bold">
                -{result.avgLossR ? Math.abs(result.avgLossR).toFixed(2) : '0.00'}R
              </span>
            </div>
          </div>
        </div>

        {/* Core Metric 6: Max Drawdown */}
        <div className="flex items-center gap-2.5 px-3 border-r border-slate-800/80 shrink-0">
          <div className="w-7 h-7 rounded bg-rose-500/10 text-rose-400 flex items-center justify-center">
            <ShieldAlert className="w-4 h-4" />
          </div>
          <div>
            <div className="text-[10px] text-slate-400 uppercase tracking-wider font-medium">
              Max Drawdown
            </div>
            <div className="font-mono text-xs font-semibold text-rose-400">
              -{result.maxDrawdownR.toFixed(2)} R
              <span className="text-slate-400 text-[11px] ml-1">
                ({result.maxDrawdownPercent.toFixed(1)}%)
              </span>
            </div>
          </div>
        </div>

        {/* Core Metric 6: Expectancy */}
        <div className="flex items-center gap-2.5 px-3 border-r border-slate-800/80 shrink-0 hidden lg:flex">
          <div className="w-7 h-7 rounded bg-teal-500/10 text-teal-400 flex items-center justify-center">
            <Target className="w-4 h-4" />
          </div>
          <div>
            <div className="text-[10px] text-slate-400 uppercase tracking-wider font-medium">
              Expectancy
            </div>
            <div className="font-mono text-xs font-semibold text-slate-100">
              {result.expectancyR >= 0 ? '+' : ''}
              {result.expectancyR.toFixed(2)} R / trade
            </div>
          </div>
        </div>

        {/* Long / Short split */}
        <div className="flex items-center gap-3 pl-3 shrink-0 text-[11px] font-mono text-slate-400 hidden xl:flex border-r border-slate-800/80 pr-3">
          <div>
            <span className="text-emerald-400 font-semibold">Long:</span> {result.longWinRate}% (
            {result.longTradesCount})
          </div>
          <div>
            <span className="text-rose-400 font-semibold">Short:</span> {result.shortWinRate}% (
            {result.shortTradesCount})
          </div>
        </div>

        {/* Cost Model Distinction Badge */}
        <div className="flex items-center pl-3 shrink-0">
          <span
            title={
              result.isGrossSimulated
                ? 'Gross Simulated Results: Pure strategy simulation before broker commissions and financing fees.'
                : 'Simulated Results: Net of simulated spread.'
            }
            className="px-2 py-0.5 rounded text-[10px] font-mono font-medium border bg-sky-500/10 text-sky-400 border-sky-500/20 whitespace-nowrap"
          >
            {result.isGrossSimulated ? 'Gross Simulated (Pre-Cost)' : 'Net of Spread'}
          </span>
        </div>
      </div>
    </div>
  );
}
