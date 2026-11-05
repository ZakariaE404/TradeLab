import { Candle, ForexSymbol } from '@/types/trading';
import { ConfirmedSwingPoint } from '@/types/strategyA';
import {
  SignalEvaluationContext,
  SignalGenerator,
  TradingSignal,
} from '@/types/simulation';

/**
 * Validates that a signal produced by any SignalGenerator satisfies structural integrity:
 * - Direction is BUY or SELL
 * - Confirmation close is a valid finite positive number
 * - Proposed SL and TP are specified and valid
 * - Signal timestamp matches candle timestamp
 */
export function validateSignal(signal: TradingSignal, currentCandle: Candle): { isValid: boolean; error?: string } {
  if (!signal) return { isValid: false, error: 'Signal object is null or undefined.' };
  if (signal.direction !== 'BUY' && signal.direction !== 'SELL') {
    return { isValid: false, error: `Invalid signal direction: ${signal.direction}` };
  }
  if (signal.signalTime !== currentCandle.time) {
    return {
      isValid: false,
      error: `Signal timestamp mismatch: signal has ${signal.signalTime}, candle has ${currentCandle.time}`,
    };
  }
  if (!Number.isFinite(signal.confirmationCandleClose) || signal.confirmationCandleClose <= 0) {
    return { isValid: false, error: `Invalid confirmation candle close: ${signal.confirmationCandleClose}` };
  }
  if (!signal.proposedStopLoss || !signal.proposedStopLoss.method) {
    return { isValid: false, error: 'Signal is missing proposed stop loss configuration.' };
  }
  if (!signal.proposedTakeProfit || !signal.proposedTakeProfit.method) {
    return { isValid: false, error: 'Signal is missing proposed take profit configuration.' };
  }

  return { isValid: true };
}

/**
 * Factory to build a zero-lookahead SignalEvaluationContext for bar index `i`.
 * Guaranteed to only expose history up to bar `i`.
 */
export function buildSignalEvaluationContext(params: {
  m15Candles: Candle[];
  currentIndex: number;
  completedH1Candle: Candle | null;
  completedH1Index: number;
  m15Indicators: { ema50?: number | null; ema200?: number | null; atr14?: number | null };
  h1Indicators: { ema50?: number | null; ema200?: number | null; atr14?: number | null };
  confirmedSwings: ConfirmedSwingPoint[];
  symbol: ForexSymbol;
}): SignalEvaluationContext {
  const {
    m15Candles,
    currentIndex,
    completedH1Candle,
    completedH1Index,
    m15Indicators,
    h1Indicators,
    confirmedSwings,
    symbol,
  } = params;

  return {
    m15Candles,
    currentIndex,
    currentCandle: m15Candles[currentIndex],
    completedH1Candle,
    completedH1Index,
    m15Indicators,
    h1Indicators,
    // Only pass swings confirmed at or before currentIndex
    confirmedSwings: confirmedSwings.filter((s) => s.confirmedAtIndex <= currentIndex),
    symbol,
  };
}

/**
 * Test & Reference Signal Generator for deterministic backtest testing.
 * Triggers signals based on explicit bar indices and configurations.
 */
export class DeterministicTestSignalGenerator implements SignalGenerator {
  public readonly id = 'deterministic_test_signal_generator';
  public readonly name = 'Deterministic Test Signal Generator';

  private plannedSignals: Map<number, Partial<TradingSignal>>;

  constructor(plannedSignals: Array<{ barIndex: number; signal: Partial<TradingSignal> }>) {
    this.plannedSignals = new Map();
    for (const p of plannedSignals) {
      this.plannedSignals.set(p.barIndex, p.signal);
    }
  }

  generateSignal(context: SignalEvaluationContext): TradingSignal | null {
    const planned = this.plannedSignals.get(context.currentIndex);
    if (!planned) return null;

    const direction = planned.direction || 'BUY';
    const currentPrice = context.currentCandle.close;

    const signal: TradingSignal = {
      id: `test_sig_${context.currentIndex}`,
      direction,
      signalTime: context.currentCandle.time,
      signalCandleIndex: context.currentIndex,
      confirmationCandleClose: currentPrice,
      proposedStopLoss: planned.proposedStopLoss || {
        method: 'ATR',
        atrMultiplier: 1.5,
      },
      proposedTakeProfit: planned.proposedTakeProfit || {
        method: 'RR',
        riskRewardRatio: 2.0,
      },
      signalType: planned.signalType || 'TEST_DETERMINISTIC_SIGNAL',
      marketRegime: planned.marketRegime || 'NORMAL',
      metadata: planned.metadata,
      indicatorsAtSignal: {
        ema50: context.m15Indicators.ema50,
        ema200: context.m15Indicators.ema200,
        atr14: context.m15Indicators.atr14,
        h1Ema50: context.h1Indicators.ema50,
        h1Ema200: context.h1Indicators.ema200,
      },
    };

    return signal;
  }
}
