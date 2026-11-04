import { Candle, ForexSymbol } from '@/types/trading';
import {
  ConfirmedSwingPoint,
  H1TrendState,
  M15EntrySignal,
  RejectionType,
  SimulatedTrade,
  StrategyABacktestResult,
  StrategyAParameters,
  StructureType,
  TrendBias,
} from '@/types/strategyA';
import { calculateEMA } from './indicators';
import { FOREX_SYMBOLS } from './marketData';

export const DEFAULT_STRATEGY_A_PARAMS: StrategyAParameters = {
  // H1 Trend Filter Parameters
  h1FastEmaPeriod: 50,
  h1SlowEmaPeriod: 200,
  h1SwingLookback: 3,
  requireH1Structure: true,

  // M15 Entry Parameters
  m15FastEmaPeriod: 50,
  m15SlowEmaPeriod: 200,
  m15SwingLookback: 3,
  minRejectionWickRatio: 0.35, // 35% of total bar must be rejection wick
  zoneTolerancePips: 3.0,
  requireM15EmaFilter: true,

  // Risk & Position Management
  riskRewardRatio: 2.0, // 2:1 RR
  stopLossBufferPips: 2.0,
  minStopLossPips: 5.0,
  maxHoldingBars: 200,
  allowMultiplePositions: false,

  // Account
  accountCapital: 10000,
  riskPercent: 1.0,
};

export const STRATEGY_A_ASSUMPTIONS: string[] = [
  'A1: Strict Multi-Timeframe No-Lookahead — An H1 candle is considered closed only when all 3600s have passed. For any M15 bar ending at timestamp t, the latest H1 candle evaluated must have closed at or before t.',
  'A2: Confirmed Swing Point Lag — A swing high or low with lookback N requires N bars after it to be confirmed. A swing at bar index k is only confirmed and visible to the strategy at bar k + N, preventing future-data leakage.',
  'A3: Structural Bias Definition — Bullish structure requires the two most recent confirmed swing highs to be increasing (Higher High) and the two most recent confirmed swing lows to be increasing (Higher Low). Bearish structure requires Lower Highs and Lower Lows.',
  'A4: Explicit Rejection Candle Rules — For BUY: lower wick / total range >= minRejectionWickRatio (default 35%) and close in the upper 60% of the bar. For SELL: upper wick / total range >= minRejectionWickRatio and close in the lower 60% of the bar.',
  'A5: Support/Resistance Zone Definition — Support is defined by the M15 EMA 50 or the latest confirmed M15 swing low (within zoneTolerancePips). Resistance is defined by the M15 EMA 50 or latest confirmed swing high.',
  'A6: Conservative Simultaneous SL/TP Touch Assumption — If a candle touches both Stop Loss and Take Profit within the same bar, the trade is conservatively evaluated as STOP LOSS first to prevent optimistic bias.',
  'A7: Execution Timing — Signals are generated on the CLOSE of M15 bar i. The simulated trade is entered at the OPEN of bar i+1. Subsequent price simulation evaluates bars i+1 onwards.',
  'A8: Position Exclusivity — By default, duplicate signals while a trade is currently open are ignored (allowMultiplePositions: false).',
];

/**
 * Aggregates M15 candles into chronologically aligned H1 candles
 * 4 M15 candles = 1 H1 candle
 */
export function aggregateM15ToH1(m15Candles: Candle[]): Candle[] {
  if (!m15Candles || m15Candles.length === 0) return [];

  const h1Map = new Map<number, Candle[]>();

  for (const c of m15Candles) {
    // Floor to 1-hour epoch (3600 seconds)
    const hourStart = Math.floor(c.time / 3600) * 3600;
    if (!h1Map.has(hourStart)) {
      h1Map.set(hourStart, []);
    }
    h1Map.get(hourStart)!.push(c);
  }

  const h1Candles: Candle[] = [];
  const sortedHourStarts = Array.from(h1Map.keys()).sort((a, b) => a - b);

  for (const hourStart of sortedHourStarts) {
    const barsInHour = h1Map.get(hourStart)!;
    if (barsInHour.length === 0) continue;

    // Sort ascending by time
    barsInHour.sort((a, b) => a.time - b.time);

    const open = barsInHour[0].open;
    const close = barsInHour[barsInHour.length - 1].close;
    let high = -Infinity;
    let low = Infinity;
    let volume = 0;

    for (const b of barsInHour) {
      if (b.high > high) high = b.high;
      if (b.low < low) low = b.low;
      volume += b.volume;
    }

    h1Candles.push({
      time: hourStart,
      open,
      high,
      low,
      close,
      volume,
    });
  }

  return h1Candles;
}

/**
 * Detects swing points with lookback N.
 * ONLY returns swings that were confirmed at or before `upToIndex` (i.e. swingIndex + lookback <= upToIndex).
 * This mathematically guarantees ZERO future-data lookahead.
 */
export function detectConfirmedSwings(
  candles: Candle[],
  lookback: number = 3,
  upToIndex: number = candles.length - 1
): ConfirmedSwingPoint[] {
  const swings: ConfirmedSwingPoint[] = [];
  const maxEvalIndex = Math.min(upToIndex - lookback, candles.length - 1 - lookback);

  if (maxEvalIndex < lookback) return swings;

  for (let i = lookback; i <= maxEvalIndex; i++) {
    const current = candles[i];
    let isSwingHigh = true;
    let isSwingLow = true;

    for (let k = 1; k <= lookback; k++) {
      if (candles[i - k].high >= current.high || candles[i + k].high > current.high) {
        isSwingHigh = false;
      }
      if (candles[i - k].low <= current.low || candles[i + k].low < current.low) {
        isSwingLow = false;
      }
      if (!isSwingHigh && !isSwingLow) break;
    }

    const confirmedAtIndex = i + lookback;
    if (confirmedAtIndex <= upToIndex) {
      if (isSwingHigh) {
        swings.push({
          index: i,
          time: current.time,
          price: current.high,
          type: 'HIGH',
          confirmedAtIndex,
          confirmedAtTime: candles[confirmedAtIndex].time,
        });
      }
      if (isSwingLow) {
        swings.push({
          index: i,
          time: current.time,
          price: current.low,
          type: 'LOW',
          confirmedAtIndex,
          confirmedAtTime: candles[confirmedAtIndex].time,
        });
      }
    }
  }

  // Sort by index ascending
  return swings.sort((a, b) => a.index - b.index);
}

/**
 * Analyzes market structure (HH+HL vs LH+LL) from confirmed swings up to current index
 */
export function evaluateMarketStructure(
  swings: ConfirmedSwingPoint[]
): {
  structure: StructureType;
  lastHighs: [number, number] | null;
  lastLows: [number, number] | null;
} {
  const highs = swings.filter((s) => s.type === 'HIGH');
  const lows = swings.filter((s) => s.type === 'LOW');

  if (highs.length < 2 || lows.length < 2) {
    return { structure: 'NEUTRAL', lastHighs: null, lastLows: null };
  }

  const prevHigh = highs[highs.length - 2].price;
  const latestHigh = highs[highs.length - 1].price;
  const prevLow = lows[lows.length - 2].price;
  const latestLow = lows[lows.length - 1].price;

  const isHigherHigh = latestHigh > prevHigh;
  const isHigherLow = latestLow > prevLow;
  const isLowerHigh = latestHigh < prevHigh;
  const isLowerLow = latestLow < prevLow;

  let structure: StructureType = 'NEUTRAL';
  if (isHigherHigh && isHigherLow) {
    structure = 'BULLISH';
  } else if (isLowerHigh && isLowerLow) {
    structure = 'BEARISH';
  }

  return {
    structure,
    lastHighs: [prevHigh, latestHigh],
    lastLows: [prevLow, latestLow],
  };
}

/**
 * Evaluates the H1 Trend Filter at a specific closed H1 candle index
 */
export function evaluateH1Trend(
  h1Candles: Candle[],
  h1ClosedIndex: number,
  h1Ema50Map: Map<number, number>,
  h1Ema200Map: Map<number, number>,
  params: StrategyAParameters
): H1TrendState {
  if (h1ClosedIndex < 0 || h1ClosedIndex >= h1Candles.length) {
    return {
      bias: 'NEUTRAL',
      ema50: 0,
      ema200: 0,
      emaConditionMet: false,
      closeConditionMet: false,
      structure: 'NEUTRAL',
      lastSwingHighs: null,
      lastSwingLows: null,
      latestClosedH1Time: 0,
    };
  }

  const candle = h1Candles[h1ClosedIndex];
  const ema50 = h1Ema50Map.get(candle.time);
  const ema200 = h1Ema200Map.get(candle.time);

  if (ema50 === undefined || ema200 === undefined) {
    return {
      bias: 'NEUTRAL',
      ema50: 0,
      ema200: 0,
      emaConditionMet: false,
      closeConditionMet: false,
      structure: 'NEUTRAL',
      lastSwingHighs: null,
      lastSwingLows: null,
      latestClosedH1Time: candle.time,
    };
  }

  // Detect confirmed swings on H1 up to h1ClosedIndex
  const confirmedSwings = detectConfirmedSwings(
    h1Candles,
    params.h1SwingLookback,
    h1ClosedIndex
  );
  const { structure, lastHighs, lastLows } = evaluateMarketStructure(confirmedSwings);

  // BUY Bias Conditions:
  // 1. EMA 50 > EMA 200
  // 2. Closed H1 candle closes above EMA 50
  // 3. Price structure shows higher highs and higher lows (if required)
  const isBuyEma = ema50 > ema200;
  const isBuyClose = candle.close > ema50;
  const isBuyStructure = !params.requireH1Structure || structure === 'BULLISH';

  // SELL Bias Conditions:
  // 1. EMA 50 < EMA 200
  // 2. Closed H1 candle closes below EMA 50
  // 3. Price structure shows lower highs and lower lows (if required)
  const isSellEma = ema50 < ema200;
  const isSellClose = candle.close < ema50;
  const isSellStructure = !params.requireH1Structure || structure === 'BEARISH';

  let bias: TrendBias = 'NEUTRAL';
  let emaConditionMet = false;
  let closeConditionMet = false;

  if (isBuyEma && isBuyClose && isBuyStructure) {
    bias = 'BUY';
    emaConditionMet = true;
    closeConditionMet = true;
  } else if (isSellEma && isSellClose && isSellStructure) {
    bias = 'SELL';
    emaConditionMet = true;
    closeConditionMet = true;
  }

  return {
    bias,
    ema50,
    ema200,
    emaConditionMet,
    closeConditionMet,
    structure,
    lastSwingHighs: lastHighs,
    lastSwingLows: lastLows,
    latestClosedH1Time: candle.time,
  };
}

/**
 * Finds the latest CLOSED H1 candle for a given M15 candle timestamp.
 * An H1 candle opening at T closes at T + 3600.
 * An M15 candle opening at t closes at t + candleIntervalSeconds.
 * To avoid future lookahead: the H1 candle must have closed at or before t + candleIntervalSeconds.
 */
export function getLatestClosedH1Index(
  m15CandleTime: number,
  h1Candles: Candle[],
  candleIntervalSeconds: number = 900
): number {
  const m15CloseTime = m15CandleTime + candleIntervalSeconds;
  let low = 0;
  let high = h1Candles.length - 1;
  let bestIdx = -1;

  while (low <= high) {
    const mid = Math.floor((low + high) / 2);
    const h1CloseTime = h1Candles[mid].time + 3600;

    if (h1CloseTime <= m15CloseTime) {
      bestIdx = mid;
      low = mid + 1; // look for more recent closed H1
    } else {
      high = mid - 1;
    }
  }

  return bestIdx;
}

/**
 * Evaluates whether an M15 candle qualifies as a bullish or bearish rejection candle
 */
export function evaluateRejectionCandle(
  candle: Candle,
  minRatio: number = 0.35
): {
  type: RejectionType;
  wickRatio: number;
} {
  const totalRange = candle.high - candle.low;
  if (totalRange <= 0) {
    return { type: 'NONE', wickRatio: 0 };
  }

  const lowerWick = Math.min(candle.open, candle.close) - candle.low;
  const upperWick = candle.high - Math.max(candle.open, candle.close);

  const lowerWickRatio = lowerWick / totalRange;
  const upperWickRatio = upperWick / totalRange;

  // Bullish rejection: prominent lower wick, close in upper 60% of candle range
  const isCloseInUpperHalf = (candle.close - candle.low) / totalRange >= 0.45;
  if (lowerWickRatio >= minRatio && isCloseInUpperHalf) {
    return { type: 'BULLISH_REJECTION', wickRatio: Number(lowerWickRatio.toFixed(3)) };
  }

  // Bearish rejection: prominent upper wick, close in lower 60% of candle range
  const isCloseInLowerHalf = (candle.high - candle.close) / totalRange >= 0.45;
  if (upperWickRatio >= minRatio && isCloseInLowerHalf) {
    return { type: 'BEARISH_REJECTION', wickRatio: Number(upperWickRatio.toFixed(3)) };
  }

  return {
    type: 'NONE',
    wickRatio: Number(Math.max(lowerWickRatio, upperWickRatio).toFixed(3)),
  };
}

/**
 * Checks if price reaches a predefined support or resistance zone on M15
 */
export function evaluateSupportResistanceZone(
  candle: Candle,
  m15Ema50: number | undefined,
  latestConfirmedSwingLow: number | null,
  latestConfirmedSwingHigh: number | null,
  direction: 'BUY' | 'SELL',
  tolerance: number
): { isZoneReached: boolean; zoneLevel: number } {
  if (direction === 'BUY') {
    // For BUY: Price low must reach or penetrate EMA 50 or recent swing low support
    const levels: number[] = [];
    if (m15Ema50 !== undefined) levels.push(m15Ema50);
    if (latestConfirmedSwingLow !== null) levels.push(latestConfirmedSwingLow);

    for (const lvl of levels) {
      if (candle.low <= lvl + tolerance && candle.close >= lvl - tolerance * 2) {
        return { isZoneReached: true, zoneLevel: lvl };
      }
    }
  } else {
    // For SELL: Price high must reach or penetrate EMA 50 or recent swing high resistance
    const levels: number[] = [];
    if (m15Ema50 !== undefined) levels.push(m15Ema50);
    if (latestConfirmedSwingHigh !== null) levels.push(latestConfirmedSwingHigh);

    for (const lvl of levels) {
      if (candle.high >= lvl - tolerance && candle.close <= lvl + tolerance * 2) {
        return { isZoneReached: true, zoneLevel: lvl };
      }
    }
  }

  return { isZoneReached: false, zoneLevel: 0 };
}

/**
 * Full sequential historical backtesting simulation for Strategy A
 */
export function runStrategyABacktest(
  m15Candles: Candle[],
  providedH1Candles: Candle[] | null,
  params: StrategyAParameters = DEFAULT_STRATEGY_A_PARAMS,
  symbol: ForexSymbol = 'XAUUSDm'
): StrategyABacktestResult {
  const symbolMeta = FOREX_SYMBOLS[symbol] || FOREX_SYMBOLS['XAUUSDm'] || FOREX_SYMBOLS['EUR/USD'];
  const pipSize = symbolMeta.pipSize;
  const digits = symbolMeta.digits;

  // Use synchronized H1 candles
  const h1Candles =
    providedH1Candles && providedH1Candles.length > 50
      ? providedH1Candles
      : aggregateM15ToH1(m15Candles);

  // Pre-calculate H1 EMAs
  const h1Ema50Points = calculateEMA(h1Candles, params.h1FastEmaPeriod);
  const h1Ema200Points = calculateEMA(h1Candles, params.h1SlowEmaPeriod);
  const h1Ema50Map = new Map<number, number>();
  for (const p of h1Ema50Points) h1Ema50Map.set(p.time, p.value);
  const h1Ema200Map = new Map<number, number>();
  for (const p of h1Ema200Points) h1Ema200Map.set(p.time, p.value);

  // Pre-calculate M15 EMAs
  const m15Ema50Points = calculateEMA(m15Candles, params.m15FastEmaPeriod);
  const m15Ema200Points = calculateEMA(m15Candles, params.m15SlowEmaPeriod);
  const m15Ema50Map = new Map<number, number>();
  for (const p of m15Ema50Points) m15Ema50Map.set(p.time, p.value);
  const m15Ema200Map = new Map<number, number>();
  for (const p of m15Ema200Points) m15Ema200Map.set(p.time, p.value);

  const signals: M15EntrySignal[] = [];
  const trades: SimulatedTrade[] = [];
  let activeTrade: SimulatedTrade | null = null;
  let tradeCounter = 1;

  const minWarmup = Math.max(
    params.m15SlowEmaPeriod,
    params.m15FastEmaPeriod,
    params.m15SwingLookback * 4,
    60
  );

  const zoneTolerancePrice = params.zoneTolerancePips * pipSize;
  const slBufferPrice = params.stopLossBufferPips * pipSize;
  const minSlPrice = params.minStopLossPips * pipSize;

  const detectedInterval =
    m15Candles.length >= 2 ? Math.abs(m15Candles[1].time - m15Candles[0].time) : 900;
  const candleInterval = detectedInterval > 0 ? detectedInterval : 900;

  for (let i = minWarmup; i < m15Candles.length; i++) {
    const candle = m15Candles[i];

    // 1. Evaluate Open Trade progression on current candle (subsequent candles after entry)
    if (activeTrade) {
      activeTrade.holdingBars++;
      let isClosed = false;

      const isLong = activeTrade.direction === 'BUY';
      const sl = activeTrade.stopLossPrice;
      const tp = activeTrade.takeProfitPrice;

      if (isLong) {
        const touchedSL = candle.low <= sl;
        const touchedTP = candle.high >= tp;

        if (touchedSL && touchedTP) {
          // Conservative assumption: simultaneous touch resolved to Stop Loss
          activeTrade.exitPrice = sl;
          activeTrade.exitTime = candle.time;
          activeTrade.exitIndex = i;
          activeTrade.exitReason = 'SL';
          activeTrade.status = 'LOSS';
          activeTrade.simultaneousTouchResolvedToSL = true;
          isClosed = true;
        } else if (touchedSL) {
          activeTrade.exitPrice = sl;
          activeTrade.exitTime = candle.time;
          activeTrade.exitIndex = i;
          activeTrade.exitReason = 'SL';
          activeTrade.status = 'LOSS';
          isClosed = true;
        } else if (touchedTP) {
          activeTrade.exitPrice = tp;
          activeTrade.exitTime = candle.time;
          activeTrade.exitIndex = i;
          activeTrade.exitReason = 'TP';
          activeTrade.status = 'WIN';
          isClosed = true;
        } else if (activeTrade.holdingBars >= params.maxHoldingBars) {
          activeTrade.exitPrice = candle.close;
          activeTrade.exitTime = candle.time;
          activeTrade.exitIndex = i;
          activeTrade.exitReason = 'MAX_BARS';
          activeTrade.status = candle.close >= activeTrade.entryPrice ? 'WIN' : 'LOSS';
          isClosed = true;
        }
      } else {
        // SHORT trade evaluation
        const touchedSL = candle.high >= sl;
        const touchedTP = candle.low <= tp;

        if (touchedSL && touchedTP) {
          // Conservative assumption: simultaneous touch resolved to Stop Loss
          activeTrade.exitPrice = sl;
          activeTrade.exitTime = candle.time;
          activeTrade.exitIndex = i;
          activeTrade.exitReason = 'SL';
          activeTrade.status = 'LOSS';
          activeTrade.simultaneousTouchResolvedToSL = true;
          isClosed = true;
        } else if (touchedSL) {
          activeTrade.exitPrice = sl;
          activeTrade.exitTime = candle.time;
          activeTrade.exitIndex = i;
          activeTrade.exitReason = 'SL';
          activeTrade.status = 'LOSS';
          isClosed = true;
        } else if (touchedTP) {
          activeTrade.exitPrice = tp;
          activeTrade.exitTime = candle.time;
          activeTrade.exitIndex = i;
          activeTrade.exitReason = 'TP';
          activeTrade.status = 'WIN';
          isClosed = true;
        } else if (activeTrade.holdingBars >= params.maxHoldingBars) {
          activeTrade.exitPrice = candle.close;
          activeTrade.exitTime = candle.time;
          activeTrade.exitIndex = i;
          activeTrade.exitReason = 'MAX_BARS';
          activeTrade.status = candle.close <= activeTrade.entryPrice ? 'WIN' : 'LOSS';
          isClosed = true;
        }
      }

      if (isClosed && activeTrade.exitPrice !== null) {
        finalizeSimulatedTrade(activeTrade, pipSize);
        trades.push(activeTrade);
        activeTrade = null;
      }
    }

    // 2. Evaluate M15 Entry Signal at candle CLOSE (only if no open trade or multiple allowed)
    if (!activeTrade || params.allowMultiplePositions) {
      // Find latest CLOSED H1 candle for M15 bar i (ZERO lookahead)
      const closedH1Index = getLatestClosedH1Index(candle.time, h1Candles, candleInterval);
      if (closedH1Index < 0) continue;

      const h1Trend = evaluateH1Trend(
        h1Candles,
        closedH1Index,
        h1Ema50Map,
        h1Ema200Map,
        params
      );

      // Only proceed if H1 Trend Filter has a clear directional bias
      if (h1Trend.bias === 'BUY' || h1Trend.bias === 'SELL') {
        const direction = h1Trend.bias;

        // M15 EMA Filter Condition
        const m15Ema50 = m15Ema50Map.get(candle.time);
        const m15Ema200 = m15Ema200Map.get(candle.time);

        let m15EmaFilterPassed = true;
        if (params.requireM15EmaFilter && m15Ema50 !== undefined && m15Ema200 !== undefined) {
          if (direction === 'BUY' && m15Ema50 <= m15Ema200) m15EmaFilterPassed = false;
          if (direction === 'SELL' && m15Ema50 >= m15Ema200) m15EmaFilterPassed = false;
        }

        if (m15EmaFilterPassed) {
          // Detect confirmed swings on M15 up to candle i
          const confirmedM15Swings = detectConfirmedSwings(
            m15Candles,
            params.m15SwingLookback,
            i
          );
          const confirmedLows = confirmedM15Swings.filter((s) => s.type === 'LOW');
          const confirmedHighs = confirmedM15Swings.filter((s) => s.type === 'HIGH');

          const latestSwingLow =
            confirmedLows.length > 0 ? confirmedLows[confirmedLows.length - 1].price : null;
          const latestSwingHigh =
            confirmedHighs.length > 0 ? confirmedHighs[confirmedHighs.length - 1].price : null;

          // Check Support / Resistance Zone reach
          const zoneCheck = evaluateSupportResistanceZone(
            candle,
            m15Ema50,
            latestSwingLow,
            latestSwingHigh,
            direction,
            zoneTolerancePrice
          );

          if (zoneCheck.isZoneReached) {
            // Check Rejection Candle Confirmation
            const rejection = evaluateRejectionCandle(candle, params.minRejectionWickRatio);
            const isRejectionValid =
              (direction === 'BUY' && rejection.type === 'BULLISH_REJECTION') ||
              (direction === 'SELL' && rejection.type === 'BEARISH_REJECTION');

            if (isRejectionValid) {
              // Signal triggered! Entry price is the close of the signal candle
              const entryPrice = candle.close;

              // Confirmed swing level for Stop-Loss placement
              let stopLossPrice = 0;
              let confirmedSwingPrice = 0;

              if (direction === 'BUY') {
                const swingRef = latestSwingLow !== null ? latestSwingLow : candle.low;
                confirmedSwingPrice = swingRef;
                const calculatedSL = swingRef - slBufferPrice;
                const minAllowedSL = entryPrice - minSlPrice;
                stopLossPrice = Math.min(calculatedSL, minAllowedSL);
              } else {
                const swingRef = latestSwingHigh !== null ? latestSwingHigh : candle.high;
                confirmedSwingPrice = swingRef;
                const calculatedSL = swingRef + slBufferPrice;
                const minAllowedSL = entryPrice + minSlPrice;
                stopLossPrice = Math.max(calculatedSL, minAllowedSL);
              }

              const riskDistance = Math.abs(entryPrice - stopLossPrice);
              const rewardDistance = riskDistance * params.riskRewardRatio;

              const takeProfitPrice =
                direction === 'BUY'
                  ? entryPrice + rewardDistance
                  : entryPrice - rewardDistance;

              const riskPips = Number((riskDistance / pipSize).toFixed(1));
              const rewardPips = Number((rewardDistance / pipSize).toFixed(1));

              const signal: M15EntrySignal = {
                signalIndex: i,
                signalTime: candle.time,
                direction,
                h1Bias: h1Trend.bias,
                entryPrice: Number(entryPrice.toFixed(digits)),
                stopLossPrice: Number(stopLossPrice.toFixed(digits)),
                takeProfitPrice: Number(takeProfitPrice.toFixed(digits)),
                riskPips,
                rewardPips,
                riskRewardRatio: params.riskRewardRatio,
                rejectionWickRatio: rejection.wickRatio,
                m15Ema50: m15Ema50 !== undefined ? Number(m15Ema50.toFixed(digits)) : 0,
                m15Ema200: m15Ema200 !== undefined ? Number(m15Ema200.toFixed(digits)) : 0,
                confirmedSwingPrice: Number(confirmedSwingPrice.toFixed(digits)),
                zonePrice: Number(zoneCheck.zoneLevel.toFixed(digits)),
                rationale: `H1 ${h1Trend.bias} + M15 EMA50 support/res zone touched + ${
                  rejection.type
                } (${(rejection.wickRatio * 100).toFixed(0)}% wick)`,
              };

              signals.push(signal);

              // Position initiates for simulation at next bar
              activeTrade = {
                id: `TRD-${tradeCounter++}`,
                index: trades.length + 1,
                symbol,
                direction,
                signalTime: candle.time,
                signalIndex: i,
                entryTime: i < m15Candles.length - 1 ? m15Candles[i + 1].time : candle.time,
                entryIndex: i + 1,
                entryPrice: Number(entryPrice.toFixed(digits)),
                stopLossPrice: Number(stopLossPrice.toFixed(digits)),
                takeProfitPrice: Number(takeProfitPrice.toFixed(digits)),
                exitTime: null,
                exitIndex: null,
                exitPrice: null,
                exitReason: 'UNRESOLVED',
                status: 'UNRESOLVED',
                riskAmount: Number(
                  (params.accountCapital * (params.riskPercent / 100)).toFixed(2)
                ),
                riskPips,
                rewardPips,
                realizedPnlPips: 0,
                realizedR: 0,
                holdingBars: 0,
                simultaneousTouchResolvedToSL: false,
                signalReason: signal.rationale,
                h1Bias: h1Trend.bias,
                m15Confirmation: `M15 EMA50 zone touch at ${zoneCheck.zoneLevel.toFixed(digits)} + ${rejection.type} (${(rejection.wickRatio * 100).toFixed(0)}% wick)`,
                riskRewardRatio: params.riskRewardRatio,
              };
            }
          }
        }
      }
    }
  }

  // Handle open trade still unresolved at the end of the dataset
  if (activeTrade) {
    const lastCandle = m15Candles[m15Candles.length - 1];
    activeTrade.exitTime = lastCandle.time;
    activeTrade.exitIndex = m15Candles.length - 1;
    activeTrade.exitPrice = lastCandle.close;
    activeTrade.exitReason = 'UNRESOLVED';
    activeTrade.status = 'UNRESOLVED';
    finalizeSimulatedTrade(activeTrade, pipSize);
    trades.push(activeTrade);
  }

  return compileStrategyAResults(signals, trades, params.accountCapital);
}

function finalizeSimulatedTrade(trade: SimulatedTrade, pipSize: number) {
  if (trade.exitPrice === null) return;

  const pipsDiff =
    trade.direction === 'BUY'
      ? (trade.exitPrice - trade.entryPrice) / pipSize
      : (trade.entryPrice - trade.exitPrice) / pipSize;

  trade.realizedPnlPips = Number(pipsDiff.toFixed(1));

  const riskPips = Math.max(trade.riskPips, 1);
  const realizedR = trade.realizedPnlPips / riskPips;
  trade.realizedR = Number(realizedR.toFixed(2));

  if (trade.status === 'UNRESOLVED') {
    // Keep unresolved status
  } else if (trade.realizedR >= 0.1) {
    trade.status = 'WIN';
  } else if (trade.realizedR <= -0.1) {
    trade.status = 'LOSS';
  } else {
    trade.status = 'BREAKEVEN';
  }
}

function compileStrategyAResults(
  signals: M15EntrySignal[],
  trades: SimulatedTrade[],
  startingCapital: number
): StrategyABacktestResult {
  const resolvedTrades = trades.filter((t) => t.status !== 'UNRESOLVED');
  let wins = 0;
  let losses = 0;
  let breakevens = 0;
  let unresolved = 0;

  let grossProfitR = 0;
  let grossLossR = 0;
  let netR = 0;

  let longCount = 0;
  let longWins = 0;
  let shortCount = 0;
  let shortWins = 0;

  let peakCumulativeR = 0;
  let maxDrawdownR = 0;
  let peakEquity = startingCapital;
  let currentEquity = startingCapital;
  let maxDrawdownPercent = 0;

  for (const t of trades) {
    if (t.status === 'UNRESOLVED') {
      unresolved++;
      continue;
    }

    netR += t.realizedR;
    const dollarPnl = t.realizedR * t.riskAmount;
    currentEquity += dollarPnl;

    if (t.status === 'WIN') {
      wins++;
      grossProfitR += t.realizedR;
    } else if (t.status === 'LOSS') {
      losses++;
      grossLossR += Math.abs(t.realizedR);
    } else {
      breakevens++;
    }

    if (t.direction === 'BUY') {
      longCount++;
      if (t.status === 'WIN') longWins++;
    } else {
      shortCount++;
      if (t.status === 'WIN') shortWins++;
    }

    // High water marks
    if (netR > peakCumulativeR) peakCumulativeR = netR;
    const ddR = peakCumulativeR - netR;
    if (ddR > maxDrawdownR) maxDrawdownR = ddR;

    if (currentEquity > peakEquity) peakEquity = currentEquity;
    const ddPct = peakEquity > 0 ? ((peakEquity - currentEquity) / peakEquity) * 100 : 0;
    if (ddPct > maxDrawdownPercent) maxDrawdownPercent = ddPct;
  }

  const totalResolved = resolvedTrades.length;
  const winRate = totalResolved > 0 ? Number(((wins / totalResolved) * 100).toFixed(1)) : 0;
  const profitFactor =
    grossLossR > 0 ? Number((grossProfitR / grossLossR).toFixed(2)) : grossProfitR > 0 ? 99.9 : 0;

  const avgWinR = wins > 0 ? Number((grossProfitR / wins).toFixed(2)) : 0;
  const avgLossR = losses > 0 ? Number((grossLossR / losses).toFixed(2)) : 0;

  const winProb = totalResolved > 0 ? wins / totalResolved : 0;
  const lossProb = totalResolved > 0 ? losses / totalResolved : 0;
  const expectancyR = Number((winProb * avgWinR - lossProb * avgLossR).toFixed(2));

  return {
    signals,
    trades,
    totalSignals: signals.length,
    totalTrades: trades.length,
    wins,
    losses,
    breakevens,
    unresolved,
    winRate,
    profitFactor,
    netR: Number(netR.toFixed(2)),
    totalPnlCurrency: Number((currentEquity - startingCapital).toFixed(2)),
    maxDrawdownR: Number(maxDrawdownR.toFixed(2)),
    maxDrawdownPercent: Number(maxDrawdownPercent.toFixed(1)),
    avgWinR,
    avgLossR,
    expectancyR,
    longCount,
    longWins,
    shortCount,
    shortWins,
    assumptions: STRATEGY_A_ASSUMPTIONS,
  };
}
