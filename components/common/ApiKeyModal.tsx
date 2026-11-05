'use client';

import React, { useState, useEffect } from 'react';
import { Key, ExternalLink, X, Check, ShieldCheck, AlertCircle } from 'lucide-react';
import { getStoredUserApiKey, setStoredUserApiKey } from '@/services/realMarketData';

interface ApiKeyModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSave: (key: string) => void;
}

export function ApiKeyModal({ isOpen, onClose, onSave }: ApiKeyModalProps) {
  const [apiKey, setApiKey] = useState('');
  const [savedSuccess, setSavedSuccess] = useState(false);

  useEffect(() => {
    if (isOpen) {
      setApiKey(getStoredUserApiKey());
      setSavedSuccess(false);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault();
    const cleanKey = apiKey.trim();
    setStoredUserApiKey(cleanKey);
    setSavedSuccess(true);
    setTimeout(() => {
      onSave(cleanKey);
      onClose();
    }, 400);
  };

  const handleClear = () => {
    setApiKey('');
    setStoredUserApiKey('');
    onSave('');
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/75 backdrop-blur-sm p-4 animate-fadeIn">
      <div className="w-full max-w-md bg-[#0b0f19] border border-slate-800 rounded-xl shadow-2xl overflow-hidden font-sans">
        {/* Header */}
        <div className="px-5 py-4 border-b border-slate-800/80 flex items-center justify-between bg-[#0e1422]">
          <div className="flex items-center gap-2.5">
            <div className="w-8 h-8 rounded-lg bg-amber-500/10 border border-amber-500/30 flex items-center justify-center text-amber-400">
              <Key className="w-4 h-4" />
            </div>
            <div>
              <h2 className="text-sm font-bold text-white tracking-tight">Twelve Data API Key</h2>
              <p className="text-[11px] text-slate-400">Connect real market data for Gold & Forex</p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-white hover:bg-slate-800/80 rounded-md transition cursor-pointer"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {/* Content */}
        <form onSubmit={handleSave} className="p-5 space-y-4">
          <div>
            <label className="block text-xs font-semibold text-slate-300 mb-1.5">
              API Key (Token)
            </label>
            <div className="relative">
              <input
                type="text"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="Paste your Twelve Data API key here..."
                autoFocus
                className="w-full px-3.5 py-2.5 bg-[#131b2e] border border-slate-700/80 focus:border-amber-500 focus:ring-1 focus:ring-amber-500 rounded-lg text-xs font-mono text-white placeholder-slate-500 outline-none transition"
              />
            </div>
          </div>

          <div className="p-3 rounded-lg bg-slate-900/90 border border-slate-800 space-y-2 text-xs">
            <div className="flex items-start gap-2 text-slate-300">
              <ShieldCheck className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
              <span className="text-[11px] text-slate-400 leading-relaxed">
                Your key is stored securely in your browser&apos;s local storage and passed directly to your local proxy route. It is never logged or exposed.
              </span>
            </div>
            <div className="flex items-center justify-between pt-1 border-t border-slate-800/80">
              <span className="text-[11px] text-slate-400">Don&apos;t have an API key?</span>
              <a
                href="https://twelvedata.com"
                target="_blank"
                rel="noreferrer"
                className="text-[11px] font-semibold text-amber-400 hover:text-amber-300 flex items-center gap-1 transition"
              >
                <span>Get free key (800 calls/day)</span>
                <ExternalLink className="w-3 h-3" />
              </a>
            </div>
          </div>

          <div className="pt-2 flex items-center justify-between gap-3">
            {apiKey && (
              <button
                type="button"
                onClick={handleClear}
                className="px-3 py-2 text-xs text-rose-400 hover:text-rose-300 hover:bg-rose-950/40 rounded-lg transition cursor-pointer"
              >
                Clear Key
              </button>
            )}
            <div className="flex items-center gap-2 ml-auto">
              <button
                type="button"
                onClick={onClose}
                className="px-3.5 py-2 text-xs font-medium text-slate-300 hover:text-white hover:bg-slate-800 rounded-lg transition cursor-pointer"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-2 bg-amber-500 hover:bg-amber-400 text-slate-950 rounded-lg text-xs font-bold transition flex items-center gap-1.5 shadow-md shadow-amber-500/20 cursor-pointer"
              >
                {savedSuccess ? (
                  <>
                    <Check className="w-3.5 h-3.5 text-slate-950" />
                    <span>Saved!</span>
                  </>
                ) : (
                  <span>Save & Connect</span>
                )}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
