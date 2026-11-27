/// <reference lib="webworker" />

import { getOrComputeDerivedTimeframe } from '@/services/timeframeAggregator';
import { DukascopyTimeframe } from '@/types/historicalData';
import { Candle, Timeframe } from '@/types/trading';

export interface AggregationWorkerRequest {
  jobId: number;
  symbol: string;
  timeframe: Timeframe | DukascopyTimeframe | string;
  fromSec?: number;
  toSec?: number;
}

export interface AggregationWorkerResponse {
  jobId: number;
  candles?: Candle[];
  error?: string;
}

self.onmessage = async (event: MessageEvent<AggregationWorkerRequest>) => {
  const { jobId, symbol, timeframe, fromSec, toSec } = event.data;

  try {
    const candles = await getOrComputeDerivedTimeframe(symbol, timeframe, fromSec, toSec);
    const response: AggregationWorkerResponse = { jobId, candles };
    self.postMessage(response);
  } catch (err) {
    const response: AggregationWorkerResponse = {
      jobId,
      error: err instanceof Error ? err.message : 'Aggregation worker execution failed',
    };
    self.postMessage(response);
  }
};
