/// <reference lib="webworker" />

import { runBacktest } from '@/services/backtestEngine';
import { BacktestResult, Candle, ForexSymbol, StrategyParameters, Timeframe } from '@/types/trading';

export interface BacktestWorkerRequest {
  jobId: number;
  candles: Candle[];
  params: StrategyParameters;
  symbol: ForexSymbol;
  timeframe: Timeframe;
  providedH1Candles?: Candle[] | null;
  dataSourceDescription?: string;
}

export interface BacktestWorkerResponse {
  jobId: number;
  result?: BacktestResult;
  error?: string;
}

self.onmessage = (event: MessageEvent<BacktestWorkerRequest>) => {
  const { jobId, candles, params, symbol, timeframe, providedH1Candles, dataSourceDescription } =
    event.data;

  try {
    const result = runBacktest(
      candles,
      params,
      symbol,
      timeframe,
      providedH1Candles,
      dataSourceDescription
    );
    const response: BacktestWorkerResponse = { jobId, result };
    self.postMessage(response);
  } catch (err) {
    const response: BacktestWorkerResponse = {
      jobId,
      error: err instanceof Error ? err.message : 'Backtest worker execution failed',
    };
    self.postMessage(response);
  }
};
