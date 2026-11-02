'use client';

import React, { useEffect, useRef, useState, useCallback, useMemo } from 'react';
import {
  createChart,
  CandlestickSeries,
  LineSeries,
  HistogramSeries,
  ColorType,
  CrosshairMode,
  LineStyle,
  Time,
  IChartApi,
  ISeriesApi,
  ISeriesMarkersPluginApi,
  createSeriesMarkers,
  SeriesMarker,
  IPriceLine,
} from 'lightweight-charts';
import {
  Candle,
  ForexSymbol,
  IndicatorConfig,
  Timeframe,
  Trade,
} from '@/types/trading';
import { calculateEMA } from '@/services/indicators';
import { FOREX_SYMBOLS, TIMEFRAMES } from '@/services/marketData';
import {
  RotateCcw,
  ZoomIn,
  ZoomOut,
  Maximize2,
  Tag,
  BarChart2,
  Activity,
  Layers,
} from 'lucide-react';

interface TradingChartProps {
  candles: Candle[];
  symbol: ForexSymbol;
  timeframe: Timeframe;
  onSelectTimeframe?: (tf: Timeframe) => void;
  trades: Trade[];
  selectedTrade: Trade | null;
  indicatorConfig: IndicatorConfig;
  onToggleIndicator: (key: keyof IndicatorConfig) => void;
  onClearSelectedTrade?: () => void;
}

export function TradingChart({
  candles,
  symbol,
  timeframe,
  onSelectTimeframe,
  trades,
  selectedTrade,
  indicatorConfig,
  onToggleIndicator,
  onClearSelectedTrade,
}: TradingChartProps) {
  const chartContainerRef = useRef<HTMLDivElement>(null);
  const chartRef = useRef<IChartApi | null>(null);
  const candleSeriesRef = useRef<ISeriesApi<'Candlestick', Time> | null>(null);
  const volumeSeriesRef = useRef<ISeriesApi<'Histogram', Time> | null>(null);
  const ema50SeriesRef = useRef<ISeriesApi<'Line', Time> | null>(null);
  const ema200SeriesRef = useRef<ISeriesApi<'Line', Time> | null>(null);
  const markersPluginRef = useRef<ISeriesMarkersPluginApi<Time> | null>(null);

  // Active trade price lines
  const entryLineRef = useRef<IPriceLine | null>(null);
  const slLineRef = useRef<IPriceLine | null>(null);
  const tpLineRef = useRef<IPriceLine | null>(null);

  // Hover state for interactive header OHLC & EMA inspection
  const [hoveredTime, setHoveredTime] = useState<number | null>(null);

  const symbolMeta = FOREX_SYMBOLS[symbol] || FOREX_SYMBOLS['XAUUSDm'] || FOREX_SYMBOLS['EUR/USD'];
  const digits = symbolMeta.digits;

  // Pre-calculate EMA 50 & EMA 200 data
  const ema50Data = useMemo(() => calculateEMA(candles, 50), [candles]);
  const ema200Data = useMemo(() => calculateEMA(candles, 200), [candles]);

  // Fast maps for cursor hover lookup
  const ema50Map = useMemo(() => {
    const map = new Map<number, number>();
    for (const p of ema50Data) map.set(p.time, p.value);
    return map;
  }, [ema50Data]);

  const ema200Map = useMemo(() => {
    const map = new Map<number, number>();
    for (const p of ema200Data) map.set(p.time, p.value);
    return map;
  }, [ema200Data]);

  const candleMap = useMemo(() => {
    const map = new Map<number, Candle>();
    for (const c of candles) map.set(c.time, c);
    return map;
  }, [candles]);

  // 1. One-time initialization of Lightweight Charts instance
  useEffect(() => {
    if (!chartContainerRef.current) return;
    const container = chartContainerRef.current;
    container.innerHTML = '';

    const chart = createChart(container, {
      layout: {
        background: { type: ColorType.Solid, color: '#090d16' },
        textColor: '#8492a6',
        fontSize: 11,
        fontFamily: "'JetBrains Mono', 'SF Mono', Consolas, Menlo, monospace",
      },
      grid: {
        vertLines: { color: 'rgba(30, 41, 59, 0.45)', style: LineStyle.SparseDotted },
        horzLines: { color: 'rgba(30, 41, 59, 0.45)', style: LineStyle.SparseDotted },
      },
      crosshair: {
        mode: CrosshairMode.Normal,
        vertLine: {
          color: 'rgba(148, 163, 184, 0.5)',
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: '#1e293b',
        },
        horzLine: {
          color: 'rgba(148, 163, 184, 0.5)',
          width: 1,
          style: LineStyle.Dashed,
          labelBackgroundColor: '#1e293b',
        },
      },
      timeScale: {
        borderColor: '#1e293b',
        timeVisible: true,
        secondsVisible: false,
        barSpacing: 9,
        minBarSpacing: 3,
        rightOffset: 12,
      },
      rightPriceScale: {
        borderColor: '#1e293b',
        autoScale: true,
        scaleMargins: {
          top: 0.1,
          bottom: 0.22,
        },
      },
      handleScroll: {
        mouseWheel: true,
        pressedMouseMove: true,
        horzTouchDrag: true,
        vertTouchDrag: true,
      },
      handleScale: {
        axisPressedMouseMove: true,
        mouseWheel: true,
        pinch: true,
      },
    });

    chartRef.current = chart;

    // 1. Candlestick series
    const candleSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#10b981',
      downColor: '#f43f5e',
      borderVisible: false,
      wickUpColor: '#10b981',
      wickDownColor: '#f43f5e',
      priceFormat: {
        type: 'price',
      },
    });
    candleSeriesRef.current = candleSeries;

    // 2. Volume series
    const volumeSeries = chart.addSeries(HistogramSeries, {
      priceFormat: { type: 'volume' },
      priceScaleId: 'volume',
    });
    chart.priceScale('volume').applyOptions({
      scaleMargins: {
        top: 0.82,
        bottom: 0,
      },
    });
    volumeSeriesRef.current = volumeSeries;

    // 3. EMA 50 overlay series (Amber)
    const ema50Series = chart.addSeries(LineSeries, {
      color: '#f59e0b',
      lineWidth: 2,
      priceLineVisible: false,
      crosshairMarkerVisible: true,
      lastValueVisible: true,
      title: 'EMA 50',
    });
    ema50SeriesRef.current = ema50Series;

    // 4. EMA 200 overlay series (Purple)
    const ema200Series = chart.addSeries(LineSeries, {
      color: '#a855f7',
      lineWidth: 2,
      priceLineVisible: false,
      crosshairMarkerVisible: true,
      lastValueVisible: true,
      title: 'EMA 200',
    });
    ema200SeriesRef.current = ema200Series;

    // 5. Signal markers plugin
    const markersPlugin = createSeriesMarkers(candleSeries, []);
    markersPluginRef.current = markersPlugin;

    // Crosshair hover inspection
    chart.subscribeCrosshairMove((param) => {
      if (
        !param.point ||
        !param.time ||
        param.point.x < 0 ||
        param.point.y < 0 ||
        param.point.x > container.clientWidth ||
        param.point.y > container.clientHeight
      ) {
        setHoveredTime(null);
        return;
      }

      if (typeof param.time === 'number') {
        setHoveredTime(param.time);
      } else {
        setHoveredTime(null);
      }
    });

    // ResizeObserver ensures chart resizes smoothly when browser window or panels resize
    const resizeObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        if (entry.target === container && chartRef.current) {
          const { width, height } = entry.contentRect;
          if (width > 0 && height > 0) {
            chartRef.current.applyOptions({ width, height });
          }
        }
      }
    });
    resizeObserver.observe(container);

    // Initial resize
    if (container.clientWidth > 0 && container.clientHeight > 0) {
      chart.applyOptions({
        width: container.clientWidth,
        height: container.clientHeight,
      });
    }

    return () => {
      resizeObserver.disconnect();
      chart.remove();
      chartRef.current = null;
      candleSeriesRef.current = null;
      volumeSeriesRef.current = null;
      ema50SeriesRef.current = null;
      ema200SeriesRef.current = null;
      markersPluginRef.current = null;
    };
  }, []); // Run strictly once on mount to avoid rebuilding chart

  // 2. Update price precision options when symbol changes
  useEffect(() => {
    if (candleSeriesRef.current) {
      candleSeriesRef.current.applyOptions({
        priceFormat: {
          type: 'price',
          precision: digits,
          minMove: 1 / Math.pow(10, digits),
        },
      });
    }
  }, [digits]);

  // 3. Update candle and volume data without recreating chart
  useEffect(() => {
    if (!candleSeriesRef.current || !volumeSeriesRef.current || candles.length === 0) return;

    const chartCandles = candles.map((c) => ({
      time: c.time as Time,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
    }));

    const chartVolumes = candles.map((c) => ({
      time: c.time as Time,
      value: c.volume,
      color: c.close >= c.open ? 'rgba(16, 185, 129, 0.35)' : 'rgba(244, 63, 94, 0.35)',
    }));

    candleSeriesRef.current.setData(chartCandles);
    volumeSeriesRef.current.setData(chartVolumes);
  }, [candles]);

  // 4. Update EMA 50 data & visibility
  useEffect(() => {
    if (!ema50SeriesRef.current) return;
    ema50SeriesRef.current.applyOptions({
      visible: indicatorConfig.showEma50,
    });
    if (indicatorConfig.showEma50) {
      ema50SeriesRef.current.setData(
        ema50Data.map((p) => ({ time: p.time as Time, value: p.value }))
      );
    } else {
      ema50SeriesRef.current.setData([]);
    }
  }, [ema50Data, indicatorConfig.showEma50]);

  // 5. Update EMA 200 data & visibility
  useEffect(() => {
    if (!ema200SeriesRef.current) return;
    ema200SeriesRef.current.applyOptions({
      visible: indicatorConfig.showEma200,
    });
    if (indicatorConfig.showEma200) {
      ema200SeriesRef.current.setData(
        ema200Data.map((p) => ({ time: p.time as Time, value: p.value }))
      );
    } else {
      ema200SeriesRef.current.setData([]);
    }
  }, [ema200Data, indicatorConfig.showEma200]);

  // 6. Update Volume visibility
  useEffect(() => {
    if (volumeSeriesRef.current) {
      volumeSeriesRef.current.applyOptions({
        visible: indicatorConfig.showVolume,
      });
    }
  }, [indicatorConfig.showVolume]);

  // 7. Update Trade Markers (Buy/Sell, TP/SL badges)
  useEffect(() => {
    if (!markersPluginRef.current) return;

    if (!indicatorConfig.showMarkers || trades.length === 0) {
      markersPluginRef.current.setMarkers([]);
      return;
    }

    const seriesMarkers: SeriesMarker<Time>[] = [];

    for (const trade of trades) {
      const isLong = trade.direction === 'LONG';
      const isSelected = selectedTrade?.id === trade.id;

      // Entry Marker
      seriesMarkers.push({
        time: trade.entryTime as Time,
        position: isLong ? 'belowBar' : 'aboveBar',
        color: isLong ? '#10b981' : '#f43f5e',
        shape: isLong ? 'arrowUp' : 'arrowDown',
        text: `${trade.direction} #${trade.index}${isSelected ? ' ★' : ''}`,
        size: isSelected ? 2 : 1,
      });

      // Exit Marker
      if (trade.exitTime && trade.exitTime > 0) {
        const isWin = trade.status === 'WIN';
        const isLoss = trade.status === 'LOSS';
        const exitColor = isWin ? '#10b981' : isLoss ? '#f43f5e' : '#94a3b8';

        seriesMarkers.push({
          time: trade.exitTime as Time,
          position: isLong ? 'aboveBar' : 'belowBar',
          color: exitColor,
          shape: isWin ? 'circle' : 'square',
          text: `${trade.exitReason} (${trade.pnlR > 0 ? '+' : ''}${trade.pnlR}R)`,
          size: isSelected ? 2 : 1,
        });
      }
    }

    seriesMarkers.sort((a, b) => Number(a.time) - Number(b.time));
    markersPluginRef.current.setMarkers(seriesMarkers);
  }, [trades, indicatorConfig.showMarkers, selectedTrade]);

  // 8. Handle Selected Trade highlighting & horizontal price lines
  useEffect(() => {
    const series = candleSeriesRef.current;
    if (!series) return;

    if (entryLineRef.current) {
      series.removePriceLine(entryLineRef.current);
      entryLineRef.current = null;
    }
    if (slLineRef.current) {
      series.removePriceLine(slLineRef.current);
      slLineRef.current = null;
    }
    if (tpLineRef.current) {
      series.removePriceLine(tpLineRef.current);
      tpLineRef.current = null;
    }

    if (!selectedTrade) return;

    // Entry Line
    entryLineRef.current = series.createPriceLine({
      price: selectedTrade.entryPrice,
      color: '#38bdf8',
      lineWidth: 2,
      lineStyle: LineStyle.Solid,
      axisLabelVisible: true,
      title: `ENTRY #${selectedTrade.index} (${selectedTrade.direction})`,
    });

    // Stop Loss Line
    slLineRef.current = series.createPriceLine({
      price: selectedTrade.stopLoss,
      color: '#f43f5e',
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: `SL (${selectedTrade.stopLoss.toFixed(digits)})`,
    });

    // Take Profit Line
    tpLineRef.current = series.createPriceLine({
      price: selectedTrade.takeProfit,
      color: '#10b981',
      lineWidth: 2,
      lineStyle: LineStyle.Dashed,
      axisLabelVisible: true,
      title: `TP (${selectedTrade.takeProfit.toFixed(digits)})`,
    });

    // Zoom chart to trade window
    if (chartRef.current && selectedTrade.entryTime) {
      const timeScale = chartRef.current.timeScale();
      const exitTime = selectedTrade.exitTime || selectedTrade.entryTime + 3600 * 4;
      const tfSeconds = TIMEFRAMES[timeframe]?.seconds || 900;

      const fromTime = (selectedTrade.entryTime - tfSeconds * 15) as Time;
      const toTime = (exitTime + tfSeconds * 20) as Time;

      try {
        timeScale.setVisibleRange({ from: fromTime, to: toTime });
      } catch {
        // Range out of bounds fallback
      }
    }
  }, [selectedTrade, digits, timeframe]);

  // Chart Actions
  const handleResetView = useCallback(() => {
    if (!chartRef.current) return;
    chartRef.current.timeScale().fitContent();
  }, []);

  const handleZoomIn = useCallback(() => {
    if (!chartRef.current) return;
    const timeScale = chartRef.current.timeScale();
    const range = timeScale.getVisibleLogicalRange();
    if (range) {
      const delta = (range.to - range.from) * 0.25;
      timeScale.setVisibleLogicalRange({
        from: range.from + delta,
        to: range.to - delta,
      });
    }
  }, []);

  const handleZoomOut = useCallback(() => {
    if (!chartRef.current) return;
    const timeScale = chartRef.current.timeScale();
    const range = timeScale.getVisibleLogicalRange();
    if (range) {
      const delta = (range.to - range.from) * 0.25;
      timeScale.setVisibleLogicalRange({
        from: range.from - delta,
        to: range.to + delta,
      });
    }
  }, []);

  // Active or Hovered Bar Information
  const activeCandle = useMemo(() => {
    if (hoveredTime && candleMap.has(hoveredTime)) {
      return candleMap.get(hoveredTime)!;
    }
    return candles.length > 0 ? candles[candles.length - 1] : null;
  }, [hoveredTime, candleMap, candles]);

  const activeEma50 = useMemo(() => {
    if (activeCandle) {
      return ema50Map.get(activeCandle.time);
    }
    return undefined;
  }, [activeCandle, ema50Map]);

  const activeEma200 = useMemo(() => {
    if (activeCandle) {
      return ema200Map.get(activeCandle.time);
    }
    return undefined;
  }, [activeCandle, ema200Map]);

  const change = activeCandle ? activeCandle.close - activeCandle.open : 0;
  const changePercent = activeCandle && activeCandle.open > 0 ? (change / activeCandle.open) * 100 : 0;
  const isUp = activeCandle ? activeCandle.close >= activeCandle.open : true;

  const currentTfLabel = TIMEFRAMES[timeframe]?.label || timeframe;

  return (
    <div className="relative w-full h-full flex flex-col bg-[#090d16] select-none overflow-hidden">
      {/* Top Chart Header & Toolbar */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-2 bg-[#0d121f] border-b border-slate-800/80 text-xs shrink-0 z-10">
        {/* Left: Selected Symbol, Timeframe, and Live/Hover OHLC + EMA Values */}
        <div className="flex items-center gap-3 flex-wrap">
          <div className="flex items-center gap-1.5">
            <span className="px-1.5 py-0.5 rounded text-[10px] font-bold bg-amber-500/10 text-amber-400 border border-amber-500/30 uppercase tracking-wider font-mono">
              DEMO
            </span>
            <span className="text-white font-mono font-bold tracking-wide text-sm">
              {symbol}
            </span>
            <span className="px-2 py-0.5 rounded text-[11px] bg-slate-800 text-emerald-400 font-mono font-semibold border border-slate-700">
              {currentTfLabel}
            </span>
          </div>

          {/* Quick M15 / H1 Timeframe Switcher if provided */}
          {onSelectTimeframe && (
            <div className="flex items-center bg-slate-900 rounded border border-slate-800 p-0.5">
              {(['15m', '1h'] as Timeframe[]).map((tf) => (
                <button
                  key={tf}
                  onClick={() => onSelectTimeframe(tf)}
                  className={`px-2 py-0.5 rounded text-[11px] font-mono transition-colors ${
                    timeframe === tf
                      ? 'bg-emerald-500 text-slate-950 font-bold'
                      : 'text-slate-400 hover:text-white'
                  }`}
                >
                  {TIMEFRAMES[tf].label}
                </button>
              ))}
            </div>
          )}

          {/* OHLC readout */}
          {activeCandle && (
            <div className="flex items-center gap-2 font-mono text-[11px] text-slate-400">
              <span>
                O <strong className="text-slate-200">{activeCandle.open.toFixed(digits)}</strong>
              </span>
              <span>
                H <strong className="text-slate-200">{activeCandle.high.toFixed(digits)}</strong>
              </span>
              <span>
                L <strong className="text-slate-200">{activeCandle.low.toFixed(digits)}</strong>
              </span>
              <span>
                C{' '}
                <strong className={isUp ? 'text-emerald-400' : 'text-rose-400'}>
                  {activeCandle.close.toFixed(digits)}
                </strong>
              </span>
              <span className={`font-semibold ${isUp ? 'text-emerald-400' : 'text-rose-400'}`}>
                {change >= 0 ? '+' : ''}
                {change.toFixed(digits)} ({changePercent >= 0 ? '+' : ''}
                {changePercent.toFixed(2)}%)
              </span>
            </div>
          )}

          {/* Indicator live readouts */}
          <div className="hidden xl:flex items-center gap-3 font-mono text-[11px]">
            {indicatorConfig.showEma50 && activeEma50 !== undefined && (
              <span className="text-amber-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-amber-400" />
                EMA50: <strong>{activeEma50.toFixed(digits)}</strong>
              </span>
            )}
            {indicatorConfig.showEma200 && activeEma200 !== undefined && (
              <span className="text-purple-400 flex items-center gap-1">
                <span className="w-1.5 h-1.5 rounded-full bg-purple-400" />
                EMA200: <strong>{activeEma200.toFixed(digits)}</strong>
              </span>
            )}
          </div>
        </div>

        {/* Right: Explicit EMA Toggles, Indicators, and Zoom/Reset Controls */}
        <div className="flex items-center gap-1.5 flex-wrap">
          {/* Explicit EMA 50 & EMA 200 Toggles */}
          <div className="flex items-center bg-slate-900/90 rounded border border-slate-800 p-0.5 text-[11px]">
            <button
              onClick={() => onToggleIndicator('showEma50')}
              title="Toggle Exponential Moving Average 50"
              className={`px-2.5 py-1 rounded flex items-center gap-1.5 transition-colors ${
                indicatorConfig.showEma50
                  ? 'bg-amber-500/20 text-amber-300 font-bold border border-amber-500/30'
                  : 'text-slate-400 hover:text-slate-200 border border-transparent'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-amber-400" />
              <span>EMA 50</span>
            </button>

            <button
              onClick={() => onToggleIndicator('showEma200')}
              title="Toggle Exponential Moving Average 200"
              className={`px-2.5 py-1 rounded flex items-center gap-1.5 transition-colors ${
                indicatorConfig.showEma200
                  ? 'bg-purple-500/20 text-purple-300 font-bold border border-purple-500/30'
                  : 'text-slate-400 hover:text-slate-200 border border-transparent'
              }`}
            >
              <span className="w-2 h-2 rounded-full bg-purple-400" />
              <span>EMA 200</span>
            </button>

            <button
              onClick={() => onToggleIndicator('showVolume')}
              title="Toggle Volume Histogram"
              className={`px-2 py-1 rounded flex items-center gap-1 transition-colors ${
                indicatorConfig.showVolume
                  ? 'bg-slate-700 text-slate-200 font-medium'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              <BarChart2 className="w-3.5 h-3.5" />
              <span>Vol</span>
            </button>

            <button
              onClick={() => onToggleIndicator('showMarkers')}
              title="Toggle Trade Entry & Exit Markers"
              className={`px-2 py-1 rounded flex items-center gap-1 transition-colors ${
                indicatorConfig.showMarkers
                  ? 'bg-emerald-500/20 text-emerald-300 font-medium'
                  : 'text-slate-500 hover:text-slate-300'
              }`}
            >
              <Tag className="w-3.5 h-3.5" />
              <span>Signals</span>
            </button>
          </div>

          {/* Reset Chart View Button & Zoom Controls */}
          <div className="flex items-center bg-slate-900/90 rounded border border-slate-800 p-0.5 text-slate-300">
            <button
              onClick={handleResetView}
              className="px-2 py-1 hover:text-white hover:bg-slate-800 rounded flex items-center gap-1 text-[11px] font-medium transition-colors"
              title="Reset Chart View & Scale (Fit all bars)"
            >
              <RotateCcw className="w-3 h-3 text-emerald-400" />
              <span>Reset View</span>
            </button>

            <div className="w-[1px] h-3.5 bg-slate-800 mx-0.5" />

            <button
              onClick={handleZoomIn}
              className="p-1 hover:text-white hover:bg-slate-800 rounded transition-colors"
              title="Zoom In (+)"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={handleZoomOut}
              className="p-1 hover:text-white hover:bg-slate-800 rounded transition-colors"
              title="Zoom Out (-)"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>
      </div>

      {/* Selected Trade Notice Banner */}
      {selectedTrade && (
        <div className="absolute top-12 left-4 z-10 flex items-center gap-3 px-3 py-1.5 rounded-md bg-[#0f172a]/95 border border-sky-500/40 shadow-xl backdrop-blur text-xs">
          <div className="flex items-center gap-1.5">
            <span
              className={`px-1.5 py-0.5 rounded font-mono font-bold text-[10px] ${
                selectedTrade.direction === 'LONG'
                  ? 'bg-emerald-500/20 text-emerald-400 border border-emerald-500/30'
                  : 'bg-rose-500/20 text-rose-400 border border-rose-500/30'
              }`}
            >
              {selectedTrade.direction} #{selectedTrade.index}
            </span>
            <span className="text-slate-300">
              Entry: <strong className="font-mono text-white">{selectedTrade.entryPrice.toFixed(digits)}</strong>
            </span>
            <span className="text-slate-400">|</span>
            <span className="text-rose-400">
              SL: <strong className="font-mono">{selectedTrade.stopLoss.toFixed(digits)}</strong>
            </span>
            <span className="text-slate-400">|</span>
            <span className="text-emerald-400">
              TP: <strong className="font-mono">{selectedTrade.takeProfit.toFixed(digits)}</strong>
            </span>
            <span className="text-slate-400">|</span>
            <span
              className={`font-semibold font-mono ${
                selectedTrade.pnlR > 0
                  ? 'text-emerald-400'
                  : selectedTrade.pnlR < 0
                  ? 'text-rose-400'
                  : 'text-slate-300'
              }`}
            >
              {selectedTrade.pnlR > 0 ? '+' : ''}
              {selectedTrade.pnlR}R (${selectedTrade.pnlCurrency})
            </span>
          </div>

          {onClearSelectedTrade && (
            <button
              onClick={onClearSelectedTrade}
              className="px-1.5 py-0.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-slate-200 text-[10px] ml-1 transition-colors"
            >
              Clear Focus
            </button>
          )}
        </div>
      )}

      {/* Main Lightweight Charts Canvas Container */}
      <div ref={chartContainerRef} className="flex-1 w-full h-full min-h-[360px]" />
    </div>
  );
}
