import { Candle, ForexSymbol, SymbolMeta, Timeframe, TimeframeMeta } from '@/types/trading';

export const FOREX_SYMBOLS: Record<ForexSymbol, SymbolMeta> = {
  'XAUUSDm': {
    symbol: 'XAUUSDm',
    name: 'Gold / US Dollar (Demo Micro)',
    category: 'Precious Metal',
    basePrice: 2748.50,
    digits: 2,
    pipMultiplier: 10,
    pipSize: 0.1,
    typicalSpreadPips: 2.5,
  },
  'EUR/USD': {
    symbol: 'EUR/USD',
    name: 'Euro / US Dollar',
    category: 'Forex Major',
    basePrice: 1.0865,
    digits: 5,
    pipMultiplier: 10000,
    pipSize: 0.0001,
    typicalSpreadPips: 1.1,
  },
  'GBP/USD': {
    symbol: 'GBP/USD',
    name: 'British Pound / US Dollar',
    category: 'Forex Major',
    basePrice: 1.2980,
    digits: 5,
    pipMultiplier: 10000,
    pipSize: 0.0001,
    typicalSpreadPips: 1.4,
  },
  'USD/JPY': {
    symbol: 'USD/JPY',
    name: 'US Dollar / Japanese Yen',
    category: 'Forex Major',
    basePrice: 153.85,
    digits: 3,
    pipMultiplier: 100,
    pipSize: 0.01,
    typicalSpreadPips: 1.2,
  },
  'AUD/USD': {
    symbol: 'AUD/USD',
    name: 'Australian Dollar / US Dollar',
    category: 'Forex Commodity',
    basePrice: 0.6580,
    digits: 5,
    pipMultiplier: 10000,
    pipSize: 0.0001,
    typicalSpreadPips: 1.3,
  },
  'USD/CAD': {
    symbol: 'USD/CAD',
    name: 'US Dollar / Canadian Dollar',
    category: 'Forex Commodity',
    basePrice: 1.3910,
    digits: 5,
    pipMultiplier: 10000,
    pipSize: 0.0001,
    typicalSpreadPips: 1.5,
  },
  'USD/CHF': {
    symbol: 'USD/CHF',
    name: 'US Dollar / Swiss Franc',
    category: 'Forex Major',
    basePrice: 0.8670,
    digits: 5,
    pipMultiplier: 10000,
    pipSize: 0.0001,
    typicalSpreadPips: 1.5,
  },
  'NZD/USD': {
    symbol: 'NZD/USD',
    name: 'New Zealand Dollar / US Dollar',
    category: 'Forex Commodity',
    basePrice: 0.5960,
    digits: 5,
    pipMultiplier: 10000,
    pipSize: 0.0001,
    typicalSpreadPips: 1.8,
  },
  'XAU/USD': {
    symbol: 'XAU/USD',
    name: 'Gold / US Dollar',
    category: 'Precious Metal',
    basePrice: 2745.50,
    digits: 2,
    pipMultiplier: 10,
    pipSize: 0.1,
    typicalSpreadPips: 2.8,
  },
};

export const TIMEFRAMES: Record<Timeframe, TimeframeMeta> = {
  '15m': { id: '15m', label: 'M15', seconds: 900, barCount: 500 },
  '1h': { id: '1h', label: 'H1', seconds: 3600, barCount: 450 },
  '5m': { id: '5m', label: 'M5', seconds: 300, barCount: 550 },
  '1m': { id: '1m', label: 'M1', seconds: 60, barCount: 600 },
  '4h': { id: '4h', label: 'H4', seconds: 14400, barCount: 350 },
  '1D': { id: '1D', label: 'D1', seconds: 86400, barCount: 300 },
};

export interface CandleValidationResult {
  isValid: boolean;
  totalCandles: number;
  invalidCandlesCount: number;
  errors: string[];
}

/**
 * Validates candlestick data for strictly increasing timestamps and correct OHLC relationships.
 */
export function validateCandles(candles: Candle[]): CandleValidationResult {
  const errors: string[] = [];
  if (!candles || candles.length === 0) {
    return { isValid: false, totalCandles: 0, invalidCandlesCount: 0, errors: ['No candles provided'] };
  }

  let invalidCount = 0;
  let prevTime = 0;

  for (let i = 0; i < candles.length; i++) {
    const c = candles[i];
    const prefix = `Bar #${i}`;

    // Chronological timestamp validation
    if (c.time <= prevTime) {
      errors.push(`${prefix}: Timestamp ${c.time} is <= previous ${prevTime}`);
      invalidCount++;
    }
    prevTime = c.time;

    // Finite number checks
    if (
      !Number.isFinite(c.open) ||
      !Number.isFinite(c.high) ||
      !Number.isFinite(c.low) ||
      !Number.isFinite(c.close)
    ) {
      errors.push(`${prefix}: Contains non-finite OHLC`);
      invalidCount++;
      continue;
    }

    // Strict OHLC bounds check
    if (c.high < c.open || c.high < c.close) {
      errors.push(`${prefix}: High (${c.high}) < max(open, close)`);
      invalidCount++;
    }
    if (c.low > c.open || c.low > c.close) {
      errors.push(`${prefix}: Low (${c.low}) > min(open, close)`);
      invalidCount++;
    }
    if (c.high < c.low) {
      errors.push(`${prefix}: High (${c.high}) < Low (${c.low})`);
      invalidCount++;
    }
    if (c.open <= 0 || c.close <= 0 || c.high <= 0 || c.low <= 0) {
      errors.push(`${prefix}: Non-positive price`);
      invalidCount++;
    }
  }

  return {
    isValid: invalidCount === 0,
    totalCandles: candles.length,
    invalidCandlesCount: invalidCount,
    errors: errors.slice(0, 10),
  };
}

/**
 * Deterministic pseudo-random number generator (Mulberry32)
 */
function createSeededRandom(seed: number) {
  return function () {
    let t = (seed += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export type MarketRegime = 'mixed' | 'trending_bull' | 'trending_bear' | 'ranging_high_vol';

/**
 * Generates realistic deterministic Forex OHLCV candlestick data
 */
export function generateForexCandles(
  symbol: ForexSymbol,
  timeframe: Timeframe,
  seed: number = 42,
  barCountOverride?: number,
  regime: MarketRegime = 'mixed'
): Candle[] {
  const meta = FOREX_SYMBOLS[symbol];
  const tfMeta = TIMEFRAMES[timeframe];
  const barCount = barCountOverride || tfMeta.barCount;

  // Use seed combined with symbol and timeframe hash for uniqueness
  const symbolHash = symbol.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const tfHash = timeframe.split('').reduce((acc, char) => acc + char.charCodeAt(0), 0);
  const rng = createSeededRandom(seed + symbolHash * 101 + tfHash * 37);

  const candles: Candle[] = [];
  const basePrice = meta.basePrice;
  const digits = meta.digits;
  const pip = meta.pipSize;

  // Fixed reference timestamp ensures 100% deterministic SSR and hydration parity
  const DETERMINISTIC_BASE_TIME = 1730505600;
  const startTime = DETERMINISTIC_BASE_TIME - barCount * tfMeta.seconds;

  let currentPrice = basePrice;
  let trend = 0;
  let trendDuration = 0;
  let volatility = pip * (symbol === 'XAU/USD' || symbol === 'XAUUSDm' ? 45 : 12);

  // Adjust volatility for timeframe
  if (timeframe === '1m') volatility *= 0.5;
  if (timeframe === '5m') volatility *= 0.8;
  if (timeframe === '15m') volatility *= 1.3;
  if (timeframe === '1h') volatility *= 2.0;
  if (timeframe === '4h') volatility *= 3.5;
  if (timeframe === '1D') volatility *= 6.0;

  for (let i = 0; i < barCount; i++) {
    const time = startTime + i * tfMeta.seconds;

    // Shift market regime or mini-trends periodically
    if (trendDuration <= 0) {
      trendDuration = Math.floor(rng() * 35) + 15; // 15 to 50 bars

      if (regime === 'trending_bull') {
        trend = (rng() * 0.8 + 0.3) * volatility * 0.4;
      } else if (regime === 'trending_bear') {
        trend = -(rng() * 0.8 + 0.3) * volatility * 0.4;
      } else if (regime === 'ranging_high_vol') {
        trend = (rng() - 0.5) * volatility * 0.2;
      } else {
        // Mixed realistic cycles
        const roll = rng();
        if (roll < 0.38) trend = (rng() * 0.7 + 0.2) * volatility * 0.35; // Bullish phase
        else if (roll < 0.76) trend = -(rng() * 0.7 + 0.2) * volatility * 0.35; // Bearish phase
        else trend = (rng() - 0.5) * volatility * 0.15; // Consolidation
      }
    } else {
      trendDuration--;
    }

    // Session volatility simulation (mimic London / NY overlap surges)
    const hourOfDay = (time / 3600) % 24;
    const isLondonNY = hourOfDay >= 12 && hourOfDay <= 16;
    const currentVol = isLondonNY ? volatility * 1.4 : volatility;

    // Open is previous close
    const open = currentPrice;

    // Random walk delta with trend momentum
    const noise = (rng() - 0.5 + (rng() - 0.5)) * currentVol;
    const change = trend + noise;
    const close = Math.max(0.001, open + change);

    // Wicks
    const maxOC = Math.max(open, close);
    const minOC = Math.min(open, close);

    const upperWick = rng() * currentVol * 0.75;
    const lowerWick = rng() * currentVol * 0.75;

    const rawHigh = maxOC + upperWick;
    const rawLow = Math.max(0.0001, minOC - lowerWick);

    // Rounding while strictly preserving OHLC mathematical invariants
    const roundedOpen = Number(open.toFixed(digits));
    const roundedClose = Number(close.toFixed(digits));
    const roundedHigh = Math.max(roundedOpen, roundedClose, Number(rawHigh.toFixed(digits)));
    const roundedLow = Math.min(roundedOpen, roundedClose, Math.max(0.0001, Number(rawLow.toFixed(digits))));

    // Realistic volume
    const baseVolume = 800 + Math.floor(rng() * 1200);
    const volumeMultiplier = isLondonNY ? 1.8 : 1.0;
    const candleRange = roundedHigh - roundedLow;
    const volume = Math.floor(baseVolume * volumeMultiplier * (1 + candleRange / currentVol));

    candles.push({
      time,
      open: roundedOpen,
      high: roundedHigh,
      low: roundedLow,
      close: roundedClose,
      volume,
    });

    currentPrice = close;
  }

  return candles;
}

/**
 * Parses user-provided CSV content into Candle array
 * Supports common formats (MT4, MT5, TradingView, generic CSV)
 */
export function parseCSVToCandles(csvContent: string): { candles: Candle[]; error?: string } {
  try {
    const lines = csvContent.trim().split(/\r?\n/);
    if (lines.length < 5) {
      return { candles: [], error: 'CSV file contains too few rows (minimum 5 required).' };
    }

    const header = lines[0].toLowerCase();
    const headers = header.split(/[,;\t]/).map((h) => h.trim().replace(/['"]/g, ''));

    // Find column indexes
    let timeIdx = headers.findIndex((h) => h.includes('time') || h.includes('date'));
    let openIdx = headers.findIndex((h) => h.includes('open'));
    let highIdx = headers.findIndex((h) => h.includes('high'));
    let lowIdx = headers.findIndex((h) => h.includes('low'));
    let closeIdx = headers.findIndex((h) => h.includes('close'));
    let volIdx = headers.findIndex((h) => h.includes('vol') || h.includes('tick'));

    // Fallbacks if no headers (assume standard: Date, Open, High, Low, Close, Volume)
    if (openIdx === -1 && closeIdx === -1) {
      timeIdx = 0;
      openIdx = 1;
      highIdx = 2;
      lowIdx = 3;
      closeIdx = 4;
      volIdx = 5;
    }

    const parsedCandles: Candle[] = [];
    const startIndex = openIdx !== -1 && isNaN(Number(lines[0].split(/[,;\t]/)[openIdx])) ? 1 : 0;

    for (let i = startIndex; i < lines.length; i++) {
      const line = lines[i].trim();
      if (!line) continue;
      const cols = line.split(/[,;\t]/).map((c) => c.trim().replace(/['"]/g, ''));

      let time: number;
      const rawTime = cols[timeIdx];

      if (!isNaN(Number(rawTime)) && Number(rawTime) > 100000000) {
        time = Number(rawTime) > 100000000000 ? Math.floor(Number(rawTime) / 1000) : Number(rawTime);
      } else {
        const parsedDate = new Date(rawTime);
        time = !isNaN(parsedDate.getTime()) ? Math.floor(parsedDate.getTime() / 1000) : Math.floor(Date.now() / 1000) - (lines.length - i) * 3600;
      }

      const open = parseFloat(cols[openIdx]);
      const high = parseFloat(cols[highIdx]);
      const low = parseFloat(cols[lowIdx]);
      const close = parseFloat(cols[closeIdx]);
      const volume = volIdx !== -1 && cols[volIdx] ? parseFloat(cols[volIdx]) : 1000;

      if (!isNaN(open) && !isNaN(high) && !isNaN(low) && !isNaN(close)) {
        parsedCandles.push({
          time,
          open,
          high,
          low,
          close,
          volume: isNaN(volume) ? 1000 : volume,
        });
      }
    }

    // Ensure sorted ascending by timestamp and unique times
    parsedCandles.sort((a, b) => a.time - b.time);

    const dedupedCandles: Candle[] = [];
    let lastTime = 0;
    for (const c of parsedCandles) {
      if (c.time > lastTime) {
        dedupedCandles.push(c);
        lastTime = c.time;
      }
    }

    if (dedupedCandles.length < 5) {
      return { candles: [], error: 'Could not parse sufficient valid candle records from CSV.' };
    }

    return { candles: dedupedCandles };
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : 'Unknown error parsing CSV';
    return { candles: [], error: `Failed to parse CSV: ${message}` };
  }
}
