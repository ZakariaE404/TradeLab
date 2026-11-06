import { H1TrendAnalysisResult, MarketRegimeResult, MarketRegimeType, StrategyConfiguration } from './types';

/**
 * Classifies the market regime at the evaluation point:
 * - TRENDING: ADX > adxTrendingThreshold (default 25) AND H1 trend has confirmed direction (BULLISH or BEARISH).
 * - RANGING: ADX < adxRangingThreshold (default 20) OR (ADX <= 25 and H1 trend is NEUTRAL).
 * - TRANSITION: ADX between 20 and 25 with directional bias, or ADX > 25 but conflicting trend conditions.
 *
 * Exposes full diagnostic reasons.
 */
export function classifyMarketRegime(params: {
  trendAnalysis: H1TrendAnalysisResult;
  h1Adx14: number | null;
  hasValidSrStructure?: boolean;
  config: StrategyConfiguration;
}): MarketRegimeResult {
  const { trendAnalysis, h1Adx14, hasValidSrStructure = true, config } = params;

  const reasons: string[] = [];
  const trendingThreshold = config.adxTrendingThreshold ?? 25.0;
  const rangingThreshold = config.adxRangingThreshold ?? 20.0;

  let regime: MarketRegimeType = 'RANGING';

  if (h1Adx14 === null) {
    // Warm-up or unavailable ADX
    reasons.push('ADX is warming up (null value). Defaulting regime to RANGING.');
    return {
      regime: 'RANGING',
      adx: null,
      adxThresholdTrending: trendingThreshold,
      adxThresholdRanging: rangingThreshold,
      trendBias: trendAnalysis.bias,
      reasons,
    };
  }

  const isStrongAdx = h1Adx14 >= trendingThreshold;
  const isWeakAdx = h1Adx14 < rangingThreshold;
  const isTransitionAdx = h1Adx14 >= rangingThreshold && h1Adx14 < trendingThreshold;
  const hasDirectionalTrend = trendAnalysis.bias !== 'NEUTRAL';

  if (isStrongAdx && hasDirectionalTrend) {
    regime = 'TRENDING';
    reasons.push(
      `TRENDING regime confirmed: ADX (${h1Adx14}) >= ${trendingThreshold} with confirmed ${trendAnalysis.bias} H1 trend.`
    );
  } else if (isWeakAdx) {
    regime = 'RANGING';
    reasons.push(
      `RANGING regime confirmed: ADX (${h1Adx14}) < ${rangingThreshold} (weak directional momentum).`
    );
  } else if (isTransitionAdx) {
    regime = 'TRANSITION';
    reasons.push(
      `TRANSITION regime: ADX (${h1Adx14}) is in the transition zone between ${rangingThreshold} and ${trendingThreshold}.`
    );
  } else if (isStrongAdx && !hasDirectionalTrend) {
    regime = 'TRANSITION';
    reasons.push(
      `TRANSITION regime: ADX (${h1Adx14}) is high (>= ${trendingThreshold}), but H1 directional trend is NEUTRAL.`
    );
  } else {
    regime = 'RANGING';
    reasons.push(`RANGING regime: Weak or conflicting directional trend conditions.`);
  }

  if (regime === 'RANGING' && !hasValidSrStructure) {
    reasons.push('Note: Weak directional conditions without confirmed S/R structure.');
  }

  return {
    regime,
    adx: h1Adx14,
    adxThresholdTrending: trendingThreshold,
    adxThresholdRanging: rangingThreshold,
    trendBias: trendAnalysis.bias,
    reasons,
  };
}
