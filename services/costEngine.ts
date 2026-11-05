import { ForexSymbol } from '@/types/trading';
import { ExecutionCostConfig, InstrumentCostModel } from '@/types/simulation';
import { FOREX_SYMBOLS } from './marketData';

export const SIMULATION_ASSUMPTIONS = [
  'A1: Next-Candle Open Execution — Signals confirmed on bar i close are executed strictly at bar i+1 open. The confirmation close is never used as fill price.',
  'A2: Mid-Price Quote & Symmetric Spread Model — Candle data represents mid-market quotes. For BUY, entry is filled at Mid + (Spread/2) + Slippage, and exit at Mid - (Spread/2) - Slippage. For SELL, entry is filled at Mid - (Spread/2) - Slippage, and exit at Mid + (Spread/2) + Slippage. Total round-turn spread paid equals exactly 1.0x Spread, avoiding double counting.',
  'A3: Intrabar Simultaneous SL/TP Touch — If a single candle touches both Stop Loss and Take Profit levels, the trade is conservatively evaluated as STOP LOSS first, eliminating optimistic intrabar bias.',
  'A4: Strict Zero-Lookahead Multi-Timeframe — M15 bars only access H1 bars that were strictly completed and closed at or before the M15 evaluation timestamp.',
  'A5: Position Exclusivity — Exactly one open position allowed per experiment. Duplicate signals while in a position are logged and discarded.',
  'A6: Final-Bar Unexecuted Signals — If a signal is generated on the very last bar of the dataset, it is not executed because no subsequent candle exists for opening execution.',
  'A7: Warm-up Validation — Datasets with < 1000 H1 bars (down to 300 min) are flagged with REDUCED_CONFIDENCE in diagnostics because EMA 200 mathematical convergence requires ~1000 bars.',
];

/**
 * Resolves instrument specifications: pip size, contract size, digits, and known status.
 * If reliable metadata is missing, returns safe defaults and explicitly flags isKnownInstrument: false.
 */
export function getInstrumentCostModel(symbol: ForexSymbol): InstrumentCostModel {
  const meta = FOREX_SYMBOLS[symbol];
  if (meta) {
    // Gold contract size is standard 100 troy ounces
    const isGold = symbol === 'XAUUSDm' || symbol === 'XAU/USD';
    const contractSize = isGold ? 100 : 100000;

    return {
      symbol,
      name: meta.name,
      pipSize: meta.pipSize,
      pipMultiplier: meta.pipMultiplier,
      contractSize,
      digits: meta.digits,
      isKnownInstrument: true,
    };
  }

  // Fallback for custom or unknown instruments
  return {
    symbol,
    name: String(symbol),
    pipSize: 0.0001,
    pipMultiplier: 10000,
    contractSize: 100000,
    digits: 5,
    isKnownInstrument: false,
  };
}

export interface EntryFillResult {
  executionPrice: number;
  halfSpreadPrice: number;
  slippagePrice: number;
  entrySpreadCost: number;
  entrySlippageCost: number;
}

/**
 * Calculates realistic entry execution fill price.
 * BUY fills at Ask = Open + halfSpread + slippage.
 * SELL fills at Bid = Open - halfSpread - slippage.
 */
export function calculateEntryFill(
  direction: 'BUY' | 'SELL',
  nextCandleOpen: number,
  costs: ExecutionCostConfig,
  instrument: InstrumentCostModel
): EntryFillResult {
  const halfSpreadPrice = (costs.spreadPips * instrument.pipSize) / 2;
  const slippagePrice = costs.slippagePips * instrument.pipSize;

  let executionPrice: number;
  if (direction === 'BUY') {
    executionPrice = Number((nextCandleOpen + halfSpreadPrice + slippagePrice).toFixed(instrument.digits));
  } else {
    executionPrice = Number((nextCandleOpen - halfSpreadPrice - slippagePrice).toFixed(instrument.digits));
  }

  return {
    executionPrice,
    halfSpreadPrice,
    slippagePrice,
    entrySpreadCost: halfSpreadPrice,
    entrySlippageCost: slippagePrice,
  };
}

export interface ExitFillResult {
  executionPrice: number;
  halfSpreadPrice: number;
  slippagePrice: number;
}

/**
 * Calculates realistic exit execution fill price at a target level (SL or TP).
 * BUY exits by Selling at Bid = Target - halfSpread - slippage.
 * SELL exits by Buying at Ask = Target + halfSpread + slippage.
 */
export function calculateExitFill(
  direction: 'BUY' | 'SELL',
  targetPrice: number,
  costs: ExecutionCostConfig,
  instrument: InstrumentCostModel
): ExitFillResult {
  const halfSpreadPrice = (costs.spreadPips * instrument.pipSize) / 2;
  const slippagePrice = costs.slippagePips * instrument.pipSize;

  let executionPrice: number;
  if (direction === 'BUY') {
    executionPrice = Number((targetPrice - halfSpreadPrice - slippagePrice).toFixed(instrument.digits));
  } else {
    executionPrice = Number((targetPrice + halfSpreadPrice + slippagePrice).toFixed(instrument.digits));
  }

  return {
    executionPrice,
    halfSpreadPrice,
    slippagePrice,
  };
}

/**
 * Calculates total currency costs for a completed trade.
 */
export function calculateTradeExecutionCosts(
  positionUnits: number,
  positionLots: number,
  costs: ExecutionCostConfig,
  instrument: InstrumentCostModel
): {
  spreadCost: number;
  slippageCost: number;
  commissionCost: number;
  totalExecutionCosts: number;
} {
  const fullSpreadPrice = costs.spreadPips * instrument.pipSize;
  const roundTripSlippagePrice = 2 * (costs.slippagePips * instrument.pipSize);

  const spreadCost = Number((fullSpreadPrice * positionUnits).toFixed(2));
  const slippageCost = Number((roundTripSlippagePrice * positionUnits).toFixed(2));
  const commissionCost = Number((costs.commissionPerLot * positionLots).toFixed(2));
  const totalExecutionCosts = Number((spreadCost + slippageCost + commissionCost).toFixed(2));

  return {
    spreadCost,
    slippageCost,
    commissionCost,
    totalExecutionCosts,
  };
}
