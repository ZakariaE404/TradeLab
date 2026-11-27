import {
  BacktestResult,
  Candle,
  EquityPoint,
  ForexSymbol,
  MonthlyPerformance,
  SmcFibBarPoint,
  SmcFibChartOverlay,
  SmcFibZoneSegment,
  SmcStructureEvent,
  Timeframe,
  Trade,
} from '@/types/trading';
import { FOREX_SYMBOLS } from '@/services/marketData';
import { is24x7DukascopyInstrument } from '@/services/dukascopyCatalog';
import { SMC_FIB_4H_V1_DEFAULTS, SmcFibParameters } from './config';

/**
 * Computes Simple Moving Average ATR (`ta.sma(ta.tr(true), period)` / QC `AverageTrueRange(period, Simple)`).
 * Causal, zero-lookahead: bar i only uses bars 0..i.
 */
export function calculateSmaAtr(candles: Candle[], period: number = 14): (number | null)[] {
  const n = candles.length;
  if (n === 0 || period <= 0) return [];
  const result: (number | null)[] = new Array(n).fill(null);
  const tr: number[] = new Array(n);

  tr[0] = candles[0].high - candles[0].low;
  for (let i = 1; i < n; i++) {
    const c = candles[i];
    const prevClose = candles[i - 1].close;
    tr[i] = Math.max(
      c.high - c.low,
      Math.abs(c.high - prevClose),
      Math.abs(c.low - prevClose)
    );
  }

  if (n < period) return result;

  let sum = 0;
  for (let i = 0; i < n; i++) {
    sum += tr[i];
    if (i >= period) {
      sum -= tr[i - period];
    }
    if (i >= period - 1) {
      result[i] = sum / period;
    }
  }

  return result;
}

/**
 * Determines whether a symbol should use crypto fractional sizing (round to 4 decimals)
 * vs equity/ETF integer share sizing (floor to int).
 */
export function isCryptoSymbol(symbol: ForexSymbol | string, override?: boolean): boolean {
  if (typeof override === 'boolean') return override;
  const meta = FOREX_SYMBOLS[symbol];
  if (meta?.category === 'Crypto') return true;
  if (is24x7DukascopyInstrument(String(symbol))) return true;
  const clean = String(symbol).toUpperCase().replace(/[^A-Z0-9]/g, '');
  return clean.startsWith('BTC') || clean.startsWith('ETH');
}

/**
 * Exact quantity calculation matching QC `SMCFibEngine.execute_trade` and Pine `f_qty`:
 * - Crypto: round(raw_qty, 4)
 * - Equities / ETFs: floor(raw_qty) / int(raw_qty)
 */
export function calculateSmcFibQuantity(
  equity: number,
  riskPercent: number,
  riskDist: number,
  isCrypto: boolean
): number {
  if (equity <= 0 || riskPercent <= 0 || riskDist <= 0 || !Number.isFinite(riskDist)) {
    return 0;
  }
  const riskAmt = equity * (riskPercent / 100);
  const rawQty = riskAmt / riskDist;
  if (!Number.isFinite(rawQty) || rawQty <= 0) return 0;

  return isCrypto ? Math.round(rawQty * 10000) / 10000 : Math.floor(rawQty);
}

interface InternalActivePosition {
  id: string;
  index: number;
  direction: 'BUY' | 'SELL';
  signalTime: number;
  signalIndex: number;
  entryTime: number;
  entryPrice: number;
  entryIndex: number;
  stopLoss: number;
  takeProfit: number;
  qty: number;
  riskAmt: number;
  riskDist: number;
  signalReason: string;
  h1Bias: string;
  m15Confirmation: string;
}

/**
 * Runs an exact causal simulation of `SMCFibEngine` (SMC_FIB_4H_V1) on H4 bars.
 * Preserves:
 * - Swing detection with swingLength=10 (21-bar centered window, confirmed at i + swingLength)
 * - BOS detection (close crossing lastHigh / lastLow)
 * - Dynamic impulseHigh / impulseLow extension while zoneActive
 * - 0.60 - 0.70 Fibonacci retracement zone
 * - SMA-based ATR(14), 2 ATR stop loss, 0.5% risk, 15R target
 * - Priority: long_fail > short_fail > long_entry > short_entry
 * - CHOCH liquidation of opposing open position + immediate counter-trend reversal
 */
export function runSmcFibBacktest(
  h4Candles: Candle[],
  symbol: ForexSymbol,
  partialParams: Partial<SmcFibParameters> = {},
  dataSourceDescription?: string
): BacktestResult {
  const params: SmcFibParameters = {
    ...SMC_FIB_4H_V1_DEFAULTS,
    ...partialParams,
  };

  const initialCapital = params.initialCapital > 0 ? params.initialCapital : 100000;
  if (!h4Candles || h4Candles.length < 2 * params.swingLength + 2) {
    return createEmptySmcResult(initialCapital, dataSourceDescription);
  }

  const symbolMeta = FOREX_SYMBOLS[symbol] || FOREX_SYMBOLS['SPY'];
  const pipSize = symbolMeta?.pipSize || 0.01;
  const digits = symbolMeta?.digits ?? 2;
  const cryptoAsset = isCryptoSymbol(symbol, params.isCrypto);

  const atrSeries = calculateSmaAtr(h4Candles, params.atrLength);

  // Persistent strategy state (mirrors QC SymbolData & Pine var state)
  let lastHigh: number | null = null;
  let lastLow: number | null = null;
  let trend: -1 | 0 | 1 = 0;
  let impulseHigh: number | null = null;
  let impulseLow: number | null = null;
  let zoneActive = false;

  let bullTop: number | null = null;
  let bullBottom: number | null = null;
  let bearBottom: number | null = null;
  let bearTop: number | null = null;

  let equity = initialCapital;
  let activePos: InternalActivePosition | null = null as InternalActivePosition | null;
  const trades: Trade[] = [];
  let tradeCounter = 1;

  // Overlay records for Phase 3 chart visualization
  const structureEvents: SmcStructureEvent[] = [];
  const barSeries: SmcFibBarPoint[] = [];
  const fibZoneSegments: SmcFibZoneSegment[] = [];

  const finalizeClosedTrade = (
    pos: InternalActivePosition,
    exitPrice: number,
    exitTime: number,
    exitIndex: number,
    exitReason: Trade['exitReason'],
    simultaneousTouchResolvedToSL = false
  ) => {
    const isBuy = pos.direction === 'BUY';
    const rawDiff = isBuy ? exitPrice - pos.entryPrice : pos.entryPrice - exitPrice;
    const pnlCurrency = Number((pos.qty * rawDiff).toFixed(2));
    const pnlPips = Number((rawDiff / pipSize).toFixed(1));
    const pnlR = pos.riskAmt > 0 ? Number((pnlCurrency / pos.riskAmt).toFixed(2)) : 0;

    let status: Trade['status'] = 'BREAKEVEN';
    if (pnlCurrency > 0.005) status = 'WIN';
    else if (pnlCurrency < -0.005) status = 'LOSS';

    equity += pnlCurrency;

    trades.push({
      id: pos.id,
      index: pos.index,
      symbol,
      timeframe: '4h' as Timeframe,
      direction: pos.direction,
      signalTime: pos.signalTime,
      signalIndex: pos.signalIndex,
      entryTime: pos.entryTime,
      entryPrice: pos.entryPrice,
      entryIndex: pos.entryIndex,
      exitTime,
      exitPrice,
      exitIndex,
      stopLoss: pos.stopLoss,
      takeProfit: pos.takeProfit,
      initialRiskPips: Math.max(0.1, Number((pos.riskDist / pipSize).toFixed(1))),
      status,
      exitReason,
      pnlPips,
      pnlCurrency,
      pnlR,
      holdingBars: Math.max(0, exitIndex - pos.entryIndex),
      riskAmount: Number(pos.riskAmt.toFixed(2)),
      signalReason: pos.signalReason,
      h1Bias: pos.h1Bias,
      m15Confirmation: pos.m15Confirmation,
      riskRewardRatio: params.rrTarget,
      simultaneousTouchResolvedToSL,
    });
  };

  const openTrade = (
    barIdx: number,
    direction: 'BUY' | 'SELL',
    sl: number,
    tp: number,
    riskDist: number,
    signalReason: string,
    confirmation: string
  ): InternalActivePosition | null => {
    const signalBar = h4Candles[barIdx];

    if (params.executionTiming === 'next_open') {
      if (barIdx + 1 >= h4Candles.length) {
        return null; // Cannot fill on next bar open if no subsequent bar exists
      }
      const nextBar = h4Candles[barIdx + 1];
      const qty = calculateSmcFibQuantity(equity, params.riskPercent, riskDist, cryptoAsset);
      if (qty <= 0) return null;

      const riskAmt = equity * (params.riskPercent / 100);
      const pos: InternalActivePosition = {
        id: `TRD-${tradeCounter}`,
        index: tradeCounter,
        direction,
        signalTime: signalBar.time,
        signalIndex: barIdx,
        entryTime: nextBar.time,
        entryPrice: nextBar.open,
        entryIndex: barIdx + 1,
        stopLoss: Number(sl.toFixed(Math.max(digits, 4))),
        takeProfit: Number(tp.toFixed(Math.max(digits, 4))),
        qty,
        riskAmt,
        riskDist,
        signalReason,
        h1Bias: direction === 'BUY' ? 'H4 Bullish Structure' : 'H4 Bearish Structure',
        m15Confirmation: confirmation,
      };
      tradeCounter++;
      return pos;
    } else {
      // Pine Script v6 `process_orders_on_close = true`
      const qty = calculateSmcFibQuantity(equity, params.riskPercent, riskDist, cryptoAsset);
      if (qty <= 0) return null;

      const riskAmt = equity * (params.riskPercent / 100);
      const pos: InternalActivePosition = {
        id: `TRD-${tradeCounter}`,
        index: tradeCounter,
        direction,
        signalTime: signalBar.time,
        signalIndex: barIdx,
        entryTime: signalBar.time,
        entryPrice: signalBar.close,
        entryIndex: barIdx,
        stopLoss: Number(sl.toFixed(Math.max(digits, 4))),
        takeProfit: Number(tp.toFixed(Math.max(digits, 4))),
        qty,
        riskAmt,
        riskDist,
        signalReason,
        h1Bias: direction === 'BUY' ? 'H4 Bullish Structure' : 'H4 Bearish Structure',
        m15Confirmation: confirmation,
      };
      tradeCounter++;
      return pos;
    }
  };

  for (let i = 0; i < h4Candles.length; i++) {
    const currentBar = h4Candles[i];

    // STEP A: Check intrabar SL / TP for active position
    // - In 'next_open' mode, position opens at entryIndex (= signalIndex + 1) open, so SL/TP active on i >= entryIndex
    // - In 'close' mode, position opens at entryIndex (= signalIndex) close, so SL/TP active on i > entryIndex
    if (activePos) {
      const canCheckIntrabar =
        params.executionTiming === 'next_open'
          ? i >= activePos.entryIndex
          : i > activePos.entryIndex;

      if (canCheckIntrabar) {
        const isBuy = activePos.direction === 'BUY';
        const sl = activePos.stopLoss;
        const tp = activePos.takeProfit;

        if (isBuy) {
          const touchedSL = currentBar.low <= sl;
          const touchedTP = currentBar.high >= tp;

          if (touchedSL && touchedTP) {
            const fillPrice = currentBar.open <= sl ? currentBar.open : sl;
            finalizeClosedTrade(activePos, fillPrice, currentBar.time, i, 'SL', true);
            activePos = null;
          } else if (touchedSL) {
            const fillPrice = currentBar.open <= sl ? currentBar.open : sl;
            finalizeClosedTrade(activePos, fillPrice, currentBar.time, i, 'SL', false);
            activePos = null;
          } else if (touchedTP) {
            const fillPrice = currentBar.open >= tp ? currentBar.open : tp;
            finalizeClosedTrade(activePos, fillPrice, currentBar.time, i, 'TP', false);
            activePos = null;
          }
        } else {
          const touchedSL = currentBar.high >= sl;
          const touchedTP = currentBar.low <= tp;

          if (touchedSL && touchedTP) {
            const fillPrice = currentBar.open >= sl ? currentBar.open : sl;
            finalizeClosedTrade(activePos, fillPrice, currentBar.time, i, 'SL', true);
            activePos = null;
          } else if (touchedSL) {
            const fillPrice = currentBar.open >= sl ? currentBar.open : sl;
            finalizeClosedTrade(activePos, fillPrice, currentBar.time, i, 'SL', false);
            activePos = null;
          } else if (touchedTP) {
            const fillPrice = currentBar.open <= tp ? currentBar.open : tp;
            finalizeClosedTrade(activePos, fillPrice, currentBar.time, i, 'TP', false);
            activePos = null;
          }
        }
      }
    }

    // STEP B: Strategy Signal & State Evaluation at Bar Close
    const atrVal = atrSeries[i];
    const ready = i >= 2 * params.swingLength && atrVal !== null;

    if (!ready) {
      barSeries.push({
        time: currentBar.time,
        trend,
        zoneActive,
        bullTop: null,
        bullBottom: null,
        bearBottom: null,
        bearTop: null,
        lastHigh,
        lastLow,
      });
      continue;
    }

    const prevBar = h4Candles[i - 1];
    const checkIdx = i - params.swingLength;
    const checkBar = h4Candles[checkIdx];

    // 1. Swing detection (2 * swingLength + 1 window)
    let isPH = true;
    let isPL = true;
    for (let j = i - 2 * params.swingLength; j <= i; j++) {
      if (h4Candles[j].high > checkBar.high) isPH = false;
      if (h4Candles[j].low < checkBar.low) isPL = false;
    }

    if (isPH) lastHigh = checkBar.high;
    if (isPL) lastLow = checkBar.low;

    // 2. Break of Structure (BOS)
    const haveLevels = lastHigh !== null && lastLow !== null;
    const bullBOS = haveLevels && prevBar.close <= lastHigh! && currentBar.close > lastHigh!;
    const bearBOS = haveLevels && prevBar.close >= lastLow! && currentBar.close < lastLow!;

    if (bullBOS) {
      trend = 1;
      impulseLow = lastLow;
      impulseHigh = currentBar.high;
      zoneActive = true;
      structureEvents.push({
        time: currentBar.time,
        type: 'BULL_BOS',
        price: currentBar.close,
        brokenLevel: lastHigh!,
        trendAfter: 1,
      });
    } else if (bearBOS) {
      trend = -1;
      impulseHigh = lastHigh;
      impulseLow = currentBar.low;
      zoneActive = true;
      structureEvents.push({
        time: currentBar.time,
        type: 'BEAR_BOS',
        price: currentBar.close,
        brokenLevel: lastLow!,
        trendAfter: -1,
      });
    }

    // 3. Dynamic impulse extension
    if (trend === 1 && zoneActive && impulseHigh !== null) {
      impulseHigh = Math.max(impulseHigh, currentBar.high);
    } else if (trend === -1 && zoneActive && impulseLow !== null) {
      impulseLow = Math.min(impulseLow, currentBar.low);
    }

    // 4. Fibonacci zones (0.60 - 0.70)
    if (impulseHigh !== null && impulseLow !== null) {
      const dist = impulseHigh - impulseLow;
      bullTop = impulseHigh - dist * params.fibStart;
      bullBottom = impulseHigh - dist * params.fibEnd;
      bearBottom = impulseLow + dist * params.fibStart;
      bearTop = impulseLow + dist * params.fibEnd;
    }

    // 5. Signal flags
    const invested = activePos !== null;
    const isLong = activePos?.direction === 'BUY';
    const isShort = activePos?.direction === 'SELL';

    const longEntry =
      trend === 1 &&
      zoneActive &&
      bullTop !== null &&
      bullBottom !== null &&
      currentBar.low <= bullTop &&
      currentBar.close > bullBottom &&
      !invested;

    const shortEntry =
      trend === -1 &&
      zoneActive &&
      bearBottom !== null &&
      bearTop !== null &&
      currentBar.high >= bearBottom &&
      currentBar.close < bearTop &&
      !invested;

    const longFail = trend === 1 && bullBottom !== null && currentBar.close < bullBottom;
    const shortFail = trend === -1 && bearTop !== null && currentBar.close > bearTop;

    // 6. Execution priority: longFail > shortFail > longEntry > shortEntry
    if (longFail) {
      structureEvents.push({
        time: currentBar.time,
        type: 'BEAR_CHOCH',
        price: currentBar.close,
        brokenLevel: bullBottom!,
        trendAfter: -1,
      });

      if (isLong && activePos) {
        const liqPrice =
          params.executionTiming === 'next_open' && i + 1 < h4Candles.length
            ? h4Candles[i + 1].open
            : currentBar.close;
        const liqTime =
          params.executionTiming === 'next_open' && i + 1 < h4Candles.length
            ? h4Candles[i + 1].time
            : currentBar.time;
        const liqIdx =
          params.executionTiming === 'next_open' && i + 1 < h4Candles.length ? i + 1 : i;
        finalizeClosedTrade(activePos, liqPrice, liqTime, liqIdx, 'SIGNAL_CLOSE', false);
        activePos = null;
      }

      trend = -1;
      zoneActive = false;

      if (!activePos) {
        const sl = currentBar.high + atrVal! * params.slAtrMultiplier;
        const riskDist = sl - currentBar.close;
        if (riskDist > 0) {
          const tp = currentBar.close - riskDist * params.rrTarget;
          activePos = openTrade(
            i,
            'SELL',
            sl,
            tp,
            riskDist,
            `CHOCH - Bull Structure Failed (Close < ${bullBottom!.toFixed(digits)})`,
            `BEAR CHOCH Reversal | SL ${params.slAtrMultiplier}x ATR | ${params.rrTarget}R`
          );
        }
      }
    } else if (shortFail) {
      structureEvents.push({
        time: currentBar.time,
        type: 'BULL_CHOCH',
        price: currentBar.close,
        brokenLevel: bearTop!,
        trendAfter: 1,
      });

      if (isShort && activePos) {
        const liqPrice =
          params.executionTiming === 'next_open' && i + 1 < h4Candles.length
            ? h4Candles[i + 1].open
            : currentBar.close;
        const liqTime =
          params.executionTiming === 'next_open' && i + 1 < h4Candles.length
            ? h4Candles[i + 1].time
            : currentBar.time;
        const liqIdx =
          params.executionTiming === 'next_open' && i + 1 < h4Candles.length ? i + 1 : i;
        finalizeClosedTrade(activePos, liqPrice, liqTime, liqIdx, 'SIGNAL_CLOSE', false);
        activePos = null;
      }

      trend = 1;
      zoneActive = false;

      if (!activePos) {
        const sl = currentBar.low - atrVal! * params.slAtrMultiplier;
        const riskDist = currentBar.close - sl;
        if (riskDist > 0) {
          const tp = currentBar.close + riskDist * params.rrTarget;
          activePos = openTrade(
            i,
            'BUY',
            sl,
            tp,
            riskDist,
            `CHOCH - Bear Structure Failed (Close > ${bearTop!.toFixed(digits)})`,
            `BULL CHOCH Reversal | SL ${params.slAtrMultiplier}x ATR | ${params.rrTarget}R`
          );
        }
      }
    } else if (longEntry) {
      const sl = bullBottom! - atrVal! * params.slAtrMultiplier;
      const riskDist = currentBar.close - sl;
      if (riskDist > 0) {
        const tp = currentBar.close + riskDist * params.rrTarget;
        activePos = openTrade(
          i,
          'BUY',
          sl,
          tp,
          riskDist,
          `Bullish Fib 0.60-0.70 Retest [${bullBottom!.toFixed(digits)} - ${bullTop!.toFixed(digits)}]`,
          `H4 Fib Zone Entry | SL ${params.slAtrMultiplier}x ATR | ${params.rrTarget}R`
        );
      }
    } else if (shortEntry) {
      const sl = bearTop! + atrVal! * params.slAtrMultiplier;
      const riskDist = sl - currentBar.close;
      if (riskDist > 0) {
        const tp = currentBar.close - riskDist * params.rrTarget;
        activePos = openTrade(
          i,
          'SELL',
          sl,
          tp,
          riskDist,
          `Bearish Fib 0.60-0.70 Retest [${bearBottom!.toFixed(digits)} - ${bearTop!.toFixed(digits)}]`,
          `H4 Fib Zone Entry | SL ${params.slAtrMultiplier}x ATR | ${params.rrTarget}R`
        );
      }
    }

    // Record chart overlay snapshot for bar i (reflecting post-signal state, matching Pine plots)
    const showBull = trend === 1 && zoneActive;
    const showBear = trend === -1 && zoneActive;

    barSeries.push({
      time: currentBar.time,
      trend,
      zoneActive,
      bullTop: showBull ? bullTop : null,
      bullBottom: showBull ? bullBottom : null,
      bearBottom: showBear ? bearBottom : null,
      bearTop: showBear ? bearTop : null,
      lastHigh,
      lastLow,
    });

    if (showBull && bullTop !== null && bullBottom !== null && impulseHigh !== null && impulseLow !== null) {
      fibZoneSegments.push({
        startTime: currentBar.time,
        endTime: i + 1 < h4Candles.length ? h4Candles[i + 1].time : currentBar.time + 14400,
        direction: 'BULL',
        top: bullTop,
        bottom: bullBottom,
        impulseHigh,
        impulseLow,
      });
    } else if (showBear && bearBottom !== null && bearTop !== null && impulseHigh !== null && impulseLow !== null) {
      fibZoneSegments.push({
        startTime: currentBar.time,
        endTime: i + 1 < h4Candles.length ? h4Candles[i + 1].time : currentBar.time + 14400,
        direction: 'BEAR',
        top: bearTop,
        bottom: bearBottom,
        impulseHigh,
        impulseLow,
      });
    }
  }

  // Handle still-open trade at the end of the dataset
  if (activePos) {
    const lastBar = h4Candles[h4Candles.length - 1];
    const rawDiff =
      activePos.direction === 'BUY'
        ? lastBar.close - activePos.entryPrice
        : activePos.entryPrice - lastBar.close;
    const unrealizedCurrency = Number((activePos.qty * rawDiff).toFixed(2));
    const unrealizedPips = Number((rawDiff / pipSize).toFixed(1));
    const unrealizedR =
      activePos.riskAmt > 0 ? Number((unrealizedCurrency / activePos.riskAmt).toFixed(2)) : 0;

    trades.push({
      id: activePos.id,
      index: activePos.index,
      symbol,
      timeframe: '4h' as Timeframe,
      direction: activePos.direction,
      signalTime: activePos.signalTime,
      signalIndex: activePos.signalIndex,
      entryTime: activePos.entryTime,
      entryPrice: activePos.entryPrice,
      entryIndex: activePos.entryIndex,
      exitTime: lastBar.time,
      exitPrice: lastBar.close,
      exitIndex: h4Candles.length - 1,
      stopLoss: activePos.stopLoss,
      takeProfit: activePos.takeProfit,
      initialRiskPips: Math.max(0.1, Number((activePos.riskDist / pipSize).toFixed(1))),
      status: 'UNRESOLVED',
      exitReason: 'OPEN',
      pnlPips: unrealizedPips,
      pnlCurrency: unrealizedCurrency,
      pnlR: unrealizedR,
      holdingBars: Math.max(0, h4Candles.length - 1 - activePos.entryIndex),
      riskAmount: Number(activePos.riskAmt.toFixed(2)),
      signalReason: activePos.signalReason,
      h1Bias: activePos.h1Bias,
      m15Confirmation: activePos.m15Confirmation,
      riskRewardRatio: params.rrTarget,
    });
  }

  const smcOverlay: SmcFibChartOverlay = {
    structureEvents,
    fibZoneSegments,
    barSeries,
  };

  return compileSmcBacktestResults(
    trades,
    initialCapital,
    params,
    cryptoAsset,
    smcOverlay,
    dataSourceDescription
  );
}

function compileSmcBacktestResults(
  trades: Trade[],
  startingBalance: number,
  params: SmcFibParameters,
  isCrypto: boolean,
  smcOverlay: SmcFibChartOverlay,
  dataSourceDescription?: string
): BacktestResult {
  const resolvedTrades = trades.filter((t) => t.status !== 'OPEN' && t.status !== 'UNRESOLVED');
  const unresolvedTrades = trades.filter((t) => t.status === 'OPEN' || t.status === 'UNRESOLVED').length;
  const totalResolved = resolvedTrades.length;

  let winningTrades = 0;
  let losingTrades = 0;
  let breakevenTrades = 0;
  let grossProfitR = 0;
  let grossLossR = 0;
  let netR = 0;
  let totalPnlCurrency = 0;

  let longCount = 0;
  let longWins = 0;
  let shortCount = 0;
  let shortWins = 0;

  let maxConsecWins = 0;
  let currentConsecWins = 0;
  let maxConsecLosses = 0;
  let currentConsecLosses = 0;

  let currentEquity = startingBalance;
  let peakEquity = startingBalance;
  let peakCumulativeR = 0;
  let maxDrawdownR = 0;
  let maxDrawdownPercent = 0;

  const equityCurve: EquityPoint[] = [
    {
      time: trades[0]?.entryTime || 1730505600,
      tradeIndex: 0,
      equity: startingBalance,
      cumulativeR: 0,
      drawdownPercent: 0,
      drawdownR: 0,
    },
  ];

  for (let i = 0; i < resolvedTrades.length; i++) {
    const t = resolvedTrades[i];
    netR += t.pnlR;
    totalPnlCurrency += t.pnlCurrency;
    currentEquity += t.pnlCurrency;

    if (t.status === 'WIN') {
      winningTrades++;
      grossProfitR += t.pnlR;
      currentConsecWins++;
      currentConsecLosses = 0;
      if (currentConsecWins > maxConsecWins) maxConsecWins = currentConsecWins;
    } else if (t.status === 'LOSS') {
      losingTrades++;
      grossLossR += Math.abs(t.pnlR);
      currentConsecLosses++;
      currentConsecWins = 0;
      if (currentConsecLosses > maxConsecLosses) maxConsecLosses = currentConsecLosses;
    } else {
      breakevenTrades++;
      currentConsecWins = 0;
      currentConsecLosses = 0;
    }

    const isLong = t.direction === 'LONG' || t.direction === 'BUY';
    if (isLong) {
      longCount++;
      if (t.status === 'WIN') longWins++;
    } else {
      shortCount++;
      if (t.status === 'WIN') shortWins++;
    }

    if (currentEquity > peakEquity) peakEquity = currentEquity;
    if (netR > peakCumulativeR) peakCumulativeR = netR;

    const currentDrawdownR = peakCumulativeR - netR;
    if (currentDrawdownR > maxDrawdownR) maxDrawdownR = currentDrawdownR;

    const currentDrawdownPct = peakEquity > 0 ? ((peakEquity - currentEquity) / peakEquity) * 100 : 0;
    if (currentDrawdownPct > maxDrawdownPercent) maxDrawdownPercent = currentDrawdownPct;

    equityCurve.push({
      time: t.exitTime || t.entryTime,
      tradeIndex: i + 1,
      equity: Number(currentEquity.toFixed(2)),
      cumulativeR: Number(netR.toFixed(2)),
      drawdownPercent: Number(currentDrawdownPct.toFixed(2)),
      drawdownR: Number(currentDrawdownR.toFixed(2)),
    });
  }

  const winRate = totalResolved > 0 ? Number(((winningTrades / totalResolved) * 100).toFixed(1)) : 0;
  const profitFactor =
    grossLossR > 0 ? Number((grossProfitR / grossLossR).toFixed(2)) : grossProfitR > 0 ? 99.9 : 0;
  const avgWinR = winningTrades > 0 ? Number((grossProfitR / winningTrades).toFixed(2)) : 0;
  const avgLossR = losingTrades > 0 ? Number((grossLossR / losingTrades).toFixed(2)) : 0;
  const winProb = totalResolved > 0 ? winningTrades / totalResolved : 0;
  const lossProb = totalResolved > 0 ? losingTrades / totalResolved : 0;
  const expectancyR = Number((winProb * avgWinR - lossProb * avgLossR).toFixed(2));
  const longWinRate = longCount > 0 ? Number(((longWins / longCount) * 100).toFixed(1)) : 0;
  const shortWinRate = shortCount > 0 ? Number(((shortWins / shortCount) * 100).toFixed(1)) : 0;

  // Monthly breakdown
  const monthMap = new Map<
    string,
    { tradesCount: number; winningTrades: number; losingTrades: number; netR: number; pnlCurrency: number }
  >();

  for (const t of resolvedTrades) {
    const d = new Date(t.entryTime * 1000);
    const monthKey = `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
    if (!monthMap.has(monthKey)) {
      monthMap.set(monthKey, { tradesCount: 0, winningTrades: 0, losingTrades: 0, netR: 0, pnlCurrency: 0 });
    }
    const m = monthMap.get(monthKey)!;
    m.tradesCount++;
    if (t.status === 'WIN') m.winningTrades++;
    if (t.status === 'LOSS') m.losingTrades++;
    m.netR += t.pnlR;
    m.pnlCurrency += t.pnlCurrency;
  }

  const MONTH_NAMES = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
  const monthlyPerformance: MonthlyPerformance[] = Array.from(monthMap.entries())
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([monthKey, data]) => {
      const [year, monthNum] = monthKey.split('-');
      return {
        monthKey,
        label: `${MONTH_NAMES[parseInt(monthNum, 10) - 1]} ${year}`,
        tradesCount: data.tradesCount,
        winningTrades: data.winningTrades,
        losingTrades: data.losingTrades,
        winRate: data.tradesCount > 0 ? Number(((data.winningTrades / data.tradesCount) * 100).toFixed(1)) : 0,
        netR: Number(data.netR.toFixed(2)),
        profitCurrency: Number(data.pnlCurrency.toFixed(2)),
      };
    });

  return {
    trades,
    totalTrades: totalResolved,
    winningTrades,
    losingTrades,
    breakevenTrades,
    unresolvedTrades,
    winRate,
    profitFactor,
    netR: Number(netR.toFixed(2)),
    grossSimulatedR: Number(grossProfitR.toFixed(2)),
    isGrossSimulated: true,
    totalPnlCurrency: Number(totalPnlCurrency.toFixed(2)),
    maxDrawdownR: Number(maxDrawdownR.toFixed(2)),
    maxDrawdownPercent: Number(maxDrawdownPercent.toFixed(2)),
    maxConsecutiveWins: maxConsecWins,
    maxConsecutiveLosses: maxConsecLosses,
    avgWinR,
    avgLossR,
    expectancyR,
    longTradesCount: longCount,
    longWinRate,
    shortTradesCount: shortCount,
    shortWinRate,
    equityCurve,
    monthlyPerformance,
    costModel: { spreadPips: 0, commissionPerLot: 0, slippagePips: 0 },
    assumptions: [
      dataSourceDescription ? `Data Source: ${dataSourceDescription}.` : 'Data Source: H4 Candle Feed.',
      `Strategy: SMC_FIB_4H_V1 (Swing=${params.swingLength}, Fib=${params.fibStart}-${params.fibEnd}, ATR=${params.atrLength} SMA, SL=${params.slAtrMultiplier}x ATR, Risk=${params.riskPercent}%, TP=${params.rrTarget}R).`,
      `Position Sizing: ${isCrypto ? 'Crypto (rounded to 4 decimals)' : 'Equity/ETF (integer floor)'} on $${startingBalance.toLocaleString()} compounding equity.`,
      `Execution Timing: ${params.executionTiming === 'close' ? 'Bar Close (TradingView Pine v6 process_orders_on_close=true)' : 'Next 4H Bar Open (QuantConnect MarketOrder parity)'}.`,
      'CHOCH Reversal: Failing Fib zone bottom/top liquidates active position and opens counter-trend reversal.',
      'Conservative Tie-Breaker: Same-bar SL & TP touch resolves strictly to STOP LOSS.',
    ],
    smcOverlay,
  };
}

function createEmptySmcResult(startingBalance: number, dataSourceDescription?: string): BacktestResult {
  return {
    trades: [],
    totalTrades: 0,
    winningTrades: 0,
    losingTrades: 0,
    breakevenTrades: 0,
    unresolvedTrades: 0,
    winRate: 0,
    profitFactor: 0,
    netR: 0,
    grossSimulatedR: 0,
    isGrossSimulated: true,
    totalPnlCurrency: 0,
    maxDrawdownR: 0,
    maxDrawdownPercent: 0,
    maxConsecutiveWins: 0,
    maxConsecutiveLosses: 0,
    avgWinR: 0,
    avgLossR: 0,
    expectancyR: 0,
    longTradesCount: 0,
    longWinRate: 0,
    shortTradesCount: 0,
    shortWinRate: 0,
    equityCurve: [
      {
        time: 1730505600,
        tradeIndex: 0,
        equity: startingBalance,
        cumulativeR: 0,
        drawdownPercent: 0,
        drawdownR: 0,
      },
    ],
    monthlyPerformance: [],
    costModel: { spreadPips: 0, commissionPerLot: 0, slippagePips: 0 },
    assumptions: [
      dataSourceDescription ? `Data Source: ${dataSourceDescription}.` : 'Data Source: H4 Candle Feed.',
      'Insufficient H4 bars for SMC_FIB_4H_V1 warmup (minimum 22 bars required).',
    ],
  };
}
