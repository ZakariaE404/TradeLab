import { Candle, ForexSymbol, Timeframe } from './trading';

export type DukascopyPriceType = 'BID' | 'ASK';

export type DukascopyTimeframe = 'm1' | 'm5' | 'm15' | 'm30' | 'h1' | 'h4' | 'd1';

export interface DukascopyInstrumentMeta {
  id: string; // Official dukascopy ID, e.g. 'eurusd', 'xauusd', 'usatechidxusd'
  symbol: ForexSymbol | string; // TradeLab symbol or display name
  name: string; // Full human-readable name
  category: 'Forex Major' | 'Precious Metal' | 'Index CFD' | 'Commodity' | 'Crypto' | 'ETF' | 'Equity';
  digits: number;
  pipSize: number;
  typicalSpreadPips: number;
  is24x7?: boolean;
}

export type HistoricalDatePreset =
  | '7d'
  | '30d'
  | '3m'
  | '6m'
  | '1y'
  | 'custom';

export interface HistoricalDownloadRequest {
  instrument: string; // Dukascopy ID, e.g. 'eurusd'
  timeframe: DukascopyTimeframe;
  from: string; // ISO date 'YYYY-MM-DD' or ISO timestamp
  to: string; // ISO date 'YYYY-MM-DD' or ISO timestamp
  priceType: DukascopyPriceType;
}

export interface SavedHistoricalDataset {
  id: string;
  name: string;
  instrument: string; // e.g. 'eurusd'
  symbol: string; // e.g. 'EUR/USD'
  timeframe: DukascopyTimeframe;
  displayTimeframe: Timeframe | string;
  startDate: string; // 'YYYY-MM-DD'
  endDate: string; // 'YYYY-MM-DD'
  startTime: number; // Unix epoch seconds
  endTime: number; // Unix epoch seconds
  priceType: DukascopyPriceType;
  candleCount: number;
  downloadDate: number; // epoch ms
  dataSource: 'Dukascopy' | 'CSV';
  status: 'READY' | 'DOWNLOADING' | 'ERROR' | 'PARTIAL';
  error?: string;
  candles?: Candle[];
}

export interface CanonicalM1Candle {
  id: string; // `${symbol}_${time}`
  symbol: string; // lowercase, e.g. 'xauusd'
  time: number; // Unix timestamp in seconds (start of the 1-minute bar, UTC aligned)
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  dataSource: string; // 'Dukascopy' | 'CSV'
  isComplete?: boolean;
}

export interface TimeRangeInterval {
  start: number; // Unix timestamp in seconds (inclusive)
  end: number;   // Unix timestamp in seconds (exclusive)
}

export interface SymbolCoverageRecord {
  symbol: string;
  intervals: TimeRangeInterval[];
  totalCandlesCount: number;
  firstCandleTime: number | null;
  lastCandleTime: number | null;
  lastUpdated: number;
}

export type AggregatedCandleStatus = 'COMPLETE' | 'INCOMPLETE' | 'SESSION_BOUNDARY';

export interface AggregatedCandle extends Candle {
  constituentCount: number;
  expectedConstituents: number;
  isComplete: boolean;
  hasGaps: boolean;
  status: AggregatedCandleStatus;
}

export interface DerivedCacheRecord {
  id: string; // `${symbol}_${timeframe}_${rangeStart}_${rangeEnd}`
  symbol: string;
  timeframe: string;
  rangeStart: number;
  rangeEnd: number;
  candles: Candle[];
  version: number;
  createdAt: number;
}

export interface DownloadProgressState {
  isDownloading: boolean;
  datasetId?: string;
  instrument: string;
  timeframe: string;
  progressPercent: number; // 0 - 100
  totalChunks: number;
  completedChunks: number;
  totalCandlesFetched: number;
  currentStage: string;
  error?: string | null;
  // M1 Canonical & Coverage Stats
  cachedIntervalsCount?: number;
  missingIntervalsCount?: number;
  totalM1CandlesStored?: number;
}
