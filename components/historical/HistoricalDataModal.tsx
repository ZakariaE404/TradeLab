'use client';

import React, { useState, useEffect, useRef } from 'react';
import {
  DownloadProgressState,
  DukascopyPriceType,
  DukascopyTimeframe,
  HistoricalDatePreset,
  SavedHistoricalDataset,
} from '@/types/historicalData';
import {
  DUKASCOPY_INSTRUMENTS,
  DUKASCOPY_TIMEFRAMES,
  getDateRangeForPreset,
  getDukascopyInstrumentMeta,
  isValidDukascopyInstrument,
  validateDownloadParams,
} from '@/services/dukascopyCatalog';
import {
  deleteHistoricalDataset,
  findDuplicateDataset,
  getSavedDatasetById,
  getSavedDatasetsList,
  saveHistoricalDataset,
} from '@/services/datasetStorage';
import { downloadHistoricalDataset } from '@/services/historicalDownloadManager';
import { exportCandlesToCSV, parseDukascopyCSV } from '@/services/dukascopyNormalizer';
import { Candle } from '@/types/trading';
import {
  X,
  Download,
  Database,
  Calendar,
  Layers,
  CheckCircle2,
  AlertTriangle,
  Loader2,
  Trash2,
  Eye,
  FileDown,
  Upload,
  RefreshCw,
  Play,
  ArrowRight,
  ShieldCheck,
  Clock,
  Sparkles,
} from 'lucide-react';

interface HistoricalDataModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSelectDataset: (dataset: SavedHistoricalDataset) => void;
  activeDatasetId?: string | null;
}

export function HistoricalDataModal({
  isOpen,
  onClose,
  onSelectDataset,
  activeDatasetId,
}: HistoricalDataModalProps) {
  // Tabs: 'download' | 'datasets'
  const [activeTab, setActiveTab] = useState<'download' | 'datasets'>('download');

  // Form State
  const [selectedInstrument, setSelectedInstrument] = useState<string>('xauusd');
  const [customInstrumentInput, setCustomInstrumentInput] = useState<string>('');
  const [isCustomInstrumentMode, setIsCustomInstrumentMode] = useState<boolean>(false);
  const [selectedTimeframe, setSelectedTimeframe] = useState<DukascopyTimeframe>('m1');
  const [selectedPriceType, setSelectedPriceType] = useState<DukascopyPriceType>('BID');
  const [datePreset, setDatePreset] = useState<HistoricalDatePreset>('7d');
  const [startDate, setStartDate] = useState<string>(() => getDateRangeForPreset('7d').from);
  const [endDate, setEndDate] = useState<string>(() => getDateRangeForPreset('7d').to);

  // Download & Progress State
  const [progressState, setProgressState] = useState<DownloadProgressState | null>(null);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [duplicateDataset, setDuplicateDataset] = useState<SavedHistoricalDataset | null>(null);
  const abortControllerRef = useRef<AbortController | null>(null);

  // Saved Datasets State
  const [savedDatasets, setSavedDatasets] = useState<SavedHistoricalDataset[]>([]);
  const [isLoadingDatasets, setIsLoadingDatasets] = useState<boolean>(false);
  const [previewDataset, setPreviewDataset] = useState<SavedHistoricalDataset | null>(null);
  const [previewCandles, setPreviewCandles] = useState<Candle[]>([]);

  // Load datasets when modal opens
  useEffect(() => {
    if (isOpen) {
      loadSavedDatasets();
    }
  }, [isOpen]);

  const loadSavedDatasets = async () => {
    setIsLoadingDatasets(true);
    try {
      const list = await getSavedDatasetsList();
      setSavedDatasets(list);
    } catch {
      // Graceful fallback
    } finally {
      setIsLoadingDatasets(false);
    }
  };

  if (!isOpen) return null;

  // Handle Date Preset Changes
  const handleSelectPreset = (preset: HistoricalDatePreset) => {
    setDatePreset(preset);
    if (preset !== 'custom') {
      const { from, to } = getDateRangeForPreset(preset);
      setStartDate(from);
      setEndDate(to);
    }
  };

  const activeInstrumentId = isCustomInstrumentMode
    ? customInstrumentInput.trim().toLowerCase()
    : selectedInstrument.toLowerCase();

  const activeInstrumentMeta = getDukascopyInstrumentMeta(activeInstrumentId);

  // Trigger Download
  const handleStartDownload = async (forceOverwrite = false) => {
    setErrorMessage(null);
    setDuplicateDataset(null);

    const validation = validateDownloadParams({
      instrument: activeInstrumentId,
      timeframe: selectedTimeframe,
      from: startDate,
      to: endDate,
      priceType: selectedPriceType,
    });

    if (!validation.isValid) {
      setErrorMessage(validation.error || 'Invalid parameters.');
      return;
    }

    // Abort previous download if any
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
    }
    const abortController = new AbortController();
    abortControllerRef.current = abortController;

    const res = await downloadHistoricalDataset(
      {
        instrument: activeInstrumentId,
        timeframe: selectedTimeframe,
        from: startDate,
        to: endDate,
        priceType: selectedPriceType,
      },
      {
        signal: abortController.signal,
        forceOverwrite,
        onProgress: (prog) => {
          setProgressState(prog);
        },
      }
    );

    if (res.isDuplicate && res.dataset) {
      setDuplicateDataset(res.dataset);
      setProgressState(null);
      return;
    }

    if (!res.success) {
      setErrorMessage(res.error || 'Historical data download failed.');
      setProgressState(null);
      return;
    }

    if (res.dataset) {
      await loadSavedDatasets();
      // Auto-switch to datasets tab or load immediately
      onSelectDataset(res.dataset);
      setActiveTab('datasets');
    }
  };

  const handleCancelDownload = () => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setProgressState(null);
  };

  // Dataset Actions
  const handleLoadDataset = async (dataset: SavedHistoricalDataset) => {
    const fullDataset = await getSavedDatasetById(dataset.id);
    if (fullDataset && fullDataset.candles && fullDataset.candles.length > 0) {
      onSelectDataset(fullDataset);
      onClose();
    } else {
      setErrorMessage(`Failed to load candles for dataset ${dataset.id}.`);
    }
  };

  const handleDeleteDataset = async (id: string) => {
    if (confirm('Are you sure you want to delete this historical dataset?')) {
      await deleteHistoricalDataset(id);
      await loadSavedDatasets();
      if (previewDataset?.id === id) {
        setPreviewDataset(null);
      }
    }
  };

  const handleExportCSV = async (dataset: SavedHistoricalDataset) => {
    const full = await getSavedDatasetById(dataset.id);
    if (!full || !full.candles) return;

    const csvData = exportCandlesToCSV(full.candles, {
      symbol: full.symbol,
      timeframe: full.timeframe,
      priceType: full.priceType,
    });

    const blob = new Blob([csvData], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `${full.id}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const handlePreviewDataset = async (dataset: SavedHistoricalDataset) => {
    setPreviewDataset(dataset);
    const full = await getSavedDatasetById(dataset.id);
    if (full && full.candles) {
      setPreviewCandles(full.candles);
    } else {
      setPreviewCandles([]);
    }
  };

  const handleCSVFallbackUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    const reader = new FileReader();
    reader.onload = async (evt) => {
      const content = evt.target?.result as string;
      if (!content) return;

      const candles = parseDukascopyCSV(content);
      if (candles.length === 0) {
        setErrorMessage('Could not parse valid candles from uploaded CSV file.');
        return;
      }

      const inst = activeInstrumentId || 'eurusd';
      const meta = DUKASCOPY_INSTRUMENTS[inst] || { symbol: inst.toUpperCase(), name: inst.toUpperCase() };
      const fromStr = new Date(candles[0].time * 1000).toISOString().split('T')[0];
      const toStr = new Date(candles[candles.length - 1].time * 1000).toISOString().split('T')[0];
      const dsId = `ds_csv_${inst}_${selectedTimeframe}_${Date.now()}`;

      const dataset: SavedHistoricalDataset = {
        id: dsId,
        name: `Imported CSV: ${file.name} (${meta.symbol})`,
        instrument: inst,
        symbol: meta.symbol,
        timeframe: selectedTimeframe,
        displayTimeframe: selectedTimeframe === 'm1' ? '1m' : '15m',
        startDate: fromStr,
        endDate: toStr,
        startTime: candles[0].time,
        endTime: candles[candles.length - 1].time,
        priceType: selectedPriceType,
        candleCount: candles.length,
        downloadDate: Date.now(),
        dataSource: 'CSV',
        status: 'READY',
        candles,
      };

      await saveHistoricalDataset(dataset);
      await loadSavedDatasets();
      onSelectDataset(dataset);
      setActiveTab('datasets');
    };
    reader.readAsText(file);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-3 md:p-6 select-none animate-fadeIn">
      <div className="w-full max-w-4xl max-h-[92vh] bg-[#0c101a] border border-slate-800 rounded-xl shadow-2xl flex flex-col overflow-hidden text-xs text-slate-200">
        {/* 1. Modal Top Bar */}
        <div className="px-5 py-3.5 bg-[#080b11] border-b border-slate-800 flex items-center justify-between shrink-0">
          <div className="flex items-center gap-3">
            <div className="w-8 h-8 rounded-lg bg-emerald-500/10 border border-emerald-500/30 flex items-center justify-center text-emerald-400">
              <Download className="w-4 h-4" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h3 className="font-bold text-slate-100 text-sm font-mono">
                  Dukascopy Historical Market Data Importer
                </h3>
                <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-sky-500/10 text-sky-400 border border-sky-500/30 uppercase">
                  Tick & Candle Engine
                </span>
              </div>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Download authentic tick-derived historical OHLCV candles, save local datasets, and run strategy backtests.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 rounded-lg hover:bg-slate-800 text-slate-400 hover:text-white transition-colors cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* 2. Navigation Tabs */}
        <div className="flex items-center gap-2 px-5 pt-3 bg-[#0a0e17] border-b border-slate-800 shrink-0">
          <button
            onClick={() => setActiveTab('download')}
            className={`px-4 py-2 font-mono text-xs font-semibold rounded-t border-b-2 transition-all cursor-pointer flex items-center gap-2 ${
              activeTab === 'download'
                ? 'border-emerald-500 text-emerald-400 bg-emerald-500/5'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Download className="w-3.5 h-3.5" />
            <span>Download New Historical Data</span>
          </button>

          <button
            onClick={() => setActiveTab('datasets')}
            className={`px-4 py-2 font-mono text-xs font-semibold rounded-t border-b-2 transition-all cursor-pointer flex items-center gap-2 ${
              activeTab === 'datasets'
                ? 'border-emerald-500 text-emerald-400 bg-emerald-500/5'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Database className="w-3.5 h-3.5" />
            <span>Saved Datasets</span>
            <span className="px-1.5 py-0.2 rounded-full text-[10px] bg-slate-800 text-slate-300 font-mono font-bold">
              {savedDatasets.length}
            </span>
          </button>
        </div>

        {/* 3. Main Body */}
        <div className="flex-1 overflow-y-auto p-5 space-y-5 bg-[#090d16]">
          {/* TAB 1: DOWNLOAD NEW DATA */}
          {activeTab === 'download' && (
            <div className="space-y-5">
              {/* Instrument Selection */}
              <div className="space-y-2">
                <label className="text-slate-300 font-mono font-bold flex items-center justify-between">
                  <span>1. Select Dukascopy Instrument</span>
                  <span className="text-[11px] text-slate-500 font-normal">
                    {activeInstrumentMeta.category} • Pip Size: {activeInstrumentMeta.pipSize}
                  </span>
                </label>

                <div className="grid grid-cols-1 sm:grid-cols-4 gap-2">
                  {/* Quick instrument buttons */}
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedInstrument('eurusd');
                      setIsCustomInstrumentMode(false);
                    }}
                    className={`p-2.5 rounded-lg border text-left font-mono transition-all cursor-pointer ${
                      !isCustomInstrumentMode && selectedInstrument === 'eurusd'
                        ? 'bg-emerald-500/15 border-emerald-500 text-emerald-300 shadow-sm'
                        : 'bg-[#111726] border-slate-800 hover:border-slate-700 text-slate-300'
                    }`}
                  >
                    <div className="font-bold text-xs">EUR/USD</div>
                    <div className="text-[10px] text-slate-500">eurusd</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setSelectedInstrument('xauusd');
                      setIsCustomInstrumentMode(false);
                    }}
                    className={`p-2.5 rounded-lg border text-left font-mono transition-all cursor-pointer ${
                      !isCustomInstrumentMode && selectedInstrument === 'xauusd'
                        ? 'bg-emerald-500/15 border-emerald-500 text-emerald-300 shadow-sm'
                        : 'bg-[#111726] border-slate-800 hover:border-slate-700 text-slate-300'
                    }`}
                  >
                    <div className="font-bold text-xs">Gold (XAU/USD)</div>
                    <div className="text-[10px] text-slate-500">xauusd</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setSelectedInstrument('usatechidxusd');
                      setIsCustomInstrumentMode(false);
                    }}
                    className={`p-2.5 rounded-lg border text-left font-mono transition-all cursor-pointer ${
                      !isCustomInstrumentMode && selectedInstrument === 'usatechidxusd'
                        ? 'bg-emerald-500/15 border-emerald-500 text-emerald-300 shadow-sm'
                        : 'bg-[#111726] border-slate-800 hover:border-slate-700 text-slate-300'
                    }`}
                  >
                    <div className="font-bold text-xs">NASDAQ 100</div>
                    <div className="text-[10px] text-slate-500">usatechidxusd</div>
                  </button>

                  <button
                    type="button"
                    onClick={() => {
                      setIsCustomInstrumentMode(true);
                    }}
                    className={`p-2.5 rounded-lg border text-left font-mono transition-all cursor-pointer ${
                      isCustomInstrumentMode
                        ? 'bg-emerald-500/15 border-emerald-500 text-emerald-300 shadow-sm'
                        : 'bg-[#111726] border-slate-800 hover:border-slate-700 text-slate-300'
                    }`}
                  >
                    <div className="font-bold text-xs">Other Instruments</div>
                    <div className="text-[10px] text-slate-500">1,400+ available</div>
                  </button>
                </div>

                {isCustomInstrumentMode && (
                  <div className="p-3 bg-[#111726] border border-slate-800 rounded-lg space-y-2 mt-2">
                    <div className="flex items-center gap-2">
                      <select
                        onChange={(e) => {
                          if (e.target.value) {
                            setCustomInstrumentInput(e.target.value);
                          }
                        }}
                        className="bg-[#090d16] text-slate-200 border border-slate-800 rounded p-1.5 font-mono text-xs focus:outline-none focus:border-emerald-500 cursor-pointer"
                      >
                        <option value="">-- Choose Common Pair --</option>
                        {Object.entries(DUKASCOPY_INSTRUMENTS).map(([id, meta]) => (
                          <option key={id} value={id}>
                            {meta.symbol} ({meta.name}) [{id}]
                          </option>
                        ))}
                      </select>
                      <span className="text-slate-500">or enter ID:</span>
                      <input
                        type="text"
                        value={customInstrumentInput}
                        onChange={(e) => setCustomInstrumentInput(e.target.value)}
                        placeholder="e.g. gbpusd, usdjpy, brentcmdusd"
                        className="flex-1 bg-[#090d16] border border-slate-800 rounded p-1.5 text-slate-200 font-mono text-xs focus:outline-none focus:border-emerald-500"
                      />
                    </div>
                    {customInstrumentInput && !isValidDukascopyInstrument(customInstrumentInput) && (
                      <p className="text-[11px] text-amber-400">
                        Notice: Make sure &apos;{customInstrumentInput}&apos; matches an official Dukascopy instrument ID.
                      </p>
                    )}
                  </div>
                )}
              </div>

              {/* Timeframe & Price Type Selection */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                {/* Timeframe */}
                <div className="space-y-2">
                  <label className="text-slate-300 font-mono font-bold flex items-center gap-2">
                    <Clock className="w-3.5 h-3.5 text-emerald-400" />
                    <span>2. Timeframe</span>
                  </label>
                  <div className="flex items-center bg-[#111726] p-1 rounded-lg border border-slate-800">
                    {DUKASCOPY_TIMEFRAMES.map((tf) => (
                      <button
                        key={tf.id}
                        type="button"
                        onClick={() => setSelectedTimeframe(tf.id)}
                        className={`flex-1 py-1.5 rounded font-mono font-bold text-xs transition-all cursor-pointer ${
                          selectedTimeframe === tf.id
                            ? 'bg-emerald-500 text-slate-950 shadow-sm'
                            : 'text-slate-400 hover:text-white'
                        }`}
                      >
                        {tf.label}
                      </button>
                    ))}
                  </div>
                </div>

                {/* Price Type (BID / ASK) */}
                <div className="space-y-2">
                  <label className="text-slate-300 font-mono font-bold flex items-center gap-2">
                    <ShieldCheck className="w-3.5 h-3.5 text-emerald-400" />
                    <span>3. Price Type</span>
                  </label>
                  <div className="flex items-center bg-[#111726] p-1 rounded-lg border border-slate-800">
                    <button
                      type="button"
                      onClick={() => setSelectedPriceType('BID')}
                      className={`flex-1 py-1.5 rounded font-mono font-bold text-xs transition-all cursor-pointer ${
                        selectedPriceType === 'BID'
                          ? 'bg-emerald-500 text-slate-950 shadow-sm'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      BID (Default)
                    </button>
                    <button
                      type="button"
                      onClick={() => setSelectedPriceType('ASK')}
                      className={`flex-1 py-1.5 rounded font-mono font-bold text-xs transition-all cursor-pointer ${
                        selectedPriceType === 'ASK'
                          ? 'bg-emerald-500 text-slate-950 shadow-sm'
                          : 'text-slate-400 hover:text-white'
                      }`}
                    >
                      ASK
                    </button>
                  </div>
                </div>
              </div>

              {/* Date Range Selection & Presets */}
              <div className="space-y-2">
                <label className="text-slate-300 font-mono font-bold flex items-center justify-between">
                  <span className="flex items-center gap-2">
                    <Calendar className="w-3.5 h-3.5 text-emerald-400" />
                    <span>4. Date Range</span>
                  </span>
                  <span className="text-[11px] text-slate-500 font-normal">
                    End date defaults to today
                  </span>
                </label>

                {/* Quick Presets */}
                <div className="flex items-center gap-1.5 flex-wrap">
                  {(
                    [
                      { id: '7d', label: 'Last 7 Days' },
                      { id: '30d', label: 'Last 30 Days' },
                      { id: '3m', label: 'Last 3 Months' },
                      { id: '6m', label: 'Last 6 Months' },
                      { id: '1y', label: 'Last 1 Year' },
                      { id: 'custom', label: 'Custom Range' },
                    ] as const
                  ).map((p) => (
                    <button
                      key={p.id}
                      type="button"
                      onClick={() => handleSelectPreset(p.id)}
                      className={`px-3 py-1.5 rounded text-xs font-mono transition-all cursor-pointer ${
                        datePreset === p.id
                          ? 'bg-emerald-500/20 text-emerald-300 border border-emerald-500/40 font-bold'
                          : 'bg-[#111726] border border-slate-800 text-slate-400 hover:text-slate-200'
                      }`}
                    >
                      {p.label}
                    </button>
                  ))}
                </div>

                {/* Start & End Date Inputs */}
                <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-2">
                  <div className="bg-[#111726] p-2.5 rounded-lg border border-slate-800 flex items-center justify-between">
                    <span className="text-slate-400 font-mono text-xs">Start Date:</span>
                    <input
                      type="date"
                      value={startDate}
                      onChange={(e) => {
                        setStartDate(e.target.value);
                        setDatePreset('custom');
                      }}
                      className="bg-[#090d16] text-slate-100 border border-slate-800 rounded px-2.5 py-1 text-xs font-mono focus:outline-none focus:border-emerald-500"
                    />
                  </div>

                  <div className="bg-[#111726] p-2.5 rounded-lg border border-slate-800 flex items-center justify-between">
                    <span className="text-slate-400 font-mono text-xs">End Date:</span>
                    <input
                      type="date"
                      value={endDate}
                      onChange={(e) => {
                        setEndDate(e.target.value);
                        setDatePreset('custom');
                      }}
                      className="bg-[#090d16] text-slate-100 border border-slate-800 rounded px-2.5 py-1 text-xs font-mono focus:outline-none focus:border-emerald-500"
                    />
                  </div>
                </div>
              </div>

              {/* Progress & Status Feedback */}
              {progressState && progressState.isDownloading && (
                <div className="p-4 rounded-lg bg-[#0e1626] border border-emerald-500/40 space-y-2.5 animate-fadeIn">
                  <div className="flex items-center justify-between font-mono text-xs">
                    <span className="text-emerald-400 font-semibold flex items-center gap-2">
                      <Loader2 className="w-4 h-4 animate-spin" />
                      <span>{progressState.currentStage}</span>
                    </span>
                    <span className="text-slate-300 font-bold">{progressState.progressPercent}%</span>
                  </div>

                  {/* Progress bar */}
                  <div className="w-full h-2 rounded-full bg-slate-800 overflow-hidden">
                    <div
                      className="h-full bg-gradient-to-r from-emerald-500 to-teal-400 transition-all duration-300 ease-out"
                      style={{ width: `${progressState.progressPercent}%` }}
                    />
                  </div>

                  <div className="flex items-center justify-between text-[11px] text-slate-400 font-mono pt-1">
                    <span>
                      Chunks: {progressState.completedChunks} / {progressState.totalChunks}
                    </span>
                    <span>Candles: {progressState.totalCandlesFetched.toLocaleString()}</span>
                    <button
                      type="button"
                      onClick={handleCancelDownload}
                      className="text-rose-400 hover:text-rose-300 underline cursor-pointer"
                    >
                      Cancel Download
                    </button>
                  </div>
                </div>
              )}

              {/* Duplicate Detection Alert */}
              {duplicateDataset && (
                <div className="p-3.5 rounded-lg bg-amber-500/10 border border-amber-500/40 text-amber-300 flex items-start justify-between gap-3 animate-fadeIn">
                  <div className="flex items-start gap-2.5">
                    <AlertTriangle className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
                    <div>
                      <div className="font-bold text-xs">Identical Dataset Already Saved</div>
                      <div className="text-[11px] text-amber-200/80 mt-0.5">
                        Found dataset: <strong>{duplicateDataset.name}</strong> ({duplicateDataset.candleCount.toLocaleString()} candles).
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-2 shrink-0">
                    <button
                      onClick={() => handleLoadDataset(duplicateDataset)}
                      className="px-2.5 py-1 rounded bg-amber-500 hover:bg-amber-400 text-slate-950 font-bold text-xs transition cursor-pointer"
                    >
                      Load Existing
                    </button>
                    <button
                      onClick={() => handleStartDownload(true)}
                      className="px-2.5 py-1 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs transition cursor-pointer"
                    >
                      Re-download
                    </button>
                  </div>
                </div>
              )}

              {/* Error Message Alert */}
              {errorMessage && (
                <div className="p-3 rounded-lg bg-rose-500/10 border border-rose-500/40 text-rose-300 flex items-center justify-between text-xs animate-fadeIn">
                  <div className="flex items-center gap-2">
                    <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                    <span>{errorMessage}</span>
                  </div>
                  <button
                    onClick={() => handleStartDownload(true)}
                    className="px-2.5 py-1 rounded bg-rose-800 hover:bg-rose-700 text-white font-medium text-[11px] transition cursor-pointer flex items-center gap-1"
                  >
                    <RefreshCw className="w-3 h-3" />
                    <span>Retry</span>
                  </button>
                </div>
              )}

              {/* Action Buttons */}
              <div className="pt-2 flex items-center justify-between border-t border-slate-800">
                <div className="flex items-center gap-2">
                  {/* CSV Fallback Upload */}
                  <label
                    title="Import offline Dukascopy/MetaTrader CSV file"
                    className="px-3 py-1.5 rounded bg-slate-800/80 hover:bg-slate-800 border border-slate-700 text-slate-300 text-xs font-mono transition cursor-pointer flex items-center gap-1.5"
                  >
                    <Upload className="w-3.5 h-3.5 text-slate-400" />
                    <span>Import CSV Fallback</span>
                    <input
                      type="file"
                      accept=".csv,.txt"
                      onChange={handleCSVFallbackUpload}
                      className="hidden"
                    />
                  </label>
                </div>

                <div className="flex items-center gap-2">
                  <button
                    onClick={onClose}
                    className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition cursor-pointer"
                  >
                    Close
                  </button>
                  <button
                    onClick={() => handleStartDownload(false)}
                    disabled={progressState?.isDownloading}
                    className="px-5 py-2 rounded-lg bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 text-slate-950 font-bold text-xs font-mono shadow-md shadow-emerald-500/20 active:scale-95 transition-all cursor-pointer flex items-center gap-2"
                  >
                    <Download className="w-4 h-4" />
                    <span>Download Historical Data</span>
                  </button>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: SAVED DATASETS */}
          {activeTab === 'datasets' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between">
                <div className="text-slate-300 font-mono font-bold">
                  Saved Historical Datasets ({savedDatasets.length})
                </div>
                <div className="text-slate-500 text-[11px]">
                  Datasets are stored locally in your browser (IndexedDB)
                </div>
              </div>

              {isLoadingDatasets ? (
                <div className="py-12 flex flex-col items-center justify-center text-slate-500 gap-2 font-mono text-xs">
                  <Loader2 className="w-6 h-6 animate-spin text-emerald-400" />
                  <span>Loading saved datasets...</span>
                </div>
              ) : savedDatasets.length === 0 ? (
                <div className="py-12 flex flex-col items-center justify-center text-slate-500 gap-3 font-mono text-xs bg-[#0b0f19] border border-dashed border-slate-800 rounded-lg">
                  <Database className="w-8 h-8 text-slate-600" />
                  <span>No historical datasets saved yet.</span>
                  <button
                    onClick={() => setActiveTab('download')}
                    className="px-3 py-1.5 rounded bg-emerald-500/20 border border-emerald-500/40 text-emerald-300 hover:bg-emerald-500 hover:text-slate-950 font-bold transition cursor-pointer"
                  >
                    Download Your First Dataset
                  </button>
                </div>
              ) : (
                <div className="divide-y divide-slate-800/80 border border-slate-800 rounded-lg overflow-hidden bg-[#0a0e17]">
                  {savedDatasets.map((ds) => {
                    const isSelected = activeDatasetId === ds.id;
                    const downloadFormatted = new Date(ds.downloadDate).toLocaleDateString();

                    return (
                      <div
                        key={ds.id}
                        className={`p-3.5 flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3 hover:bg-[#111726]/60 transition-colors ${
                          isSelected ? 'bg-emerald-500/5 border-l-4 border-l-emerald-500' : ''
                        }`}
                      >
                        <div className="space-y-1">
                          <div className="flex items-center gap-2">
                            <span className="font-bold text-xs text-white font-mono">
                              {ds.symbol}
                            </span>
                            <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-slate-800 text-emerald-400 border border-slate-700">
                              {ds.timeframe.toUpperCase()}
                            </span>
                            <span className="px-1.5 py-0.2 rounded text-[10px] font-mono bg-sky-500/10 text-sky-400 border border-sky-500/30">
                              {ds.priceType}
                            </span>
                            <span className="text-[10px] text-slate-500 font-mono">
                              {ds.dataSource}
                            </span>
                            {isSelected && (
                              <span className="px-1.5 py-0.2 rounded text-[10px] font-mono font-bold bg-emerald-500 text-slate-950">
                                ACTIVE IN TERMINAL
                              </span>
                            )}
                          </div>

                          <div className="text-[11px] text-slate-400 font-mono flex items-center gap-2 flex-wrap">
                            <span>
                              {ds.startDate} → {ds.endDate}
                            </span>
                            <span className="text-slate-600">|</span>
                            <span className="text-slate-300 font-semibold">
                              {ds.candleCount.toLocaleString()} Candles
                            </span>
                            <span className="text-slate-600">|</span>
                            <span className="text-slate-500">Saved: {downloadFormatted}</span>
                          </div>
                        </div>

                        {/* Action buttons */}
                        <div className="flex items-center gap-1.5 self-end sm:self-center shrink-0">
                          <button
                            onClick={() => handlePreviewDataset(ds)}
                            title="Preview Candles"
                            className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition cursor-pointer"
                          >
                            <Eye className="w-3.5 h-3.5" />
                          </button>

                          <button
                            onClick={() => handleExportCSV(ds)}
                            title="Export to CSV"
                            className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition cursor-pointer"
                          >
                            <FileDown className="w-3.5 h-3.5" />
                          </button>

                          <button
                            onClick={() => {
                              setSelectedInstrument(ds.instrument);
                              setSelectedTimeframe(ds.timeframe);
                              setSelectedPriceType(ds.priceType);
                              setStartDate(ds.startDate);
                              setEndDate(ds.endDate);
                              setActiveTab('download');
                            }}
                            title="Download Again / Refetch"
                            className="p-1.5 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200 transition cursor-pointer"
                          >
                            <RefreshCw className="w-3.5 h-3.5" />
                          </button>

                          <button
                            onClick={() => handleDeleteDataset(ds.id)}
                            title="Delete Dataset"
                            className="p-1.5 rounded hover:bg-rose-500/20 text-slate-400 hover:text-rose-400 transition cursor-pointer"
                          >
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>

                          <button
                            onClick={() => handleLoadDataset(ds)}
                            className={`px-3 py-1.5 rounded font-mono font-bold text-xs flex items-center gap-1.5 transition-all cursor-pointer shadow-sm ${
                              isSelected
                                ? 'bg-slate-800 text-emerald-400 border border-emerald-500/40'
                                : 'bg-emerald-500 hover:bg-emerald-400 text-slate-950'
                            }`}
                          >
                            <Play className="w-3 h-3 fill-current" />
                            <span>{isSelected ? 'Reload' : 'Load & Backtest'}</span>
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>
              )}

              {/* Preview Panel Modal/Drawer */}
              {previewDataset && (
                <div className="p-4 rounded-lg bg-[#0e1422] border border-slate-800 space-y-3 animate-fadeIn mt-4">
                  <div className="flex items-center justify-between font-mono">
                    <span className="font-bold text-slate-200">
                      Preview: {previewDataset.name}
                    </span>
                    <button
                      onClick={() => setPreviewDataset(null)}
                      className="text-slate-400 hover:text-white"
                    >
                      <X className="w-4 h-4" />
                    </button>
                  </div>

                  <div className="text-[11px] text-slate-400 font-mono">
                    Total: {previewCandles.length.toLocaleString()} candles | Time Range: {new Date(previewDataset.startTime * 1000).toISOString()} to {new Date(previewDataset.endTime * 1000).toISOString()}
                  </div>

                  {/* First 3 and Last 3 candles sample */}
                  <div className="overflow-x-auto text-[10px] font-mono">
                    <table className="w-full text-left border-collapse">
                      <thead>
                        <tr className="border-b border-slate-800 text-slate-500">
                          <th className="py-1">Bar</th>
                          <th className="py-1">UTC Time</th>
                          <th className="py-1">Open</th>
                          <th className="py-1">High</th>
                          <th className="py-1">Low</th>
                          <th className="py-1">Close</th>
                          <th className="py-1">Volume</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-800/40 text-slate-300">
                        {previewCandles.slice(0, 3).map((c, i) => (
                          <tr key={i}>
                            <td className="py-1 text-slate-500">#{i + 1}</td>
                            <td className="py-1">{new Date(c.time * 1000).toISOString().replace('.000Z', '')}</td>
                            <td className="py-1">{c.open}</td>
                            <td className="py-1 text-emerald-400">{c.high}</td>
                            <td className="py-1 text-rose-400">{c.low}</td>
                            <td className="py-1">{c.close}</td>
                            <td className="py-1 text-slate-400">{c.volume}</td>
                          </tr>
                        ))}
                        {previewCandles.length > 6 && (
                          <tr>
                            <td colSpan={7} className="py-1 text-center text-slate-600">
                              ... ({previewCandles.length - 6} intervening bars) ...
                            </td>
                          </tr>
                        )}
                        {previewCandles.slice(-3).map((c, i) => (
                          <tr key={`last-${i}`}>
                            <td className="py-1 text-slate-500">#{previewCandles.length - 3 + i + 1}</td>
                            <td className="py-1">{new Date(c.time * 1000).toISOString().replace('.000Z', '')}</td>
                            <td className="py-1">{c.open}</td>
                            <td className="py-1 text-emerald-400">{c.high}</td>
                            <td className="py-1 text-rose-400">{c.low}</td>
                            <td className="py-1">{c.close}</td>
                            <td className="py-1 text-slate-400">{c.volume}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>

                  <div className="flex justify-end">
                    <button
                      onClick={() => handleLoadDataset(previewDataset)}
                      className="px-3 py-1.5 rounded bg-emerald-500 hover:bg-emerald-400 text-slate-950 font-bold font-mono text-xs cursor-pointer flex items-center gap-1.5"
                    >
                      <Play className="w-3 h-3 fill-current" />
                      <span>Load this Dataset into Terminal</span>
                    </button>
                  </div>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
