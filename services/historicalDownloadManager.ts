import { Candle } from '@/types/trading';
import {
  DownloadProgressState,
  DukascopyPriceType,
  DukascopyTimeframe,
  HistoricalDownloadRequest,
  SavedHistoricalDataset,
} from '@/types/historicalData';
import {
  DUKASCOPY_INSTRUMENTS,
  mapDukascopyTfToTradeLabTf,
  validateDownloadParams,
} from './dukascopyCatalog';
import { normalizeDukascopyCandles } from './dukascopyNormalizer';
import { findDuplicateDataset, saveHistoricalDataset } from './datasetStorage';

export interface ChunkRange {
  from: string; // ISO date YYYY-MM-DD
  to: string; // ISO date YYYY-MM-DD
}

/**
 * Splits date range into manageable chunks to prevent Vercel / serverless timeouts.
 */
export function splitDateRangeIntoChunks(
  fromStr: string,
  toStr: string,
  timeframe: DukascopyTimeframe
): ChunkRange[] {
  const fromDate = new Date(fromStr);
  const toDate = new Date(toStr);

  if (isNaN(fromDate.getTime()) || isNaN(toDate.getTime()) || fromDate >= toDate) {
    return [{ from: fromStr, to: toStr }];
  }

  // Determine days per chunk according to timeframe density
  let daysPerChunk = 30;
  if (timeframe === 'm1') daysPerChunk = 7;
  else if (timeframe === 'm5') daysPerChunk = 14;
  else if (timeframe === 'm15' || timeframe === 'm30') daysPerChunk = 30;
  else if (timeframe === 'h1' || timeframe === 'h4') daysPerChunk = 90;
  else if (timeframe === 'd1') daysPerChunk = 365;

  const totalDiffDays = Math.ceil((toDate.getTime() - fromDate.getTime()) / (1000 * 3600 * 24));
  if (totalDiffDays <= daysPerChunk) {
    return [{ from: fromStr, to: toStr }];
  }

  const chunks: ChunkRange[] = [];
  let currentStart = new Date(fromDate);

  while (currentStart < toDate) {
    const currentEnd = new Date(currentStart);
    currentEnd.setDate(currentEnd.getDate() + daysPerChunk);

    const actualEnd = currentEnd > toDate ? new Date(toDate) : currentEnd;

    chunks.push({
      from: currentStart.toISOString().split('T')[0],
      to: actualEnd.toISOString().split('T')[0],
    });

    // Move to next chunk start
    currentStart = new Date(actualEnd);
    currentStart.setDate(currentStart.getDate() + 1);
  }

  return chunks;
}

export interface DownloadOptions {
  onProgress?: (progress: DownloadProgressState) => void;
  signal?: AbortSignal;
  forceOverwrite?: boolean;
}

/**
 * Executes historical data download from Dukascopy API route.
 * Handles chunking, progress updates, cancellation, retries, and dataset saving.
 */
export async function downloadHistoricalDataset(
  request: HistoricalDownloadRequest,
  options: DownloadOptions = {}
): Promise<{ success: boolean; dataset?: SavedHistoricalDataset; error?: string; isDuplicate?: boolean }> {
  const { onProgress, signal, forceOverwrite } = options;
  const { instrument, timeframe, from, to, priceType } = request;

  // 1. Validation
  const validation = validateDownloadParams({
    instrument,
    timeframe,
    from,
    to,
    priceType,
  });

  if (!validation.isValid) {
    return { success: false, error: validation.error };
  }

  // 2. Protection against duplicate downloads
  if (!forceOverwrite) {
    const existing = await findDuplicateDataset({
      instrument,
      timeframe,
      startDate: from,
      endDate: to,
      priceType,
    });

    if (existing) {
      return {
        success: false,
        isDuplicate: true,
        dataset: existing,
        error: `A dataset for ${instrument.toUpperCase()} (${timeframe.toUpperCase()}) from ${from} to ${to} [${priceType}] is already saved.`,
      };
    }
  }

  // 3. Chunk generation
  const chunks = splitDateRangeIntoChunks(from, to, timeframe);
  const totalChunks = chunks.length;
  let allRawCandles: any[] = [];

  onProgress?.({
    isDownloading: true,
    instrument,
    timeframe,
    progressPercent: 5,
    totalChunks,
    completedChunks: 0,
    totalCandlesFetched: 0,
    currentStage: `Preparing download in ${totalChunks} chunk${totalChunks > 1 ? 's' : ''}...`,
  });

  // 4. Download chunks sequentially with retry support
  for (let i = 0; i < totalChunks; i++) {
    if (signal?.aborted) {
      return { success: false, error: 'Download cancelled by user.' };
    }

    const chunk = chunks[i];
    const chunkPct = Math.round(5 + ((i) / totalChunks) * 80);

    onProgress?.({
      isDownloading: true,
      instrument,
      timeframe,
      progressPercent: chunkPct,
      totalChunks,
      completedChunks: i,
      totalCandlesFetched: allRawCandles.length,
      currentStage: `Downloading chunk ${i + 1}/${totalChunks} (${chunk.from} to ${chunk.to})...`,
    });

    let success = false;
    let attempts = 0;
    let chunkData: any[] = [];
    let lastError = '';

    while (!success && attempts < 3) {
      attempts++;
      try {
        const queryParams = new URLSearchParams({
          instrument,
          timeframe,
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

        chunkData = Array.isArray(data.candles) ? data.candles : [];
        success = true;
      } catch (err: any) {
        if (signal?.aborted) {
          return { success: false, error: 'Download cancelled by user.' };
        }
        lastError = err.message || 'Network request failed';
        if (attempts < 3) {
          // Exponential backoff
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

    allRawCandles = allRawCandles.concat(chunkData);
  }

  // 5. Final Normalization and Validation
  onProgress?.({
    isDownloading: true,
    instrument,
    timeframe,
    progressPercent: 90,
    totalChunks,
    completedChunks: totalChunks,
    totalCandlesFetched: allRawCandles.length,
    currentStage: 'Normalizing and validating historical candles...',
  });

  const normalized = normalizeDukascopyCandles(allRawCandles, timeframe);

  if (normalized.candles.length === 0) {
    return {
      success: false,
      error: `No valid candles returned from Dukascopy for ${instrument.toUpperCase()} on ${timeframe.toUpperCase()} between ${from} and ${to}. Check if market was open.`,
    };
  }

  // 6. Build SavedHistoricalDataset
  const instMeta = DUKASCOPY_INSTRUMENTS[instrument.toLowerCase()] || {
    symbol: instrument.toUpperCase(),
    name: instrument.toUpperCase(),
  };

  const datasetId = `ds_${instrument.toLowerCase()}_${timeframe}_${from.replace(/-/g, '')}_${to.replace(/-/g, '')}_${priceType.toLowerCase()}_${Date.now()}`;
  const displayTf = mapDukascopyTfToTradeLabTf(timeframe);

  const dataset: SavedHistoricalDataset = {
    id: datasetId,
    name: `${instMeta.symbol} ${timeframe.toUpperCase()} (${from} → ${to})`,
    instrument: instrument.toLowerCase(),
    symbol: instMeta.symbol,
    timeframe,
    displayTimeframe: displayTf,
    startDate: from,
    endDate: to,
    startTime: normalized.report.startTime || Math.floor(Date.parse(from) / 1000),
    endTime: normalized.report.endTime || Math.floor(Date.parse(to) / 1000),
    priceType,
    candleCount: normalized.candles.length,
    downloadDate: Date.now(),
    dataSource: 'Dukascopy',
    status: 'READY',
    candles: normalized.candles,
  };

  // 7. Persist Dataset
  onProgress?.({
    isDownloading: true,
    instrument,
    timeframe,
    progressPercent: 96,
    totalChunks,
    completedChunks: totalChunks,
    totalCandlesFetched: normalized.candles.length,
    currentStage: 'Saving dataset to local storage...',
  });

  await saveHistoricalDataset(dataset);

  onProgress?.({
    isDownloading: false,
    instrument,
    timeframe,
    progressPercent: 100,
    totalChunks,
    completedChunks: totalChunks,
    totalCandlesFetched: normalized.candles.length,
    currentStage: 'Completed successfully!',
  });

  return {
    success: true,
    dataset,
  };
}
