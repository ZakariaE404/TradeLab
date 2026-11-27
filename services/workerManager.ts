import { BacktestResult, Candle, ForexSymbol, StrategyParameters, Timeframe } from '@/types/trading';
import { DukascopyTimeframe } from '@/types/historicalData';
import { runBacktest } from './backtestEngine';
import { getOrComputeDerivedTimeframe } from './timeframeAggregator';
import type { BacktestWorkerRequest, BacktestWorkerResponse } from '@/workers/backtest.worker';
import type { AggregationWorkerRequest, AggregationWorkerResponse } from '@/workers/aggregation.worker';

export class JobCancelledError extends Error {
  constructor(message: string = 'Worker job cancelled') {
    super(message);
    this.name = 'JobCancelledError';
  }
}

export function isJobCancelledError(err: unknown): boolean {
  return err instanceof JobCancelledError || (err instanceof Error && err.name === 'JobCancelledError');
}

interface PendingJob<T> {
  jobId: number;
  resolve: (value: T) => void;
  reject: (reason: Error) => void;
  cleanup: () => void;
}

let backtestJobCounter = 0;
let backtestWorker: Worker | null = null;
let activeBacktestJob: PendingJob<BacktestResult> | null = null;

let aggregationJobCounter = 0;
let aggregationWorker: Worker | null = null;
let activeAggregationJob: PendingJob<Candle[]> | null = null;

function terminateBacktestWorker(): void {
  if (backtestWorker) {
    backtestWorker.terminate();
    backtestWorker = null;
  }
}

function terminateAggregationWorker(): void {
  if (aggregationWorker) {
    aggregationWorker.terminate();
    aggregationWorker = null;
  }
}

function getOrCreateBacktestWorker(): Worker {
  if (!backtestWorker) {
    backtestWorker = new Worker(new URL('../workers/backtest.worker.ts', import.meta.url));
  }
  return backtestWorker;
}

function getOrCreateAggregationWorker(): Worker {
  if (!aggregationWorker) {
    aggregationWorker = new Worker(new URL('../workers/aggregation.worker.ts', import.meta.url));
  }
  return aggregationWorker;
}

/**
 * Executes runBacktest off the main UI thread in a dedicated Web Worker.
 * Automatically terminates any superseded in-flight backtest job to keep limited-resource PCs responsive.
 */
export function runBacktestInWorker(
  candles: Candle[],
  params: StrategyParameters,
  symbol: ForexSymbol,
  timeframe: Timeframe,
  providedH1Candles?: Candle[] | null,
  dataSourceDescription?: string,
  signal?: AbortSignal
): Promise<BacktestResult> {
  if (signal?.aborted) {
    return Promise.reject(new JobCancelledError());
  }

  // Fallback for SSR / Node.js test environments where Worker is unavailable
  if (typeof Worker === 'undefined') {
    return Promise.resolve(
      runBacktest(candles, params, symbol, timeframe, providedH1Candles, dataSourceDescription)
    );
  }

  // Immediately terminate any outdated running backtest so CPU isn't wasted
  if (activeBacktestJob) {
    const stale = activeBacktestJob;
    activeBacktestJob = null;
    stale.cleanup();
    stale.reject(new JobCancelledError('Superseded by newer backtest job'));
    terminateBacktestWorker();
  }

  const jobId = ++backtestJobCounter;
  const worker = getOrCreateBacktestWorker();

  return new Promise<BacktestResult>((resolve, reject) => {
    const onAbort = () => {
      if (activeBacktestJob && activeBacktestJob.jobId === jobId) {
        activeBacktestJob = null;
        cleanup();
        terminateBacktestWorker();
        reject(new JobCancelledError());
      }
    };

    const onMessage = (event: MessageEvent<BacktestWorkerResponse>) => {
      const msg = event.data;
      if (!msg || msg.jobId !== jobId) return;

      if (activeBacktestJob && activeBacktestJob.jobId === jobId) {
        activeBacktestJob = null;
      }
      cleanup();

      if (msg.error) {
        reject(new Error(msg.error));
      } else if (msg.result) {
        resolve(msg.result);
      } else {
        reject(new Error('Backtest worker returned empty response'));
      }
    };

    const onError = (event: ErrorEvent) => {
      if (activeBacktestJob && activeBacktestJob.jobId === jobId) {
        activeBacktestJob = null;
      }
      cleanup();
      terminateBacktestWorker();
      reject(new Error(event.message || 'Backtest worker error'));
    };

    const cleanup = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      signal?.removeEventListener('abort', onAbort);
    };

    activeBacktestJob = { jobId, resolve, reject, cleanup };
    signal?.addEventListener('abort', onAbort, { once: true });
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);

    const request: BacktestWorkerRequest = {
      jobId,
      candles,
      params,
      symbol,
      timeframe,
      providedH1Candles,
      dataSourceDescription,
    };
    worker.postMessage(request);
  });
}

/**
 * Computes or retrieves derived timeframe candles from IndexedDB inside a Web Worker.
 * Terminates any superseded aggregation job on cancellation.
 */
export function getOrComputeDerivedTimeframeInWorker(
  symbol: string,
  timeframe: Timeframe | DukascopyTimeframe | string,
  fromSec?: number,
  toSec?: number,
  signal?: AbortSignal
): Promise<Candle[]> {
  if (signal?.aborted) {
    return Promise.reject(new JobCancelledError());
  }

  if (typeof Worker === 'undefined') {
    return getOrComputeDerivedTimeframe(symbol, timeframe, fromSec, toSec);
  }

  if (activeAggregationJob) {
    const stale = activeAggregationJob;
    activeAggregationJob = null;
    stale.cleanup();
    stale.reject(new JobCancelledError('Superseded by newer aggregation job'));
    terminateAggregationWorker();
  }

  const jobId = ++aggregationJobCounter;
  const worker = getOrCreateAggregationWorker();

  return new Promise<Candle[]>((resolve, reject) => {
    const onAbort = () => {
      if (activeAggregationJob && activeAggregationJob.jobId === jobId) {
        activeAggregationJob = null;
        cleanup();
        terminateAggregationWorker();
        reject(new JobCancelledError());
      }
    };

    const onMessage = (event: MessageEvent<AggregationWorkerResponse>) => {
      const msg = event.data;
      if (!msg || msg.jobId !== jobId) return;

      if (activeAggregationJob && activeAggregationJob.jobId === jobId) {
        activeAggregationJob = null;
      }
      cleanup();

      if (msg.error) {
        reject(new Error(msg.error));
      } else {
        resolve(msg.candles || []);
      }
    };

    const onError = (event: ErrorEvent) => {
      if (activeAggregationJob && activeAggregationJob.jobId === jobId) {
        activeAggregationJob = null;
      }
      cleanup();
      terminateAggregationWorker();
      reject(new Error(event.message || 'Aggregation worker error'));
    };

    const cleanup = () => {
      worker.removeEventListener('message', onMessage);
      worker.removeEventListener('error', onError);
      signal?.removeEventListener('abort', onAbort);
    };

    activeAggregationJob = { jobId, resolve, reject, cleanup };
    signal?.addEventListener('abort', onAbort, { once: true });
    worker.addEventListener('message', onMessage);
    worker.addEventListener('error', onError);

    const request: AggregationWorkerRequest = {
      jobId,
      symbol,
      timeframe,
      fromSec,
      toSec,
    };
    worker.postMessage(request);
  });
}
