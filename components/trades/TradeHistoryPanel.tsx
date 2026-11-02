'use client';

import React, { useState, useMemo } from 'react';
import { BacktestResult, Trade, TradeStatus, TradeDirection } from '@/types/trading';
import { FOREX_SYMBOLS } from '@/services/marketData';
import {
  ChevronUp,
  ChevronDown,
  Download,
  Filter,
  BarChart3,
  ListOrdered,
  Crosshair,
  TrendingUp,
  AlertCircle,
  Search,
} from 'lucide-react';

interface TradeHistoryPanelProps {
  result: BacktestResult;
  selectedTrade: Trade | null;
  onSelectTrade: (trade: Trade) => void;
  isCollapsed: boolean;
  onToggleCollapse: () => void;
}

type TabType = 'trades' | 'equity' | 'analytics';
export type FilterStatus = 'ALL' | 'BUY' | 'SELL' | 'WIN' | 'LOSS' | 'UNRESOLVED';

function formatTradeDateTime(seconds: number): string {
  if (!seconds || seconds <= 0) return '—';
  const d = new Date(seconds * 1000);
  const year = d.getUTCFullYear();
  const month = String(d.getUTCMonth() + 1).padStart(2, '0');
  const day = String(d.getUTCDate()).padStart(2, '0');
  const hours = String(d.getUTCHours()).padStart(2, '0');
  const minutes = String(d.getUTCMinutes()).padStart(2, '0');
  return `${year}-${month}-${day} ${hours}:${minutes}`;
}

export function TradeHistoryPanel({
  result,
  selectedTrade,
  onSelectTrade,
  isCollapsed,
  onToggleCollapse,
}: TradeHistoryPanelProps) {
  const [activeTab, setActiveTab] = useState<TabType>('trades');
  const [statusFilter, setStatusFilter] = useState<FilterStatus>('ALL');
  const [searchQuery, setSearchQuery] = useState('');

  // Counts for filter pills
  const filterCounts = useMemo(() => {
    let buyCount = 0;
    let sellCount = 0;
    let winCount = 0;
    let lossCount = 0;
    let unresolvedCount = 0;

    for (const t of result.trades) {
      const isBuy = t.direction === 'BUY' || t.direction === 'LONG';
      const isSell = t.direction === 'SELL' || t.direction === 'SHORT';
      if (isBuy) buyCount++;
      if (isSell) sellCount++;
      if (t.status === 'WIN') winCount++;
      if (t.status === 'LOSS') lossCount++;
      if (t.status === 'UNRESOLVED' || t.status === 'OPEN') unresolvedCount++;
    }

    return { buyCount, sellCount, winCount, lossCount, unresolvedCount };
  }, [result.trades]);

  // Filtered trades list
  const filteredTrades = useMemo(() => {
    return result.trades.filter((t) => {
      const isBuy = t.direction === 'BUY' || t.direction === 'LONG';
      const isSell = t.direction === 'SELL' || t.direction === 'SHORT';
      const isUnresolved = t.status === 'UNRESOLVED' || t.status === 'OPEN';

      // Status filter
      if (statusFilter === 'BUY' && !isBuy) return false;
      if (statusFilter === 'SELL' && !isSell) return false;
      if (statusFilter === 'WIN' && t.status !== 'WIN') return false;
      if (statusFilter === 'LOSS' && t.status !== 'LOSS') return false;
      if (statusFilter === 'UNRESOLVED' && !isUnresolved) return false;

      // Query filter
      if (searchQuery.trim()) {
        const query = searchQuery.toLowerCase();
        return (
          t.id.toLowerCase().includes(query) ||
          t.direction.toLowerCase().includes(query) ||
          t.status.toLowerCase().includes(query) ||
          t.exitReason.toLowerCase().includes(query) ||
          t.pnlR.toString().includes(query) ||
          (t.signalReason && t.signalReason.toLowerCase().includes(query))
        );
      }
      return true;
    });
  }, [result.trades, statusFilter, searchQuery]);

  // Export to CSV function
  const handleExportCSV = () => {
    if (result.trades.length === 0) return;

    const headers = [
      'TradeID',
      'Index',
      'Symbol',
      'Timeframe',
      'Direction',
      'EntryTime',
      'EntryPrice',
      'StopLoss',
      'TakeProfit',
      'ExitTime',
      'ExitPrice',
      'ExitReason',
      'Status',
      'PnL_R',
      'PnL_Pips',
      'PnL_USD',
      'HoldingBars',
    ];

    const rows = result.trades.map((t) => [
      t.id,
      t.index,
      t.symbol,
      t.timeframe,
      t.direction,
      new Date(t.entryTime * 1000).toISOString(),
      t.entryPrice,
      t.stopLoss,
      t.takeProfit,
      t.exitTime ? new Date(t.exitTime * 1000).toISOString() : '',
      t.exitPrice || '',
      t.exitReason,
      t.status,
      t.pnlR,
      t.pnlPips,
      t.pnlCurrency,
      t.holdingBars,
    ]);

    const csvContent =
      'data:text/csv;charset=utf-8,' +
      [headers.join(','), ...rows.map((e) => e.join(','))].join('\n');

    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `TradeLab_Backtest_${Date.now()}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div
      className={`w-full bg-[#090d16] border-t border-slate-800 transition-all duration-200 flex flex-col shrink-0 ${
        isCollapsed ? 'h-9' : 'h-64 md:h-72'
      }`}
    >
      {/* Header Bar */}
      <div className="h-9 px-3 md:px-4 bg-[#0d121f] flex items-center justify-between border-b border-slate-800/80 text-xs shrink-0 select-none">
        {/* Left: Tab Switchers */}
        <div className="flex items-center gap-1">
          <button
            onClick={() => {
              if (isCollapsed) onToggleCollapse();
              setActiveTab('trades');
            }}
            className={`px-3 py-1 rounded text-xs font-medium flex items-center gap-1.5 transition-colors ${
              activeTab === 'trades' && !isCollapsed
                ? 'bg-slate-800 text-white font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <ListOrdered className="w-3.5 h-3.5" />
            <span>Trade Log ({result.trades.length})</span>
          </button>

          <button
            onClick={() => {
              if (isCollapsed) onToggleCollapse();
              setActiveTab('equity');
            }}
            className={`px-3 py-1 rounded text-xs font-medium flex items-center gap-1.5 transition-colors ${
              activeTab === 'equity' && !isCollapsed
                ? 'bg-slate-800 text-white font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <TrendingUp className="w-3.5 h-3.5" />
            <span>Equity Curve</span>
          </button>

          <button
            onClick={() => {
              if (isCollapsed) onToggleCollapse();
              setActiveTab('analytics');
            }}
            className={`px-3 py-1 rounded text-xs font-medium flex items-center gap-1.5 transition-colors ${
              activeTab === 'analytics' && !isCollapsed
                ? 'bg-slate-800 text-white font-semibold'
                : 'text-slate-400 hover:text-slate-200'
            }`}
          >
            <BarChart3 className="w-3.5 h-3.5" />
            <span>Diagnostics</span>
          </button>
        </div>

        {/* Right: Filter, CSV Export, Collapse */}
        <div className="flex items-center gap-2">
          {!isCollapsed && activeTab === 'trades' && (
            <div className="hidden sm:flex items-center gap-1 bg-[#111726] p-0.5 rounded border border-slate-800 text-[11px]">
              {(
                [
                  { id: 'ALL', label: `ALL (${result.trades.length})` },
                  { id: 'BUY', label: `BUY (${filterCounts.buyCount})` },
                  { id: 'SELL', label: `SELL (${filterCounts.sellCount})` },
                  { id: 'WIN', label: `WINS (${filterCounts.winCount})` },
                  { id: 'LOSS', label: `LOSSES (${filterCounts.lossCount})` },
                  { id: 'UNRESOLVED', label: `OPEN (${filterCounts.unresolvedCount})` },
                ] as { id: FilterStatus; label: string }[]
              ).map(({ id, label }) => (
                <button
                  key={id}
                  onClick={() => setStatusFilter(id)}
                  className={`px-2 py-0.5 rounded transition-colors text-[10px] ${
                    statusFilter === id
                      ? 'bg-slate-700 text-white font-semibold'
                      : 'text-slate-400 hover:text-slate-200'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          )}

          <button
            onClick={handleExportCSV}
            disabled={result.trades.length === 0}
            title="Export trades to CSV"
            className="p-1 px-2 rounded bg-[#111726] hover:bg-[#1a233a] border border-slate-800 text-slate-300 hover:text-white text-[11px] flex items-center gap-1 disabled:opacity-40 transition-colors"
          >
            <Download className="w-3 h-3" />
            <span className="hidden md:inline">Export CSV</span>
          </button>

          <button
            onClick={onToggleCollapse}
            title={isCollapsed ? 'Expand Panel' : 'Collapse Panel'}
            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition-colors"
          >
            {isCollapsed ? <ChevronUp className="w-4 h-4" /> : <ChevronDown className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* Panel Body (when expanded) */}
      {!isCollapsed && (
        <div className="flex-1 overflow-auto bg-[#090d16]">
          {/* TAB 1: Trade Log Table */}
          {activeTab === 'trades' && (
            <div className="w-full h-full flex flex-col">
              {filteredTrades.length === 0 ? (
                <div className="flex-1 flex flex-col items-center justify-center text-slate-500 py-10">
                  <AlertCircle className="w-8 h-8 mb-2 opacity-40" />
                  <p className="text-xs">No trades match the current filter or strategy run.</p>
                </div>
              ) : (
                <div className="overflow-x-auto overflow-y-auto">
                  <table className="w-full text-left border-collapse text-xs font-mono">
                    <thead className="sticky top-0 bg-[#0d121f] text-slate-400 text-[11px] border-b border-slate-800 uppercase tracking-wider select-none z-10">
                      <tr>
                        <th className="py-2 px-3">#</th>
                        <th className="py-2 px-3">Date & Time</th>
                        <th className="py-2 px-3">Direction</th>
                        <th className="py-2 px-3">Entry</th>
                        <th className="py-2 px-3">Stop Loss</th>
                        <th className="py-2 px-3">Take Profit</th>
                        <th className="py-2 px-3">Exit</th>
                        <th className="py-2 px-3">Outcome</th>
                        <th className="py-2 px-3">R Multiple</th>
                        <th className="py-2 px-3">PnL ($)</th>
                        <th className="py-2 px-3 text-right">Action</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-800/50 text-[11px]">
                      {filteredTrades.map((t) => {
                        const isSelected = selectedTrade?.id === t.id;
                        const isWin = t.status === 'WIN';
                        const isLoss = t.status === 'LOSS';
                        const isUnresolved = t.status === 'UNRESOLVED' || t.status === 'OPEN';
                        const isBuy = t.direction === 'BUY' || t.direction === 'LONG';
                        const digits = FOREX_SYMBOLS[t.symbol]?.digits || 5;

                        return (
                          <tr
                            key={t.id}
                            onClick={() => onSelectTrade(t)}
                            className={`cursor-pointer transition-colors ${
                              isSelected
                                ? 'bg-sky-500/15 border-l-2 border-sky-400'
                                : 'hover:bg-[#111726]/60'
                            }`}
                          >
                            <td className="py-1.5 px-3 text-slate-400 font-semibold">{t.index}</td>
                            <td className="py-1.5 px-3 text-slate-300 whitespace-nowrap">
                              {formatTradeDateTime(t.entryTime)}
                            </td>
                            <td className="py-1.5 px-3">
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-bold ${
                                  isBuy
                                    ? 'bg-emerald-500/15 text-emerald-400 border border-emerald-500/20'
                                    : 'bg-rose-500/15 text-rose-400 border border-rose-500/20'
                                }`}
                              >
                                {isBuy ? 'BUY' : 'SELL'}
                              </span>
                            </td>
                            <td className="py-1.5 px-3 text-slate-200 font-semibold">
                              {t.entryPrice.toFixed(digits)}
                            </td>
                            <td className="py-1.5 px-3 text-rose-400/90 font-medium">
                              {t.stopLoss.toFixed(digits)}
                            </td>
                            <td className="py-1.5 px-3 text-emerald-400/90 font-medium">
                              {t.takeProfit.toFixed(digits)}
                            </td>
                            <td className="py-1.5 px-3 text-slate-200">
                              {t.exitPrice && !isUnresolved ? t.exitPrice.toFixed(digits) : (
                                <span className="text-amber-400/90 font-medium">Active</span>
                              )}
                            </td>
                            <td className="py-1.5 px-3">
                              <span
                                className={`px-1.5 py-0.5 rounded text-[10px] font-semibold ${
                                  isWin
                                    ? 'bg-emerald-500/10 text-emerald-400 border border-emerald-500/20'
                                    : isLoss
                                    ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20'
                                    : isUnresolved
                                    ? 'bg-amber-500/10 text-amber-400 border border-amber-500/20'
                                    : 'bg-slate-800 text-slate-300'
                                }`}
                              >
                                {t.status} {t.exitReason && t.exitReason !== 'UNRESOLVED' ? `(${t.exitReason})` : ''}
                              </span>
                            </td>
                            <td
                              className={`py-1.5 px-3 font-bold ${
                                t.pnlR > 0
                                  ? 'text-emerald-400'
                                  : t.pnlR < 0
                                  ? 'text-rose-400'
                                  : 'text-slate-400'
                              }`}
                            >
                              {t.pnlR > 0 ? '+' : ''}
                              {t.pnlR.toFixed(2)} R
                            </td>
                            <td
                              className={`py-1.5 px-3 font-semibold ${
                                t.pnlCurrency > 0
                                  ? 'text-emerald-400'
                                  : t.pnlCurrency < 0
                                  ? 'text-rose-400'
                                  : 'text-slate-400'
                              }`}
                            >
                              {t.pnlCurrency > 0 ? '+' : ''}${t.pnlCurrency.toFixed(2)}
                            </td>
                            <td className="py-1.5 px-3 text-right">
                              <button
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onSelectTrade(t);
                                }}
                                className="px-2 py-0.5 rounded bg-slate-800 hover:bg-sky-500/20 text-slate-300 hover:text-sky-300 text-[10px] transition-colors"
                              >
                                Focus
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                                onClick={(e) => {
                                  e.stopPropagation();
                                  onSelectTrade(t);
                                }}
                                className="px-2 py-0.5 rounded bg-slate-800 hover:bg-sky-500/20 text-slate-300 hover:text-sky-300 text-[10px] transition-colors"
                              >
                                Focus
                              </button>
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          )}

          {/* TAB 2: Equity Curve Visualization */}
          {activeTab === 'equity' && (
            <div className="w-full h-full p-4 flex flex-col justify-between">
              <div className="flex items-center justify-between text-xs text-slate-400 mb-2">
                <div className="flex items-center gap-4">
                  <div>
                    Net R Progression:
                    <strong
                      className={`ml-1 font-mono font-bold ${
                        result.netR >= 0 ? 'text-emerald-400' : 'text-rose-400'
                      }`}
                    >
                      {result.netR > 0 ? '+' : ''}
                      {result.netR} R
                    </strong>
                  </div>
                  <div>
                    Max Drawdown:
                    <strong className="ml-1 font-mono font-bold text-rose-400">
                      -{result.maxDrawdownR} R ({result.maxDrawdownPercent}%)
                    </strong>
                  </div>
                </div>
                <div className="text-[11px] text-slate-500">
                  {result.equityCurve.length - 1} Closed Trades
                </div>
              </div>

              {/* Responsive SVG Chart */}
              <div className="w-full h-44 bg-[#070a10] rounded border border-slate-800/80 p-2 relative overflow-hidden">
                <EquitySvgChart equityCurve={result.equityCurve} />
              </div>
            </div>
          )}

          {/* TAB 3: Strategy Diagnostics */}
          {activeTab === 'analytics' && (
            <div className="p-4 space-y-4 text-xs">
              <div className="grid grid-cols-2 md:grid-cols-4 gap-3">
                <div className="p-3 rounded bg-[#0d121f] border border-slate-800">
                  <div className="text-[10px] text-slate-400 uppercase tracking-wider">
                    Win / Loss Streaks
                  </div>
                  <div className="mt-1 flex items-baseline gap-2 font-mono">
                    <span className="text-emerald-400 font-bold text-sm">
                      {result.maxConsecutiveWins} Max Wins
                    </span>
                    <span className="text-slate-600">/</span>
                    <span className="text-rose-400 font-bold text-sm">
                      {result.maxConsecutiveLosses} Max Losses
                    </span>
                  </div>
                </div>

                <div className="p-3 rounded bg-[#0d121f] border border-slate-800">
                  <div className="text-[10px] text-slate-400 uppercase tracking-wider">
                    Avg Win vs Avg Loss
                  </div>
                  <div className="mt-1 flex items-baseline gap-2 font-mono">
                    <span className="text-emerald-400 font-bold text-sm">
                      +{result.avgWinR} R
                    </span>
                    <span className="text-slate-600">/</span>
                    <span className="text-rose-400 font-bold text-sm">
                      -{result.avgLossR} R
                    </span>
                  </div>
                </div>

                <div className="p-3 rounded bg-[#0d121f] border border-slate-800">
                  <div className="text-[10px] text-slate-400 uppercase tracking-wider">
                    Long Performance
                  </div>
                  <div className="mt-1 font-mono text-slate-200">
                    <span className="font-bold text-sm">{result.longWinRate}%</span>{' '}
                    <span className="text-slate-400 text-[11px]">
                      ({result.longTradesCount} trades)
                    </span>
                  </div>
                </div>

                <div className="p-3 rounded bg-[#0d121f] border border-slate-800">
                  <div className="text-[10px] text-slate-400 uppercase tracking-wider">
                    Short Performance
                  </div>
                  <div className="mt-1 font-mono text-slate-200">
                    <span className="font-bold text-sm">{result.shortWinRate}%</span>{' '}
                    <span className="text-slate-400 text-[11px]">
                      ({result.shortTradesCount} trades)
                    </span>
                  </div>
                </div>
              </div>

              {/* Strategy A Documented Assumptions & Audit Log */}
              {result.assumptions && result.assumptions.length > 0 && (
                <div className="p-3.5 rounded bg-[#0d121f] border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2 text-slate-200 font-semibold text-[11px]">
                      <AlertCircle className="w-4 h-4 text-emerald-400" />
                      <span>Strategy A — Deterministic Rules & Backtest Assumptions</span>
                    </div>
                    <span className="text-[10px] font-mono text-slate-500">
                      Zero Future-Lookahead Enforced
                    </span>
                  </div>

                  <div className="grid grid-cols-1 md:grid-cols-2 gap-2 text-[11px] text-slate-300 font-mono">
                    {result.assumptions.map((assumption, idx) => (
                      <div
                        key={idx}
                        className="p-2 rounded bg-[#090d16] border border-slate-800/80 leading-relaxed"
                      >
                        <span className="text-emerald-400 font-bold mr-1.5">
                          {assumption.slice(0, 3)}
                        </span>
                        <span className="text-slate-300">{assumption.slice(4)}</span>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

/**
 * Lightweight SVG Equity & Cumulative R Chart
 */
function EquitySvgChart({ equityCurve }: { equityCurve: BacktestResult['equityCurve'] }) {
  if (!equityCurve || equityCurve.length < 2) {
    return (
      <div className="h-full flex items-center justify-center text-xs text-slate-500">
        Execute a strategy run with closed trades to plot equity curve.
      </div>
    );
  }

  const values = equityCurve.map((p) => p.cumulativeR);
  const minR = Math.min(0, ...values);
  const maxR = Math.max(1, ...values);
  const range = maxR - minR || 1;

  const width = 800;
  const height = 150;
  const paddingY = 16;
  const innerHeight = height - paddingY * 2;

  // Zero-line Y coordinate
  const zeroY = height - paddingY - ((0 - minR) / range) * innerHeight;

  // Calculate points
  const points = equityCurve.map((pt, i) => {
    const x = (i / (equityCurve.length - 1)) * width;
    const y = height - paddingY - ((pt.cumulativeR - minR) / range) * innerHeight;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  });

  const pathD = `M ${points.join(' L ')}`;
  const areaD = `${pathD} L ${width},${zeroY} L 0,${zeroY} Z`;

  const isNetPositive = equityCurve[equityCurve.length - 1].cumulativeR >= 0;

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full h-full overflow-visible">
      <defs>
        <linearGradient id="equityGrad" x1="0" y1="0" x2="0" y2="1">
          <stop
            offset="0%"
            stopColor={isNetPositive ? '#10b981' : '#f43f5e'}
            stopOpacity="0.25"
          />
          <stop
            offset="100%"
            stopColor={isNetPositive ? '#10b981' : '#f43f5e'}
            stopOpacity="0.0"
          />
        </linearGradient>
      </defs>

      {/* Zero baseline */}
      <line
        x1="0"
        y1={zeroY}
        x2={width}
        y2={zeroY}
        stroke="#334155"
        strokeWidth="1"
        strokeDasharray="4 4"
      />
      <text x={8} y={zeroY - 4} fill="#64748b" fontSize="10" fontFamily="monospace">
        0.00 R
      </text>

      {/* Max label */}
      <text x={8} y={paddingY + 8} fill="#10b981" fontSize="10" fontFamily="monospace">
        +{maxR.toFixed(1)} R
      </text>

      {/* Min label */}
      {minR < 0 && (
        <text x={8} y={height - 6} fill="#f43f5e" fontSize="10" fontFamily="monospace">
          {minR.toFixed(1)} R
        </text>
      )}

      {/* Shaded Area */}
      <path d={areaD} fill="url(#equityGrad)" />

      {/* Main Curve Line */}
      <path
        d={pathD}
        fill="none"
        stroke={isNetPositive ? '#10b981' : '#f43f5e'}
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />

      {/* Final Dot */}
      {points.length > 0 && (
        <circle
          cx={points[points.length - 1].split(',')[0]}
          cy={points[points.length - 1].split(',')[1]}
          r="4"
          fill={isNetPositive ? '#10b981' : '#f43f5e'}
          stroke="#0b0e14"
          strokeWidth="2"
        />
      )}
    </svg>
  );
}
