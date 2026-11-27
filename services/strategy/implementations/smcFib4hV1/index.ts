import { StrategyDefinition } from '../../core/StrategyDefinition';
import { MultiTimeframeMarketContext, StrategyBarContext } from '../../core/StrategyContext';
import { StrategySignal } from '../../core/StrategyTypes';
import {
  SMC_FIB_4H_V1_DEFAULTS,
  SMC_FIB_4H_V1_SCHEMA,
  SmcFibParameters,
} from './config';
import { calculateSmaAtr } from './logic';

export const SmcFib4hV1: StrategyDefinition<SmcFibParameters> = {
  id: 'smc_fib_4h_v1',
  name: 'SMC_FIB_4H_V1: 4H Market Structure + Fib 0.60-0.70',
  version: '1.0.0',
  description:
    '4H Smart Money Concepts Fibonacci engine: swing length 10 BOS/CHOCH, dynamic impulse tracking, 0.60-0.70 Fib retracement zone, SMA ATR(14) 2x SL, 0.5% risk, 15R target.',
  primaryTimeframe: '4h',
  requiredTimeframes: ['4h'],
  timeframeDescription: 'H4 Structure + Fib Zone',
  tags: ['smc', 'fibonacci', 'bos', 'choch', 'h4', 'swing'],
  status: 'active',
  statusMessage: 'SMC Fib Engine (4H) integrated from QuantConnect & Pine Script v6 references.',
  parameterSchema: SMC_FIB_4H_V1_SCHEMA,
  defaultParameters: SMC_FIB_4H_V1_DEFAULTS,

  init(marketContext: MultiTimeframeMarketContext<SmcFibParameters>, parameters?: SmcFibParameters) {
    const params = parameters || SMC_FIB_4H_V1_DEFAULTS;
    const h4Candles = marketContext.candlesByTimeframe.get('4h') || [];
    if (h4Candles.length > 0) {
      const atrSeq = calculateSmaAtr(h4Candles, params.atrLength || 14);
      const atrMap = new Map<number, number>();
      for (let i = 0; i < h4Candles.length; i++) {
        if (atrSeq[i] !== null) {
          atrMap.set(h4Candles[i].time, atrSeq[i]!);
        }
      }
      marketContext.registerIndicatorMap('atr_sma', '4h', atrMap);
    }
  },

  evaluateBar(_context: StrategyBarContext<SmcFibParameters>): StrategySignal | null {
    // Full stateful CHOCH liquidation + reversal + Fib overlay simulation executes via runSmcFibBacktest.
    return null;
  },
};

export {
  SMC_FIB_4H_V1_DEFAULTS,
  SMC_FIB_4H_V1_SCHEMA,
  type SmcFibParameters,
  type SmcFibExecutionTiming,
} from './config';
export {
  calculateSmaAtr,
  calculateSmcFibQuantity,
  isCryptoSymbol,
  runSmcFibBacktest,
} from './logic';
