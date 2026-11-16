import { StrategyBarContext } from '../../core/StrategyContext';
import { StrategySignal } from '../../core/StrategyTypes';
import { Strategy001Parameters } from './config';
import {
  detectConfirmedSwings,
  evaluateH1Trend,
  evaluateRejectionCandle,
  evaluateSupportResistanceZone,
} from './indicators';
import { FOREX_SYMBOLS } from '@/services/marketData';

export function evaluateStrategy001Bar(
  context: StrategyBarContext<Strategy001Parameters>
): StrategySignal | null {
  const { currentCandle, parameters: params, symbol } = context;

  // 1. Identify the latest fully CLOSED H1 candle available at this M15 evaluation time
  const closedH1 = context.getLatestClosedCandle('1h');
  const closedH1Index = context.getLatestClosedIndex('1h');
  if (!closedH1 || closedH1Index < 30) {
    return null; // Not enough H1 history for trend evaluation
  }

  // 2. Retrieve H1 indicators strictly at the closed H1 candle timestamp
  const h1Ema50 = context.getIndicatorValue<number>('ema50', '1h');
  const h1Ema200 = context.getIndicatorValue<number>('ema200', '1h');

  if (h1Ema50 === null || h1Ema200 === null) {
    return null;
  }

  // Build maps for evaluateH1Trend
  const h1Ema50Map = new Map<number, number>([[closedH1.time, h1Ema50]]);
  const h1Ema200Map = new Map<number, number>([[closedH1.time, h1Ema200]]);
  const closedH1Candles = context.getClosedCandles('1h');

  // 3. Evaluate H1 Trend Filter
  const h1Trend = evaluateH1Trend(
    closedH1Candles,
    closedH1Index,
    h1Ema50Map,
    h1Ema200Map,
    {
      ...params,
      accountCapital: params.accountCapital ?? 10000,
      riskPercent: params.riskPercent ?? 1,
    }
  );

  if (h1Trend.bias !== 'BUY' && h1Trend.bias !== 'SELL') {
    return null; // No clear higher-timeframe trend
  }

  const direction = h1Trend.bias;

  // 4. M15 EMA Filter Condition
  const m15Ema50 = context.getIndicatorValue<number>('ema50', '15m');
  const m15Ema200 = context.getIndicatorValue<number>('ema200', '15m');

  if (params.requireM15EmaFilter && m15Ema50 !== null && m15Ema200 !== null) {
    if (direction === 'BUY' && m15Ema50 <= m15Ema200) return null;
    if (direction === 'SELL' && m15Ema50 >= m15Ema200) return null;
  }

  // 5. Detect confirmed swings on M15 up to current bar index
  const m15History = context.getPrimaryHistory();
  const confirmedM15Swings = detectConfirmedSwings(
    m15History,
    params.m15SwingLookback,
    context.currentIndex
  );

  const confirmedLows = confirmedM15Swings.filter((s) => s.type === 'LOW');
  const confirmedHighs = confirmedM15Swings.filter((s) => s.type === 'HIGH');
  const latestSwingLow = confirmedLows.length > 0 ? confirmedLows[confirmedLows.length - 1].price : null;
  const latestSwingHigh = confirmedHighs.length > 0 ? confirmedHighs[confirmedHighs.length - 1].price : null;

  const symbolMeta = FOREX_SYMBOLS[symbol] || FOREX_SYMBOLS['EUR/USD'];
  const pipSize = symbolMeta.pipSize;
  const zoneTolerancePrice = params.zoneTolerancePips * pipSize;
  const slBufferPrice = params.stopLossBufferPips * pipSize;
  const minSlPrice = params.minStopLossPips * pipSize;

  // 6. Check Support/Resistance Zone Reach
  const zoneCheck = evaluateSupportResistanceZone(
    currentCandle,
    m15Ema50 ?? undefined,
    latestSwingLow,
    latestSwingHigh,
    direction,
    zoneTolerancePrice
  );

  if (!zoneCheck.isZoneReached) {
    return null;
  }

  // 7. Check M15 Rejection Candle Confirmation
  const rejection = evaluateRejectionCandle(currentCandle, params.minRejectionWickRatio);
  const isRejectionValid =
    (direction === 'BUY' && rejection.type === 'BULLISH_REJECTION') ||
    (direction === 'SELL' && rejection.type === 'BEARISH_REJECTION');

  if (!isRejectionValid) {
    return null;
  }

  // 8. Construct Strategy Signal
  const entryPrice = currentCandle.close;
  let stopLossPrice = 0;

  if (direction === 'BUY') {
    const swingRef = latestSwingLow !== null ? latestSwingLow : currentCandle.low;
    const calculatedSL = swingRef - slBufferPrice;
    const minAllowedSL = entryPrice - minSlPrice;
    stopLossPrice = Math.min(calculatedSL, minAllowedSL);
  } else {
    const swingRef = latestSwingHigh !== null ? latestSwingHigh : currentCandle.high;
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

  return {
    direction,
    signalTime: currentCandle.time,
    entryTime: currentCandle.time + 900,
    entryPrice,
    stopLossPrice: Number(stopLossPrice.toFixed(symbolMeta.digits)),
    takeProfitPrice: Number(takeProfitPrice.toFixed(symbolMeta.digits)),
    riskPips,
    rewardPips,
    riskRewardRatio: params.riskRewardRatio,
    signalReason: `H1 Trend (${h1Trend.bias}) + M15 Rejection (${(rejection.wickRatio * 100).toFixed(0)}% wick at zone ${zoneCheck.zoneLevel.toFixed(symbolMeta.digits)})`,
    h1Bias: `${h1Trend.bias} (H1 EMA 50: ${h1Ema50.toFixed(symbolMeta.digits)}, EMA 200: ${h1Ema200.toFixed(symbolMeta.digits)})`,
    m15Confirmation: `${rejection.type} (${(rejection.wickRatio * 100).toFixed(0)}% wick)`,
    metadata: {
      zoneLevel: zoneCheck.zoneLevel,
      wickRatio: rejection.wickRatio,
      closedH1Time: closedH1.time,
    },
  };
}
