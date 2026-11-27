import { Candle } from '@/types/trading';
import {
  DownloadProgressState,
  DukascopyPriceType,
  DukascopyTimeframe,
  HistoricalDownloadRequest,
  SavedHistoricalDataset,
  TimeRangeInterval,
} from '@/types/historicalData';
import {
  DUKASCOPY_INSTRUMENTS,
  getDukascopyInstrumentMeta,
  mapDukascopyTfToTradeLabTf,
  resolveDukascopyInstrumentId,
  validateDownloadParams,
} from './dukascopyCatalog';
import { normalizeDukascopyCandles } from './dukascopyNormalizer';
import { saveHistoricalDataset, findDuplicateDataset } from './datasetStorage';
import {
  calculateMissingM1Intervals,
  getCanonicalM1Candles,
  getSymbolCoverage,
  normalizeSymbolKey,
  saveCanonicalM1Candles,
} from './m1Database';
import { getOrComputeDerivedTimeframe, normalizeTimeframeId } from './timeframeAggregator';

export interface ChunkRange {
  from: string; // ISO date 'YYYY-MM-DD' or timestamp
  to: string;   // ISO date 'YYYY-MM-DD' or timestamp
  startSec: number;
  endSec: number;
}

/**
 * Splits an interval into manageable chunks (default 7 days for M1 data)
 * to comply with Vercel serverless request limits.
 */
export function splitIntervalIntoChunks(
  interval: TimeRangeInterval,
  maxDaysPerChunk: number = 7
): ChunkRange[] {
  const maxSecPerChunk = maxDaysPerChunk * 86400;
  const chunks: ChunkRange[] = [];
  let cur = interval.start;

  while (cur < interval.end) {
    const nextEnd = Math.min(cur + maxSecPerChunk, interval.end);
    chunks.push({
      from: new Date(cur * 1000).toISOString(),
      to: new Date(nextEnd * 1000).toISOString(),
      startSec: cur,
      endSec: nextEnd,
    });
    cur = nextEnd;
  }

  return chunks;
}

/**
 * Legacy compatibility wrapper for splitting date ranges
 */
export function splitDateRangeIntoChunks(
  fromStr: string,
  toStr: string,
  timeframe: DukascopyTimeframe = 'm1'
): { from: string; to: string }[] {
  const fromTime = new Date(fromStr).getTime();
  const toTime = new Date(toStr).getTime();

  if (isNaN(fromTime) || isNaN(toTime) || fromTime >= toTime) {
    return [{ from: fromStr, to: toStr }];
  }

  const interval: TimeRangeInterval = {
    start: Math.floor(fromTime / 1000),
    end: Math.ceil(toTime / 1000),
  };

  const daysPerChunk = timeframe === 'm1' ? 7 : 30;
  const chunks = splitIntervalIntoChunks(interval, daysPerChunk);

  return chunks.map((c) => ({
    from: c.from.split('T')[0],
    to: c.to.split('T')[0],
  }));
}

export interface DownloadOptions {
  onProgress?: (progress: DownloadProgressState) => void;
  signal?: AbortSignal;
  forceOverwrite?: boolean;
}

/**
 * Reliable M1-Based Historical Data Download Manager:
 * - M1 is the ONLY canonical timeframe downloaded from Dukascopy.
 * - Detects already covered intervals in IndexedDB; downloads ONLY missing intervals.
 * - Saves M1 candles directly to canonical database.
 * - Generates all higher timeframes deterministically via timeframeAggregator.
 * - Resumes gracefully from where it left off on interruption.
 */
export async function downloadHistoricalDataset(
  request: HistoricalDownloadRequest,
  options: DownloadOptions = {}
): Promise<{ success: boolean; dataset?: SavedHistoricalDataset; error?: string; isDuplicate?: boolean }> {
  const { onProgress, signal, forceOverwrite } = options;
  const resolvedInstrument = resolveDukascopyInstrumentId(request.instrument);
  const { timeframe, from, to, priceType } = request;
  const instrument = resolvedInstrument;

  // 1. Validate parameters
  const validation = validateDownloadParams({
    instrument,
    timeframe: 'm1', // Canonical format
    from,
    to,
    priceType,
  });

  if (!validation.isValid) {
    return { success: false, error: validation.error };
  }

  const symKey = normalizeSymbolKey(instrument);
  const fromDate = new Date(from);
  const toDate = new Date(to);

  if (!from.includes('T') && !from.includes(':')) {
    fromDate.setUTCHours(0, 0, 0, 0);
  }
  if (!to.includes('T') && !to.includes(':')) {
    toDate.setUTCHours(23, 59, 59, 999);
  }

  const startSec = Math.floor(fromDate.getTime() / 1000);
  const endSec = Math.ceil(toDate.getTime() / 1000);

  // 2. Check existing database coverage & detect missing intervals
  onProgress?.({
    isDownloading: true,
    instrument,
    timeframe: 'm1',
    progressPercent: 5,
    totalChunks: 0,
    completedChunks: 0,
    totalCandlesFetched: 0,
    currentStage: 'Inspecting local canonical M1 database...',
  });

  const existingCoverage = await getSymbolCoverage(symKey);
  const missingIntervals = forceOverwrite
    ? [{ start: startSec, end: endSec }]
    : await calculateMissingM1Intervals(symKey, startSec, endSec);

  // 3. If all data already exists, skip network requests entirely!
  if (missingIntervals.length === 0) {
    onProgress?.({
      isDownloading: true,
      instrument,
      timeframe: 'm1',
      progressPercent: 90,
      totalChunks: 0,
      completedChunks: 0,
      totalCandlesFetched: existingCoverage?.totalCandlesCount || 0,
      currentStage: 'All requested data already exists locally. Generating timeframes...',
    });

    const dataset = await buildDatasetFromCanonicalM1({
      instrument,
      symKey,
      timeframe,
      from,
      to,
      startSec,
      endSec,
      priceType,
    });

    onProgress?.({
      isDownloading: false,
      instrument,
      timeframe: 'm1',
      progressPercent: 100,
      totalChunks: 0,
      completedChunks: 0,
      totalCandlesFetched: dataset.candleCount,
      currentStage: 'Complete! Loaded from canonical local database.',
    });

    return { success: true, dataset };
  }

  // 4. Split missing intervals into chunks (7 days per chunk for M1)
  const allChunks: ChunkRange[] = [];
  for (const interval of missingIntervals) {
    const intervalChunks = splitIntervalIntoChunks(interval, 7);
    allChunks.push(...intervalChunks);
  }

  const totalChunks = allChunks.length;
  let totalM1Saved = 0;

  onProgress?.({
    isDownloading: true,
    instrument,
    timeframe: 'm1',
    progressPercent: 10,
    totalChunks,
    completedChunks: 0,
    totalCandlesFetched: 0,
    currentStage: `Downloading ${totalChunks} missing M1 chunk${totalChunks > 1 ? 's' : ''}...`,
    missingIntervalsCount: missingIntervals.length,
  });

  // 5. Download missing chunks sequentially with retry support
  for (let i = 0; i < totalChunks; i++) {
    if (signal?.aborted) {
      return { success: false, error: 'Download cancelled by user.' };
    }

    const chunk = allChunks[i];
    const chunkPct = Math.round(10 + (i / totalChunks) * 75);

    onProgress?.({
      isDownloading: true,
      instrument,
      timeframe: 'm1',
      progressPercent: chunkPct,
      totalChunks,
      completedChunks: i,
      totalCandlesFetched: totalM1Saved,
      currentStage: `Downloading M1 chunk ${i + 1}/${totalChunks} (${chunk.from.split('T')[0]} to ${chunk.to.split('T')[0]})...`,
    });

    let success = false;
    let attempts = 0;
    let chunkCandles: Candle[] = [];
    let lastError = '';

    while (!success && attempts < 3) {
      attempts++;
      try {
        const queryParams = new URLSearchParams({
          instrument,
          timeframe: 'm1', // Always canonical M1
          from: chunk.from,
          to: chunk.to,
          priceType,
        });

        const res = await fetch(`/api/dukascopy?${queryParams.toString()}`, {
          method: 'GET',
          signal,
        });

        if (!res.ok) {
          const errBody = await res.json().catch(() => ({}));
          throw new Error(errBody.error || `HTTP ${res.status}`);
        }

        const data = await res.json();
        if (!data.success) {
          throw new Error(data.error || 'Server reported failure');
        }

        chunkCandles = Array.isArray(data.candles) ? data.candles : [];
        success = true;
      } catch (err: any) {
        if (signal?.aborted) {
          return { success: false, error: 'Download cancelled by user.' };
        }
        lastError = err.message || 'Network request failed';
        if (attempts < 3) {
          await new Promise((r) => setTimeout(r, attempts * 1000));
        }
      }
    }

    if (!success) {
      return {
        success: false,
        error: `Failed to download chunk ${i + 1}/${totalChunks} after 3 attempts: ${lastError}`,
      };
    }

    // Save downloaded M1 candles directly into canonical IndexedDB
    if (chunkCandles.length > 0) {
      const savedCount = await saveCanonicalM1Candles(instrument, chunkCandles, 'Dukascopy');
      totalM1Saved += savedCount;
    }
  }

  // 6. Stream / aggregate requested timeframe directly from canonical database
  onProgress?.({
    isDownloading: true,
    instrument,
    timeframe: 'm1',
    progressPercent: 90,
    totalChunks,
    completedChunks: totalChunks,
    totalCandlesFetched: totalM1Saved,
    currentStage: 'Validating canonical M1 data and generating timeframes...',
  });

  // 7. Aggregate M1 to the requested display timeframe via streaming DB aggregation
  const dataset = await buildDatasetFromCanonicalM1({
    instrument,
    symKey,
    timeframe,
    from,
    to,
    startSec,
    endSec,
    priceType,
  });

  if (dataset.candleCount === 0) {
    return {
      success: false,
      error: `No candles returned from Dukascopy for ${instrument.toUpperCase()} between ${from} and ${to}. Market was likely closed.`,
    };
  }

  onProgress?.({
    isDownloading: false,
    instrument,
    timeframe: 'm1',
    progressPercent: 100,
    totalChunks,
    completedChunks: totalChunks,
    totalCandlesFetched: totalM1Saved || dataset.candleCount,
    currentStage: 'Completed successfully! Saved to canonical database.',
  });

  return {
    success: true,
    dataset,
  };
}

/**
 * Builds and saves a SavedHistoricalDataset entity by streaming canonical M1 data
 */
async function buildDatasetFromCanonicalM1(params: {
  instrument: string;
  symKey: string;
  timeframe: DukascopyTimeframe;
  from: string;
  to: string;
  startSec: number;
  endSec: number;
  priceType: DukascopyPriceType;
}): Promise<SavedHistoricalDataset> {
  const { instrument, symKey, timeframe, from, to, startSec, endSec, priceType } = params;

  const instMeta = getDukascopyInstrumentMeta(instrument);
  const normTf = normalizeTimeframeId(timeframe);
  const candles =
    normTf === '1m'
      ? await getCanonicalM1Candles(symKey, startSec, endSec)
      : await getOrComputeDerivedTimeframe(symKey, normTf, startSec, endSec);

  const displayTf = mapDukascopyTfToTradeLabTf(timeframe);
  const datasetId = `ds_${instrument.toLowerCase()}_${timeframe}_${from.replace(/[^0-9]/g, '')}_${to.replace(/[^0-9]/g, '')}_${priceType.toLowerCase()}_${Date.now()}`;

  const dataset: SavedHistoricalDataset = {
    id: datasetId,
    name: `${instMeta.symbol} ${timeframe.toUpperCase()} (${from} → ${to})`,
    instrument: instrument.toLowerCase(),
    symbol: instMeta.symbol,
    timeframe,
    displayTimeframe: displayTf,
    startDate: from,
    endDate: to,
    startTime: candles[0]?.time || startSec,
    endTime: candles[candles.length - 1]?.time || endSec,
    priceType,
    candleCount: candles.length,
    downloadDate: Date.now(),
    dataSource: 'Dukascopy',
    status: 'READY',
    candles,
  };

  await saveHistoricalDataset(dataset);
  return dataset;
}
