import {
  formatOutput,
  generateUrls,
  normaliseDates,
  processData,
  validateConfigNode,
} from 'dukascopy-node';
import { DukascopyTimeframe } from '@/types/historicalData';

const DUKASCOPY_REFERER = 'https://www.dukascopy.com/swiss/english/marketwatch/historical/';
const DUKASCOPY_USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

export interface DukascopyFetchOptions {
  instrument: string;
  from: Date;
  to: Date;
  timeframe: DukascopyTimeframe;
  priceType: 'bid' | 'ask';
  retryCount?: number;
  pauseBetweenRetriesMs?: number;
  batchSize?: number;
  pauseBetweenBatchesMs?: number;
  requestTimeoutMs?: number;
}

export interface DukascopyRawBar {
  timestamp: number;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchDukascopyBuffer(
  url: string,
  retryCount: number,
  pauseBetweenRetriesMs: number,
  requestTimeoutMs: number
): Promise<Buffer> {
  let lastError: Error = new Error(`Failed to fetch Dukascopy URL: ${url}`);

  for (let attempt = 0; attempt <= retryCount; attempt++) {
    try {
      const response = await fetch(url, {
        headers: {
          accept: 'application/json',
          referer: DUKASCOPY_REFERER,
          'user-agent': DUKASCOPY_USER_AGENT,
        },
        redirect: 'error',
        signal: AbortSignal.timeout(requestTimeoutMs),
      });

      if (response.status === 404) {
        // Some dates (e.g. market holidays / pre-listing) may return empty or 404
        return Buffer.alloc(0);
      }

      if (!response.ok) {
        await response.body?.cancel().catch(() => {});
        throw new Error(`Dukascopy HTTP ${response.status} for ${url}`);
      }

      const contentType = (response.headers.get('content-type') || '').toLowerCase();
      if (!contentType.includes('application/json')) {
        await response.body?.cancel().catch(() => {});
        throw new Error(`Unexpected Dukascopy content-type "${contentType}" for ${url}`);
      }

      const buf = Buffer.from(await response.arrayBuffer());
      // Validate JSON structure early
      const parsed = JSON.parse(buf.toString('utf8'));
      if (!parsed || !Array.isArray(parsed.times)) {
        throw new Error(`Invalid Dukascopy JSON payload for ${url}`);
      }

      return buf;
    } catch (err: any) {
      lastError = err instanceof Error ? err : new Error(String(err));
      if (attempt < retryCount) {
        await sleep(pauseBetweenRetriesMs * (attempt + 1));
      }
    }
  }

  throw lastError;
}

/**
 * Fetches and decodes historical OHLCV bars from Dukascopy using dukascopy-node's
 * URL generator, date normalizer, and binary/JSON decoder with the active MarketWatch referer.
 */
export async function fetchDukascopyHistoricalRates(
  options: DukascopyFetchOptions
): Promise<DukascopyRawBar[]> {
  const {
    instrument,
    from,
    to,
    timeframe,
    priceType,
    retryCount = 2,
    pauseBetweenRetriesMs = 1000,
    batchSize = 10,
    pauseBetweenBatchesMs = 100,
    requestTimeoutMs = 30000,
  } = options;

  const config = {
    instrument: instrument as any,
    dates: { from, to },
    timeframe,
    priceType,
    volumes: true,
    format: 'json' as const,
  };

  const validation = validateConfigNode(config);
  if (!validation.isValid) {
    const err: any = new Error(
      `Invalid Dukascopy download config for ${instrument}: ${JSON.stringify(validation.validationErrors)}`
    );
    err.validationErrors = validation.validationErrors;
    err.status = 400;
    throw err;
  }

  const [startDate, endDate] = normaliseDates({
    instrument: instrument as any,
    startDate: from,
    endDate: to,
    timeframe,
    utcOffset: 0,
  });

  const urls = generateUrls({
    instrument: instrument as any,
    timeframe,
    priceType,
    startDate,
    endDate,
  });

  if (!urls || urls.length === 0) {
    return [];
  }

  const bufferObjects: Array<{ url: string; buffer: Buffer }> = [];

  for (let i = 0; i < urls.length; i += batchSize) {
    const batch = urls.slice(i, i + batchSize);
    const results = await Promise.all(
      batch.map(async (url) => {
        const buffer = await fetchDukascopyBuffer(
          url,
          retryCount,
          pauseBetweenRetriesMs,
          requestTimeoutMs
        );
        return { url, buffer };
      })
    );

    for (const item of results) {
      if (item.buffer.length > 0) {
        bufferObjects.push(item);
      }
    }

    if (i + batchSize < urls.length && pauseBetweenBatchesMs > 0) {
      await sleep(pauseBetweenBatchesMs);
    }
  }

  if (bufferObjects.length === 0) {
    return [];
  }

  const processed = processData({
    instrument: instrument as any,
    requestedTimeframe: timeframe,
    bufferObjects,
    priceType,
    volumes: true,
    volumeUnits: 'millions',
    ignoreFlats: true,
  });

  const [startMs, endMs] = [+startDate, +endDate];
  const filtered = processed.filter(
    ([timestamp]) => typeof timestamp === 'number' && timestamp >= startMs && timestamp < endMs
  );

  const formatted = formatOutput({
    processedData: filtered,
    format: 'json',
    timeframe,
  });

  return Array.isArray(formatted) ? (formatted as unknown as DukascopyRawBar[]) : [];
}
