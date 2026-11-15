import { Candle } from '@/types/trading';
import { ConfirmedSwingPoint, StructureType } from '@/types/strategyA';
import {
  detectConfirmedSwings,
  evaluateMarketStructure,
  evaluateRejectionCandle,
  evaluateSupportResistanceZone,
  evaluateH1Trend,
} from '@/services/strategyA';

export {
  detectConfirmedSwings,
  evaluateMarketStructure,
  evaluateRejectionCandle,
  evaluateSupportResistanceZone,
  evaluateH1Trend,
};
