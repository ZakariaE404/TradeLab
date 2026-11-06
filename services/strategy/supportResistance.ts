import { Candle } from '@/types/trading';
import { ConfirmedSwingPoint } from '@/types/strategyA';
import { PriceZone, StrategyConfiguration } from './types';

/**
 * Detects swing highs and swing lows with strict left/right confirmation lag.
 * A swing at bar index k is confirmed at bar k + rightBars.
 * Strictly causal: never creates lookahead bias.
 */
export function detectConfirmedSwings(
  candles: Candle[],
  leftBars: number = 3,
  rightBars: number = 3
): ConfirmedSwingPoint[] {
  const swings: ConfirmedSwingPoint[] = [];
  if (!candles || candles.length < leftBars + rightBars + 1) return swings;

  for (let i = leftBars; i < candles.length - rightBars; i++) {
    const currentHigh = candles[i].high;
    const currentLow = candles[i].low;

    // 1. Swing High Check
    let isSwingHigh = true;
    for (let j = i - leftBars; j <= i + rightBars; j++) {
      if (j === i) continue;
      if (candles[j].high >= currentHigh) {
        isSwingHigh = false;
        break;
      }
    }

    if (isSwingHigh) {
      swings.push({
        index: i,
        time: candles[i].time,
        price: currentHigh,
        type: 'HIGH',
        confirmedAtIndex: i + rightBars,
        confirmedAtTime: candles[i + rightBars].time,
      });
    }

    // 2. Swing Low Check
    let isSwingLow = true;
    for (let j = i - leftBars; j <= i + rightBars; j++) {
      if (j === i) continue;
      if (candles[j].low <= currentLow) {
        isSwingLow = false;
        break;
      }
    }

    if (isSwingLow) {
      swings.push({
        index: i,
        time: candles[i].time,
        price: currentLow,
        type: 'LOW',
        confirmedAtIndex: i + rightBars,
        confirmedAtTime: candles[i + rightBars].time,
      });
    }
  }

  // Sort chronologically by confirmation index
  swings.sort((a, b) => a.confirmedAtIndex - b.confirmedAtIndex || a.index - b.index);

  return swings;
}

/**
 * Groups confirmed swing points into consolidated PriceZones (Support & Resistance).
 * Strictly filters out any swing confirmed after currentCandleIndex.
 */
export function getActivePriceZones(params: {
  allSwings: ConfirmedSwingPoint[];
  currentCandleIndex: number;
  currentPrice: number;
  config: StrategyConfiguration;
  pipSize: number;
}): { supportZones: PriceZone[]; resistanceZones: PriceZone[] } {
  const { allSwings, currentCandleIndex, currentPrice, config, pipSize } = params;

  const tolerancePrice = (config.zoneTolerancePips || 3.0) * pipSize;

  // Filter swings that were confirmed at or before currentCandleIndex
  const visibleSwings = allSwings.filter((s) => s.confirmedAtIndex <= currentCandleIndex);

  const swingLows = visibleSwings.filter((s) => s.type === 'LOW');
  const swingHighs = visibleSwings.filter((s) => s.type === 'HIGH');

  const supportZones = clusterSwings(swingLows, 'SUPPORT', currentPrice, tolerancePrice, pipSize);
  const resistanceZones = clusterSwings(swingHighs, 'RESISTANCE', currentPrice, tolerancePrice, pipSize);

  return { supportZones, resistanceZones };
}

/**
 * Clusters an array of same-type swings within price tolerance into zones.
 */
function clusterSwings(
  swings: ConfirmedSwingPoint[],
  type: 'SUPPORT' | 'RESISTANCE',
  currentPrice: number,
  tolerancePrice: number,
  pipSize: number
): PriceZone[] {
  if (swings.length === 0) return [];

  // Group by sorted price
  const sorted = [...swings].sort((a, b) => a.price - b.price);
  const clusters: ConfirmedSwingPoint[][] = [];

  let currentCluster: ConfirmedSwingPoint[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = currentCluster[currentCluster.length - 1];
    const curr = sorted[i];

    if (curr.price - prev.price <= tolerancePrice) {
      currentCluster.push(curr);
    } else {
      clusters.push(currentCluster);
      currentCluster = [curr];
    }
  }
  clusters.push(currentCluster);

  const zones: PriceZone[] = clusters.map((cluster, idx) => {
    const prices = cluster.map((s) => s.price);
    const minPrice = Math.min(...prices);
    const maxPrice = Math.max(...prices);
    const centerPrice = Number(((minPrice + maxPrice) / 2).toFixed(5));
    const latestConfirmedAt = Math.max(...cluster.map((s) => s.confirmedAtIndex));
    const latestConfirmedTime = Math.max(...cluster.map((s) => s.confirmedAtTime));
    const distancePips = Number((Math.abs(currentPrice - centerPrice) / pipSize).toFixed(1));

    return {
      id: `${type.toLowerCase()}_zone_${idx}_price_${centerPrice}`,
      type,
      minPrice,
      maxPrice,
      centerPrice,
      swings: cluster,
      confirmedAtIndex: latestConfirmedAt,
      confirmedAtTime: latestConfirmedTime,
      distancePips,
      isValid: true,
    };
  });

  // Sort by distance to current price (closest first)
  zones.sort((a, b) => a.distancePips - b.distancePips);

  return zones;
}

/**
 * Tests whether an M15 candle's price range interacts with a support zone.
 * (Candle low enters or penetrates the support zone).
 */
export function doesCandleInteractWithSupport(
  candle: Candle,
  zone: PriceZone,
  tolerancePrice: number
): boolean {
  return candle.low <= zone.maxPrice + tolerancePrice && candle.high >= zone.minPrice - tolerancePrice;
}

/**
 * Tests whether an M15 candle's price range interacts with a resistance zone.
 * (Candle high enters or penetrates the resistance zone).
 */
export function doesCandleInteractWithResistance(
  candle: Candle,
  zone: PriceZone,
  tolerancePrice: number
): boolean {
  return candle.high >= zone.minPrice - tolerancePrice && candle.low <= zone.maxPrice + tolerancePrice;
}
