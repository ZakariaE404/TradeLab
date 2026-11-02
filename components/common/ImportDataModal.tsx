'use client';

import React, { useState } from 'react';
import { Candle } from '@/types/trading';
import { parseCSVToCandles } from '@/services/marketData';
import { X, Upload, FileText, CheckCircle2, AlertTriangle, ArrowRight } from 'lucide-react';

interface ImportDataModalProps {
  isOpen: boolean;
  onClose: () => void;
  onImportCandles: (candles: Candle[], fileName: string) => void;
}

export function ImportDataModal({ isOpen, onClose, onImportCandles }: ImportDataModalProps) {
  const [csvText, setCsvText] = useState('');
  const [fileName, setFileName] = useState('');
  const [parsedPreview, setParsedPreview] = useState<{
    candles: Candle[];
    count: number;
    error?: string;
  } | null>(null);

  if (!isOpen) return null;

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = (event) => {
      const content = event.target?.result as string;
      setCsvText(content);
      const res = parseCSVToCandles(content);
      if (res.error) {
        setParsedPreview({ candles: [], count: 0, error: res.error });
      } else {
        setParsedPreview({ candles: res.candles, count: res.candles.length });
      }
    };
    reader.readAsText(file);
  };

  const handleTextChange = (text: string) => {
    setCsvText(text);
    if (!text.trim()) {
      setParsedPreview(null);
      return;
    }
    const res = parseCSVToCandles(text);
    if (res.error) {
      setParsedPreview({ candles: [], count: 0, error: res.error });
    } else {
      setParsedPreview({ candles: res.candles, count: res.candles.length });
    }
  };

  const handleApply = () => {
    if (parsedPreview && parsedPreview.candles.length > 0) {
      onImportCandles(parsedPreview.candles, fileName || 'custom_data.csv');
      onClose();
    }
  };

  const handleLoadSampleCSV = () => {
    // Generates a mock standard CSV format
    const sampleHeaders = 'Date,Time,Open,High,Low,Close,Volume\n';
    let sampleRows = '';
    const now = Math.floor(Date.now() / 1000) - 200 * 3600;
    let price = 1.085;

    for (let i = 0; i < 200; i++) {
      const d = new Date((now + i * 3600) * 1000);
      const dateStr = d.toISOString().split('T')[0];
      const timeStr = d.toISOString().split('T')[1].substring(0, 5);
      const open = price;
      const high = price + 0.0015;
      const low = price - 0.001;
      const close = price + (Math.sin(i / 5) > 0 ? 0.0008 : -0.0006);
      sampleRows += `${dateStr},${timeStr},${open.toFixed(5)},${high.toFixed(5)},${low.toFixed(
        5
      )},${close.toFixed(5)},1250\n`;
      price = close;
    }

    const fullSample = sampleHeaders + sampleRows;
    setFileName('EURUSD_1H_sample.csv');
    handleTextChange(fullSample);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 select-none">
      <div className="w-full max-w-lg bg-[#0c101a] border border-slate-800 rounded-lg shadow-2xl flex flex-col overflow-hidden text-xs">
        {/* Header */}
        <div className="px-4 py-3 bg-[#080b11] border-b border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Upload className="w-4 h-4 text-emerald-400" />
            <h3 className="font-bold text-slate-100 text-sm">Import Custom OHLCV Data</h3>
          </div>
          <button
            onClick={onClose}
            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-slate-200"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          <p className="text-slate-400 leading-relaxed text-[11px]">
            Upload a CSV exported from MetaTrader, TradingView, or your broker. Format supported:
            <code className="text-emerald-400 ml-1">Date, Open, High, Low, Close, Volume</code>.
          </p>

          {/* File Upload Drop Area */}
          <div className="border-2 border-dashed border-slate-800 hover:border-slate-700 rounded-lg p-4 text-center bg-[#070a10] cursor-pointer relative group">
            <input
              type="file"
              accept=".csv,.txt"
              onChange={handleFileUpload}
              className="absolute inset-0 opacity-0 cursor-pointer w-full h-full"
            />
            <div className="flex flex-col items-center justify-center gap-1.5 pointer-events-none">
              <Upload className="w-6 h-6 text-slate-500 group-hover:text-emerald-400 transition-colors" />
              <div className="font-medium text-slate-200">
                {fileName ? fileName : 'Choose CSV file or drag and drop'}
              </div>
              <div className="text-[10px] text-slate-500">Supports comma, tab, or semicolon separated values</div>
            </div>
          </div>

          <div className="flex items-center justify-between text-[11px]">
            <span className="text-slate-500">Or paste raw CSV text:</span>
            <button
              onClick={handleLoadSampleCSV}
              className="text-sky-400 hover:text-sky-300 underline underline-offset-2 transition-colors"
            >
              Paste MT4 Sample Template
            </button>
          </div>

          <textarea
            value={csvText}
            onChange={(e) => handleTextChange(e.target.value)}
            placeholder="Date,Open,High,Low,Close,Volume&#10;2024-03-01 10:00,1.0850,1.0865,1.0845,1.0860,1500"
            rows={5}
            className="w-full bg-[#070a10] border border-slate-800 rounded p-2 text-slate-200 font-mono text-[10px] focus:outline-none focus:border-emerald-500"
          />

          {/* Validation Feedback */}
          {parsedPreview && (
            <div
              className={`p-2.5 rounded border text-[11px] flex items-center gap-2 ${
                parsedPreview.error
                  ? 'bg-rose-500/10 border-rose-500/30 text-rose-300'
                  : 'bg-emerald-500/10 border-emerald-500/30 text-emerald-300'
              }`}
            >
              {parsedPreview.error ? (
                <>
                  <AlertTriangle className="w-4 h-4 text-rose-400 shrink-0" />
                  <span>{parsedPreview.error}</span>
                </>
              ) : (
                <>
                  <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                  <span>
                    Successfully parsed <strong>{parsedPreview.count} candles</strong> ready for
                    backtesting!
                  </span>
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="px-4 py-3 bg-[#080b11] border-t border-slate-800 flex items-center justify-end gap-2">
          <button
            onClick={onClose}
            className="px-3 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleApply}
            disabled={!parsedPreview || parsedPreview.candles.length === 0}
            className="px-4 py-1.5 rounded bg-emerald-500 hover:bg-emerald-400 disabled:opacity-40 disabled:cursor-not-allowed text-slate-950 font-bold text-xs flex items-center gap-1.5 transition-all shadow-md shadow-emerald-500/20"
          >
            <span>Load into Terminal</span>
            <ArrowRight className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>
    </div>
  );
}
