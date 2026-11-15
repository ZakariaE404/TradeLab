import { NextRequest, NextResponse } from 'next/server';
import { getHistoricalRates } from 'dukascopy-node';
import {
  DUKASCOPY_INSTRUMENTS,
  isValidDukascopyInstrument,
  validateDownloadParams,
} from '@/services/dukascopyCatalog';
import {
  normalizeDukascopyCandles,
  RawDukascopyCandle,
} from '@/services/dukascopyNormalizer';
import { DukascopyPriceType, DukascopyTimeframe } from '@/types/historicalData';

/**
 * Server-Side API Route for Dukascopy Historical Market Data
 * Downloads historical rates using dukascopy-node, normalizes and validates them.
 */

export const dynamic = 'force-dynamic';
export const maxDuration = 60; // Up to 60s timeout where supported

export async function GET(request: NextRequest) {
  try {
    const { searchParams } = new URL(request.url);
    const instrument = (searchParams.get('instrument') || 'eurusd').toLowerCase().trim();
    const timeframe = (searchParams.get('timeframe') || 'm15').toLowerCase().trim() as DukascopyTimeframe;
    const from = searchParams.get('from') || '';
    const to = searchParams.get('to') || '';
    const priceType = (searchParams.get('priceType') || 'BID').toUpperCase().trim() as DukascopyPriceType;

    return await handleDukascopyFetch({
      instrument,
      timeframe,
      from,
      to,
      priceType,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        code: 'INTERNAL_SERVER_ERROR',
        error: error.message || 'An unexpected error occurred while processing Dukascopy historical data.',
      },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const instrument = (body.instrument || 'eurusd').toLowerCase().trim();
    const timeframe = (body.timeframe || 'm15').toLowerCase().trim() as DukascopyTimeframe;
    const from = body.from || '';
    const to = body.to || '';
    const priceType = (body.priceType || 'BID').toUpperCase().trim() as DukascopyPriceType;

    return await handleDukascopyFetch({
      instrument,
      timeframe,
      from,
      to,
      priceType,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        code: 'INTERNAL_SERVER_ERROR',
        error: error.message || 'An unexpected error occurred while processing Dukascopy historical data.',
      },
      { status: 500 }
    );
  }
}

async function handleDukascopyFetch(params: {
  instrument: string;
  timeframe: DukascopyTimeframe;
  from: string;
  to: string;
  priceType: DukascopyPriceType;
}) {
  const { instrument, timeframe, from, to, priceType } = params;

  // 1. Parameter Validation
  const validation = validateDownloadParams({
    instrument,
    timeframe,
    from,
    to,
    priceType,
  });

  if (!validation.isValid) {
    return NextResponse.json(
      {
        success: false,
        code: 'INVALID_PARAMETERS',
        error: validation.error || 'Invalid parameters supplied.',
      },
      { status: 400 }
    );
  }

  const fromDate = new Date(from);
  const toDate = new Date(to);

  // If fromDate has no specific time, default to start of UTC day
  if (!from.includes('T') && !from.includes(':')) {
    fromDate.setUTCHours(0, 0, 0, 0);
  }
  // If toDate has no specific time, default to end of UTC day
  if (!to.includes('T') && !to.includes(':')) {
    toDate.setUTCHours(23, 59, 59, 999);
  }

  // 2. Fetch from Dukascopy
  try {
    const rawRates = await getHistoricalRates({
      instrument: instrument as any,
      dates: {
        from: fromDate,
        to: toDate,
      },
      timeframe,
      priceType: priceType.toLowerCase() as 'bid' | 'ask',
      volumes: true,
      format: 'json',
    });

    if (!rawRates || !Array.isArray(rawRates) || rawRates.length === 0) {
      return NextResponse.json({
        success: true,
        count: 0,
        candles: [],
        meta: {
          instrument,
          timeframe,
          from: fromDate.toISOString(),
          to: toDate.toISOString(),
          priceType,
          dataSource: 'Dukascopy',
        },
        report: {
          totalReceived: 0,
          validCandles: 0,
          duplicateTimestampsRemoved: 0,
          invalidOhlcFiltered: 0,
          missingGapsCount: 0,
        },
      });
    }

    // 3. Normalize into TradeLab internal Candle format
    const normalized = normalizeDukascopyCandles(rawRates as RawDukascopyCandle[], timeframe);

    const instrumentMeta = DUKASCOPY_INSTRUMENTS[instrument] || {
      symbol: instrument.toUpperCase(),
      name: instrument.toUpperCase(),
    };

    return NextResponse.json({
      success: true,
      count: normalized.candles.length,
      candles: normalized.candles,
      meta: {
        instrument,
        symbol: instrumentMeta.symbol,
        name: instrumentMeta.name,
        timeframe,
        from: fromDate.toISOString(),
        to: toDate.toISOString(),
        priceType,
        dataSource: 'Dukascopy',
      },
      report: normalized.report,
    });
  } catch (err: any) {
    return NextResponse.json(
      {
        success: false,
        code: 'DUKASCOPY_FETCH_FAILED',
        error: err.message || 'Failed to download historical rates from Dukascopy.',
      },
      { status: 502 }
    );
  }
}
