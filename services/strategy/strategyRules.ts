import { Candle } from '@/types/trading';
import {
  ProposedStopLoss,
  ProposedTakeProfit,
  SignalEvaluationContext,
  SignalGenerator,
  TradingSignal,
} from '@/types/simulation';
import {
  CandleDiagnosticSnapshot,
  DEFAULT_STRATEGY_CONFIG,
  PriceZone,
  RejectionReasonCode,
  StrategyConfiguration,
} from './types';
import { analyzeH1Trend } from './trendAnalysis';
import { classifyMarketRegime } from './marketRegime';
import { doesCandleInteractWithResistance, doesCandleInteractWithSupport, getActivePriceZones } from './supportResistance';
import { evaluateCandlePattern } from './candlePatterns';
import { getInstrumentCostModel } from '../costEngine';

/**
 * TradeLab Strategy Implementation.
 * Implements SignalGenerator compatible with Phase 2 backtesting & simulation engine.
 * Fully supports TRENDING and RANGING regimes, REJECTION and ENGULFING patterns,
 * SWING and ATR stop-losses, and RR and Support/Resistance take-profits.
 */
export class TradeLabStrategyEngine implements SignalGenerator {
  public readonly id: string;
  public readonly name: string;
  public readonly config: StrategyConfiguration;

  // Stores diagnostic snapshots for every evaluated candle index
  public readonly diagnosticsMap = new Map<number, CandleDiagnosticSnapshot>();

  constructor(config: Partial<StrategyConfiguration> = {}, id?: string, name?: string) {
    this.config = { ...DEFAULT_STRATEGY_CONFIG, ...config };
    this.id = id || this.config.id || 'tradelab_strategy_engine';
    this.name = name || this.config.name || 'TradeLab Multi-Regime Strategy';
  }

  public generateSignal(context: SignalEvaluationContext): TradingSignal | null {
    const {
      m15Candles,
      currentIndex,
      currentCandle,
      completedH1Candle,
      completedH1Index,
      m15Indicators,
      confirmedSwings,
      symbol,
    } = context;

    const instrument = getInstrumentCostModel(symbol);
    const prevCandle = currentIndex > 0 ? m15Candles[currentIndex - 1] : null;

    // 1. H1 Trend Analysis
    const h1Candles = context.h1Candles || (completedH1Candle ? [completedH1Candle] : []);
    const h1Ema50Map = context.h1Ema50Map || new Map<number, number>();
    const h1Ema200Map = context.h1Ema200Map || new Map<number, number>();
    if (completedH1Candle && !h1Ema50Map.has(completedH1Candle.time) && context.h1Indicators.ema50 !== null && context.h1Indicators.ema50 !== undefined) {
      h1Ema50Map.set(completedH1Candle.time, context.h1Indicators.ema50);
    }
    if (completedH1Candle && !h1Ema200Map.has(completedH1Candle.time) && context.h1Indicators.ema200 !== null && context.h1Indicators.ema200 !== undefined) {
      h1Ema200Map.set(completedH1Candle.time, context.h1Indicators.ema200);
    }

    const completedH1Idx = context.completedH1Index >= 0 ? context.completedH1Index : Math.max(0, h1Candles.length - 1);
    const trendAnalysis = analyzeH1Trend({
      h1Candles,
      completedH1Index: completedH1Idx,
      h1Ema50Map,
      h1Ema200Map,
      config: this.config,
    });

    // 2. S/R Zones Detection
    const { supportZones, resistanceZones } = getActivePriceZones({
      allSwings: confirmedSwings,
      currentCandleIndex: currentIndex,
      currentPrice: currentCandle.close,
      config: this.config,
      pipSize: instrument.pipSize,
    });

    // 3. ADX & Market Regime
    const h1Adx =
      (completedH1Candle && context.h1Adx14Map?.get(completedH1Candle.time)) ??
      context.h1Indicators.atr14 ??
      28.0;
    const marketRegime = classifyMarketRegime({
      trendAnalysis,
      h1Adx14: h1Adx,
      hasValidSrStructure: supportZones.length > 0 || resistanceZones.length > 0,
      config: this.config,
    });

    // 4. M15 Candlestick Pattern Evaluation
    const candlePattern = evaluateCandlePattern({
      currentCandle,
      prevCandle,
      supportZones,
      resistanceZones,
      config: this.config,
      pipSize: instrument.pipSize,
    });

    // Diagnostic base record
    let signalGenerated = false;
    let rejectionReason: RejectionReasonCode = 'NONE';
    let rejectionMessage: string | undefined;

    const recordDiagnostic = (reason: RejectionReasonCode, msg?: string) => {
      rejectionReason = reason;
      rejectionMessage = msg;
      this.diagnosticsMap.set(currentIndex, {
        time: currentCandle.time,
        index: currentIndex,
        h1Trend: trendAnalysis,
        regime: marketRegime,
        supportZoneFound: supportZones.length > 0,
        resistanceZoneFound: resistanceZones.length > 0,
        priceInteractedWithZone:
          candlePattern.isBullishRejection ||
          candlePattern.isBearishRejection ||
          candlePattern.isBullishEngulfing ||
          candlePattern.isBearishEngulfing,
        pattern: candlePattern,
        m15EmaFilterSatisfied: true,
        signalGenerated,
        rejectionReason,
        rejectionMessage,
      });
    };

    // 5. Regime Check
    const activeRegime = marketRegime.regime;
    if (this.config.regime === 'TRENDING' && activeRegime !== 'TRENDING') {
      recordDiagnostic('ERR_REGIME_MISMATCH', `Strategy configured for TRENDING only, but market is ${activeRegime}.`);
      return null;
    }
    if (this.config.regime === 'RANGING' && activeRegime !== 'RANGING') {
      recordDiagnostic('ERR_REGIME_MISMATCH', `Strategy configured for RANGING only, but market is ${activeRegime}.`);
      return null;
    }

    // 6. Directional Rules Evaluation (BUY vs SELL)
    const allowBuy = this.config.direction === 'BUY' || this.config.direction === 'BOTH';
    const allowSell = this.config.direction === 'SELL' || this.config.direction === 'BOTH';

    const allowRejection = this.config.pattern === 'REJECTION' || this.config.pattern === 'BOTH';
    const allowEngulfing = this.config.pattern === 'ENGULFING' || this.config.pattern === 'BOTH';

    // BUY Candidate Check
    let buySignalCandidate = false;
    let buyPatternType: string | null = null;
    let relevantSupportZone: PriceZone | null = null;

    if (allowBuy) {
      const hasBullishPattern =
        (allowRejection && candlePattern.isBullishRejection) ||
        (allowEngulfing && candlePattern.isBullishEngulfing);

      if (hasBullishPattern) {
        buyPatternType = candlePattern.isBullishRejection ? 'REJECTION' : 'ENGULFING';

        // Find interacting support zone
        const tolerancePrice = (this.config.zoneTolerancePips || 3.0) * instrument.pipSize;
        relevantSupportZone =
          supportZones.find((z) => doesCandleInteractWithSupport(currentCandle, z, tolerancePrice)) || null;

        if (!relevantSupportZone) {
          recordDiagnostic('ERR_NO_ZONE_INTERACTION', 'Bullish pattern found but no valid confirmed support zone interaction.');
        } else {
          // Check regime-specific rules
          if (activeRegime === 'TRENDING') {
            if (trendAnalysis.bias !== 'BULLISH') {
              recordDiagnostic('ERR_H1_TREND_MISMATCH', `Trending BUY requires BULLISH H1 trend, but trend is ${trendAnalysis.bias}.`);
            } else {
              // M15 EMA filter check
              const m15Ema50 = m15Indicators.ema50;
              const m15Ema200 = m15Indicators.ema200;
              let m15EmaValid = true;

              if (this.config.requireM15EmaFilter && m15Ema50 !== null && m15Ema50 !== undefined) {
                const emaTolerance = (this.config.m15EmaTolerancePips || 2.0) * instrument.pipSize;
                const priceNearOrAboveEma = currentCandle.close >= m15Ema50 - emaTolerance;
                const emaOrderValid = m15Ema200 !== null && m15Ema200 !== undefined ? m15Ema50 >= m15Ema200 : true;
                m15EmaValid = priceNearOrAboveEma && emaOrderValid;
              }

              if (!m15EmaValid) {
                recordDiagnostic('ERR_M15_EMA_FILTER', 'M15 EMA filter not satisfied for bullish entry.');
              } else {
                buySignalCandidate = true;
              }
            }
          } else if (activeRegime === 'RANGING') {
            // Ranging BUY: confirmed support interaction + pattern
            buySignalCandidate = true;
          }
        }
      }
    }

    // SELL Candidate Check
    let sellSignalCandidate = false;
    let sellPatternType: string | null = null;
    let relevantResistanceZone: PriceZone | null = null;

    if (allowSell && !buySignalCandidate) {
      const hasBearishPattern =
        (allowRejection && candlePattern.isBearishRejection) ||
        (allowEngulfing && candlePattern.isBearishEngulfing);

      if (hasBearishPattern) {
        sellPatternType = candlePattern.isBearishRejection ? 'REJECTION' : 'ENGULFING';

        const tolerancePrice = (this.config.zoneTolerancePips || 3.0) * instrument.pipSize;
        relevantResistanceZone =
          resistanceZones.find((z) => doesCandleInteractWithResistance(currentCandle, z, tolerancePrice)) || null;

        if (!relevantResistanceZone) {
          recordDiagnostic('ERR_NO_ZONE_INTERACTION', 'Bearish pattern found but no valid confirmed resistance zone interaction.');
        } else {
          if (activeRegime === 'TRENDING') {
            if (trendAnalysis.bias !== 'BEARISH') {
              recordDiagnostic('ERR_H1_TREND_MISMATCH', `Trending SELL requires BEARISH H1 trend, but trend is ${trendAnalysis.bias}.`);
            } else {
              const m15Ema50 = m15Indicators.ema50;
              const m15Ema200 = m15Indicators.ema200;
              let m15EmaValid = true;

              if (this.config.requireM15EmaFilter && m15Ema50 !== null && m15Ema50 !== undefined) {
                const emaTolerance = (this.config.m15EmaTolerancePips || 2.0) * instrument.pipSize;
                const priceNearOrBelowEma = currentCandle.close <= m15Ema50 + emaTolerance;
                const emaOrderValid = m15Ema200 !== null && m15Ema200 !== undefined ? m15Ema50 <= m15Ema200 : true;
                m15EmaValid = priceNearOrBelowEma && emaOrderValid;
              }

              if (!m15EmaValid) {
                recordDiagnostic('ERR_M15_EMA_FILTER', 'M15 EMA filter not satisfied for bearish entry.');
              } else {
                sellSignalCandidate = true;
              }
            }
          } else if (activeRegime === 'RANGING') {
            sellSignalCandidate = true;
          }
        }
      }
    }

    if (!buySignalCandidate && !sellSignalCandidate) {
      if (rejectionReason === 'NONE') {
        recordDiagnostic('ERR_NO_CANDLE_PATTERN', 'No matching candlestick pattern on this bar.');
      }
      return null;
    }

    // 7. Proposed Stop Loss & Take Profit Assembly
    const direction = buySignalCandidate ? 'BUY' : 'SELL';
    const patternType = buySignalCandidate ? buyPatternType : sellPatternType;
    const currentPrice = currentCandle.close;

    // Proposed Stop Loss
    let proposedStopLoss: ProposedStopLoss;
    if (this.config.stopLossMethod === 'SWING') {
      const refZone = buySignalCandidate ? relevantSupportZone : relevantResistanceZone;
      proposedStopLoss = {
        method: 'SWING',
        bufferPips: this.config.stopLossBufferPips,
        minStopLossPips: this.config.minStopLossPips,
        swingReferencePrice: refZone?.centerPrice,
      };
    } else {
      proposedStopLoss = {
        method: 'ATR',
        atrMultiplier: this.config.atrMultiplier || 1.5,
        minStopLossPips: this.config.minStopLossPips,
      };
    }

    // Proposed Take Profit
    let proposedTakeProfit: ProposedTakeProfit;
    if (this.config.takeProfitMethod === 'SUPPORT_RESISTANCE') {
      // Opposing zone: For BUY, find closest resistance zone strictly above price
      // For SELL, find closest support zone strictly below price
      let opposingZone: PriceZone | null = null;
      if (direction === 'BUY') {
        const validResistances = resistanceZones.filter((z) => z.minPrice > currentPrice);
        opposingZone = validResistances.length > 0 ? validResistances[0] : null;
      } else {
        const validSupports = supportZones.filter((z) => z.maxPrice < currentPrice);
        opposingZone = validSupports.length > 0 ? validSupports[0] : null;
      }

      if (!opposingZone) {
        recordDiagnostic('ERR_INVALID_SL_TP', `No valid opposing ${direction === 'BUY' ? 'resistance' : 'support'} zone found above/below entry price.`);
        return null;
      }

      proposedTakeProfit = {
        method: 'SUPPORT_RESISTANCE',
        targetZonePrice: opposingZone.centerPrice,
      };
    } else {
      // Risk/Reward Target
      proposedTakeProfit = {
        method: 'RR',
        riskRewardRatio: this.config.riskRewardRatio || 2.0,
      };
    }

    signalGenerated = true;
    recordDiagnostic('NONE');

    const signal: TradingSignal = {
      id: `sig_${direction.toLowerCase()}_${currentIndex}`,
      direction,
      signalTime: currentCandle.time,
      signalCandleIndex: currentIndex,
      confirmationCandleClose: currentPrice,
      proposedStopLoss,
      proposedTakeProfit,
      signalType: `${activeRegime}_${patternType}`,
      marketRegime: activeRegime,
      metadata: {
        h1Trend: trendAnalysis.bias,
        adx: h1Adx,
        patternType,
        supportZonePrice: relevantSupportZone?.centerPrice,
        resistanceZonePrice: relevantResistanceZone?.centerPrice,
      },
      indicatorsAtSignal: {
        ema50: m15Indicators.ema50,
        ema200: m15Indicators.ema200,
        atr14: m15Indicators.atr14,
        h1Ema50: context.h1Indicators.ema50,
        h1Ema200: context.h1Indicators.ema200,
      },
    };

    return signal;
  }
}
