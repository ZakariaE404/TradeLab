import {
  DukascopyInstrumentMeta,
  DukascopyPriceType,
  DukascopyTimeframe,
  HistoricalDatePreset,
} from '@/types/historicalData';
import { Timeframe } from '@/types/trading';

/**
 * Dukascopy Supported Instruments Catalog
 * Validated against official dukascopy-node instrument definitions.
 * Never invent instrument IDs.
 */
export const DUKASCOPY_INSTRUMENTS: Record<string, DukascopyInstrumentMeta> = {
  eurusd: {
    id: 'eurusd',
    symbol: 'EUR/USD',
    name: 'Euro / US Dollar',
    category: 'Forex Major',
    digits: 5,
    pipSize: 0.0001,
    typicalSpreadPips: 1.1,
  },
  xauusd: {
    id: 'xauusd',
    symbol: 'XAU/USD',
    name: 'Gold / US Dollar',
    category: 'Precious Metal',
    digits: 2,
    pipSize: 0.1,
    typicalSpreadPips: 2.5,
  },
  usatechidxusd: {
    id: 'usatechidxusd',
    symbol: 'NASDAQ',
    name: 'US Tech 100 Index (NASDAQ)',
    category: 'Index CFD',
    digits: 2,
    pipSize: 1.0,
    typicalSpreadPips: 1.5,
  },
  gbpusd: {
    id: 'gbpusd',
    symbol: 'GBP/USD',
    name: 'British Pound / US Dollar',
    category: 'Forex Major',
    digits: 5,
    pipSize: 0.0001,
    typicalSpreadPips: 1.4,
  },
  usdjpy: {
    id: 'usdjpy',
    symbol: 'USD/JPY',
    name: 'US Dollar / Japanese Yen',
    category: 'Forex Major',
    digits: 3,
    pipSize: 0.01,
    typicalSpreadPips: 1.2,
  },
  audusd: {
    id: 'audusd',
    symbol: 'AUD/USD',
    name: 'Australian Dollar / US Dollar',
    category: 'Forex Major',
    digits: 5,
    pipSize: 0.0001,
    typicalSpreadPips: 1.3,
  },
  usdcad: {
    id: 'usdcad',
    symbol: 'USD/CAD',
    name: 'US Dollar / Canadian Dollar',
    category: 'Forex Major',
    digits: 5,
    pipSize: 0.0001,
    typicalSpreadPips: 1.5,
  },
  usdchf: {
    id: 'usdchf',
    symbol: 'USD/CHF',
    name: 'US Dollar / Swiss Franc',
    category: 'Forex Major',
    digits: 5,
    pipSize: 0.0001,
    typicalSpreadPips: 1.5,
  },
  nzdusd: {
    id: 'nzdusd',
    symbol: 'NZD/USD',
    name: 'New Zealand Dollar / US Dollar',
    category: 'Forex Major',
    digits: 5,
    pipSize: 0.0001,
    typicalSpreadPips: 1.8,
  },
  xagusd: {
    id: 'xagusd',
    symbol: 'XAG/USD',
    name: 'Silver / US Dollar',
    category: 'Precious Metal',
    digits: 3,
    pipSize: 0.001,
    typicalSpreadPips: 3.0,
  },
  btcusd: {
    id: 'btcusd',
    symbol: 'BTCUSD',
    name: 'Bitcoin / US Dollar',
    category: 'Crypto',
    digits: 2,
    pipSize: 1.0,
    typicalSpreadPips: 15.0,
    is24x7: true,
  },
  ethusd: {
    id: 'ethusd',
    symbol: 'ETHUSD',
    name: 'Ethereum / US Dollar',
    category: 'Crypto',
    digits: 2,
    pipSize: 0.1,
    typicalSpreadPips: 10.0,
    is24x7: true,
  },
  spyususd: {
    id: 'spyususd',
    symbol: 'SPY',
    name: 'SPDR S&P 500 ETF Trust',
    category: 'ETF',
    digits: 2,
    pipSize: 0.01,
    typicalSpreadPips: 2.0,
    is24x7: false,
  },
  qqqususd: {
    id: 'qqqususd',
    symbol: 'QQQ',
    name: 'Invesco QQQ Trust ETF',
    category: 'ETF',
    digits: 2,
    pipSize: 0.01,
    typicalSpreadPips: 2.0,
    is24x7: false,
  },
  gldususd: {
    id: 'gldususd',
    symbol: 'GLD',
    name: 'SPDR Gold Shares ETF',
    category: 'ETF',
    digits: 2,
    pipSize: 0.01,
    typicalSpreadPips: 2.0,
    is24x7: false,
  },
  slvususd: {
    id: 'slvususd',
    symbol: 'SLV',
    name: 'iShares Silver Trust ETF',
    category: 'ETF',
    digits: 3,
    pipSize: 0.01,
    typicalSpreadPips: 1.5,
    is24x7: false,
  },
  aaplususd: {
    id: 'aaplususd',
    symbol: 'AAPL',
    name: 'Apple Inc.',
    category: 'Equity',
    digits: 2,
    pipSize: 0.01,
    typicalSpreadPips: 2.0,
    is24x7: false,
  },
};

/**
 * Canonical TradeLab symbol -> official Dukascopy instrument ID mapping
 */
export const DUKASCOPY_SYMBOL_ALIASES: Record<string, string> = {
  btcusd: 'btcusd',
  'btc/usd': 'btcusd',
  'btc-usd': 'btcusd',
  ethusd: 'ethusd',
  'eth/usd': 'ethusd',
  'eth-usd': 'ethusd',
  spy: 'spyususd',
  'spy.us': 'spyususd',
  'spy.us/usd': 'spyususd',
  spyususd: 'spyususd',
  qqq: 'qqqususd',
  'qqq.us': 'qqqususd',
  'qqq.us/usd': 'qqqususd',
  qqqususd: 'qqqususd',
  gld: 'gldususd',
  'gld.us': 'gldususd',
  'gld.us/usd': 'gldususd',
  gldususd: 'gldususd',
  slv: 'slvususd',
  'slv.us': 'slvususd',
  'slv.us/usd': 'slvususd',
  slvususd: 'slvususd',
  aapl: 'aaplususd',
  'aapl.us': 'aaplususd',
  'aapl.us/usd': 'aaplususd',
  aaplususd: 'aaplususd',
  'eur/usd': 'eurusd',
  eurusd: 'eurusd',
  'gbp/usd': 'gbpusd',
  gbpusd: 'gbpusd',
  'usd/jpy': 'usdjpy',
  usdjpy: 'usdjpy',
  'aud/usd': 'audusd',
  audusd: 'audusd',
  'usd/cad': 'usdcad',
  usdcad: 'usdcad',
  'usd/chf': 'usdchf',
  usdchf: 'usdchf',
  'nzd/usd': 'nzdusd',
  nzdusd: 'nzdusd',
  'xau/usd': 'xauusd',
  xauusdm: 'xauusd',
  xauusd: 'xauusd',
  'xag/usd': 'xagusd',
  xagusd: 'xagusd',
  nasdaq: 'usatechidxusd',
  usatechidxusd: 'usatechidxusd',
};

/**
 * Resolves a TradeLab symbol or Dukascopy ID (case-insensitive) to the official Dukascopy instrument ID.
 */
export function resolveDukascopyInstrumentId(symbolOrId: string): string {
  const clean = (symbolOrId || '').trim().toLowerCase();
  return DUKASCOPY_SYMBOL_ALIASES[clean] || clean;
}

/**
 * Returns true for 24/7 instruments (e.g. BTCUSD, ETHUSD) that do not observe weekend market closures.
 */
export function is24x7DukascopyInstrument(symbolOrId: string): boolean {
  const resolved = resolveDukascopyInstrumentId(symbolOrId);
  return Boolean(DUKASCOPY_INSTRUMENTS[resolved]?.is24x7);
}

/**
 * Dukascopy timeframe to TradeLab timeframe mappings
 */
export const DUKASCOPY_TIMEFRAMES: {
  id: DukascopyTimeframe;
  label: string;
  displayTf: Timeframe;
  seconds: number;
}[] = [
  { id: 'm1', label: 'M1', displayTf: '1m', seconds: 60 },
  { id: 'm5', label: 'M5', displayTf: '5m', seconds: 300 },
  { id: 'm15', label: 'M15', displayTf: '15m', seconds: 900 },
  { id: 'm30', label: 'M30', displayTf: '30m', seconds: 1800 },
  { id: 'h1', label: 'H1', displayTf: '1h', seconds: 3600 },
  { id: 'h4', label: 'H4', displayTf: '4h', seconds: 14400 },
  { id: 'd1', label: 'D1', displayTf: '1D', seconds: 86400 },
];

export function mapDukascopyTfToTradeLabTf(tf: DukascopyTimeframe): Timeframe {
  const match = DUKASCOPY_TIMEFRAMES.find((item) => item.id === tf);
  return match ? match.displayTf : '15m';
}

export function mapTradeLabTfToDukascopyTf(tf: Timeframe): DukascopyTimeframe {
  switch (tf) {
    case '1m':
      return 'm1';
    case '5m':
      return 'm5';
    case '15m':
      return 'm15';
    case '30m':
      return 'm30';
    case '1h':
      return 'h1';
    case '4h':
      return 'h4';
    case '1D':
      return 'd1';
    default:
      return 'm15';
  }
}

/**
 * Validates instrument ID or TradeLab symbol alias against Dukascopy's catalog
 */
export function isValidDukascopyInstrument(instrumentId: string): boolean {
  if (!instrumentId) return false;
  const resolved = resolveDukascopyInstrumentId(instrumentId);
  return Boolean(DUKASCOPY_INSTRUMENTS[resolved]);
}

export function getDukascopyInstrumentMeta(instrumentId: string): DukascopyInstrumentMeta {
  const cleanId = resolveDukascopyInstrumentId(instrumentId);
  return (
    DUKASCOPY_INSTRUMENTS[cleanId] || {
      id: cleanId,
      symbol: cleanId.toUpperCase(),
      name: cleanId.toUpperCase(),
      category: 'Forex Major',
      digits: 5,
      pipSize: 0.0001,
      typicalSpreadPips: 1.5,
    }
  );
}

/**
 * Calculate Start & End Date for presets
 */
export function getDateRangeForPreset(preset: HistoricalDatePreset): { from: string; to: string } {
  const now = new Date();
  const to = now.toISOString().split('T')[0];

  const fromDate = new Date(now);

  switch (preset) {
    case '7d':
      fromDate.setDate(fromDate.getDate() - 7);
      break;
    case '30d':
      fromDate.setDate(fromDate.getDate() - 30);
      break;
    case '3m':
      fromDate.setMonth(fromDate.getMonth() - 3);
      break;
    case '6m':
      fromDate.setMonth(fromDate.getMonth() - 6);
      break;
    case '1y':
      fromDate.setFullYear(fromDate.getFullYear() - 1);
      break;
    default:
      fromDate.setDate(fromDate.getDate() - 30);
      break;
  }

  const from = fromDate.toISOString().split('T')[0];
  return { from, to };
}

/**
 * Validates user-selected download parameters
 */
export function validateDownloadParams(params: {
  instrument: string;
  timeframe: string;
  from: string;
  to: string;
  priceType: DukascopyPriceType;
}): { isValid: boolean; error?: string } {
  if (!params.instrument || !isValidDukascopyInstrument(params.instrument)) {
    return {
      isValid: false,
      error: `Invalid instrument '${params.instrument}'. Must be a supported Dukascopy instrument ID (e.g. eurusd, xauusd, usatechidxusd).`,
    };
  }

  const validTfs: DukascopyTimeframe[] = ['m1', 'm5', 'm15', 'm30', 'h1', 'h4', 'd1'];
  if (!validTfs.includes(params.timeframe as DukascopyTimeframe)) {
    return {
      isValid: false,
      error: `Invalid timeframe '${params.timeframe}'. Supported: M1, M5, M15, M30, H1, H4, D1.`,
    };
  }

  if (params.priceType !== 'BID' && params.priceType !== 'ASK') {
    return {
      isValid: false,
      error: `Invalid price type '${params.priceType}'. Must be BID or ASK.`,
    };
  }

  const fromTs = Date.parse(params.from);
  const toTs = Date.parse(params.to);

  if (isNaN(fromTs) || isNaN(toTs)) {
    return {
      isValid: false,
      error: 'Invalid start date or end date format. Please use YYYY-MM-DD.',
    };
  }

  if (fromTs >= toTs) {
    return {
      isValid: false,
      error: 'Start date must be strictly before end date.',
    };
  }

  return { isValid: true };
}
