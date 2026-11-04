import { NextRequest, NextResponse } from 'next/server';

/**
 * Server-Side API Route for Twelve Data Market Data
 * Ensures TWELVE_DATA_API_KEY is never exposed to the client.
 */

const TWELVE_DATA_BASE_URL = 'https://api.twelvedata.com';

// Map internal timeframe to Twelve Data interval format
const TIMEFRAME_TO_TWELVE_DATA: Record<string, string> = {
  '1m': '1min',
  '5m': '5min',
  '15m': '15min',
  '1h': '1h',
  '4h': '4h',
  '1D': '1day',
};

// Map internal symbol to Twelve Data symbol format
function toTwelveDataSymbol(symbol: string): string {
  const clean = symbol.trim();
  if (clean === 'XAUUSDm' || clean === 'XAU/USD' || clean.toUpperCase() === 'XAUUSD') {
    return 'XAU/USD';
  }
  return clean;
}

export async function GET(request: NextRequest) {
  try {
    let apiKey = process.env.TWELVE_DATA_API_KEY;

    // Support client-supplied key via header or query param when server env is not configured
    const headerKey = request.headers.get('x-twelve-data-key');
    const { searchParams } = new URL(request.url);
    const queryKey = searchParams.get('apiKey');

    if (!apiKey || apiKey.trim() === '' || apiKey === 'your_twelve_data_api_key_here') {
      if (headerKey && headerKey.trim()) {
        apiKey = headerKey.trim();
      } else if (queryKey && queryKey.trim()) {
        apiKey = queryKey.trim();
      }
    }

    // Check if API key is configured
    if (!apiKey || apiKey.trim() === '' || apiKey === 'your_twelve_data_api_key_here') {
      return NextResponse.json(
        {
          success: false,
          code: 'MISSING_API_KEY',
          error:
            'Twelve Data API key is not configured. Please set TWELVE_DATA_API_KEY in your .env.local file or enter your API key in the terminal.',
          help: 'You can get a free API key at https://twelvedata.com (Free tier provides 800 API calls/day, 8 credits/min).',
        },
        { status: 401 }
      );
    }

    const rawSymbol = searchParams.get('symbol') || 'XAU/USD';
    const rawInterval = searchParams.get('interval') || '15m';
    const outputsize = Math.min(Math.max(parseInt(searchParams.get('outputsize') || '500', 10), 10), 5000);
    const startDate = searchParams.get('start_date');
    const endDate = searchParams.get('end_date');

    const providerSymbol = toTwelveDataSymbol(rawSymbol);
    const providerInterval = TIMEFRAME_TO_TWELVE_DATA[rawInterval] || rawInterval;

    // Build URL with params
    const queryParams = new URLSearchParams({
      symbol: providerSymbol,
      interval: providerInterval,
      outputsize: outputsize.toString(),
      timezone: 'UTC',
      format: 'JSON',
      apikey: apiKey,
    });

    if (startDate) queryParams.set('start_date', startDate);
    if (endDate) queryParams.set('end_date', endDate);

    const url = `${TWELVE_DATA_BASE_URL}/time_series?${queryParams.toString()}`;

    const response = await fetch(url, {
      method: 'GET',
      headers: {
        'Accept': 'application/json',
      },
      // Cache-Control headers can be adjusted; revalidate after 30s
      next: { revalidate: 30 },
    });

    if (!response.ok) {
      return NextResponse.json(
        {
          success: false,
          code: `HTTP_${response.status}`,
          error: `Twelve Data API responded with status ${response.status} (${response.statusText}).`,
        },
        { status: response.status }
      );
    }

    const data = await response.json();

    // Check Twelve Data payload level errors
    if (data.status === 'error' || data.code) {
      if (data.code === 429) {
        return NextResponse.json(
          {
            success: false,
            code: 'RATE_LIMIT_EXCEEDED',
            error:
              data.message ||
              'Twelve Data rate limit exceeded. The free tier allows 8 API credits per minute. Please wait a moment and try again.',
          },
          { status: 429 }
        );
      }

      if (data.code === 401 || data.code === 403) {
        return NextResponse.json(
          {
            success: false,
            code: 'INVALID_API_KEY',
            error: data.message || 'Twelve Data API key is invalid or unauthorized for this instrument.',
          },
          { status: 401 }
        );
      }

      return NextResponse.json(
        {
          success: false,
          code: 'PROVIDER_ERROR',
          error: data.message || 'Twelve Data returned an error for this request.',
          details: data,
        },
        { status: 400 }
      );
    }

    if (!data.values || !Array.isArray(data.values) || data.values.length === 0) {
      return NextResponse.json(
        {
          success: false,
          code: 'NO_DATA',
          error: `No historical candles returned by Twelve Data for ${providerSymbol} on ${providerInterval}.`,
        },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      meta: {
        provider: 'Twelve Data',
        symbol: providerSymbol,
        interval: providerInterval,
        count: data.values.length,
        ...data.meta,
      },
      values: data.values,
    });
  } catch (error: any) {
    return NextResponse.json(
      {
        success: false,
        code: 'INTERNAL_SERVER_ERROR',
        error: error.message || 'An unexpected error occurred while contacting the market data provider.',
      },
      { status: 500 }
    );
  }
}
