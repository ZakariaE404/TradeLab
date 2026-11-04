# TradeLab - Forex Backtesting & Strategy Engine

TradeLab is a high-performance, client-side Forex backtesting terminal and visual chart analysis platform built with **Next.js (App Router)**, **TypeScript**, **Tailwind CSS**, and **TradingView Lightweight Charts (v5)**.

---

## 1. How to Run the Application

### Prerequisites
- **Node.js**: v20 or higher
- **npm** or **bun**

### Installation & Development
```bash
# 1. Install dependencies
npm install

# 2. Run local development server
npm run dev

# 3. Open terminal in browser
http://localhost:3000
```

### Production Build & Test Execution
```bash
# Run all automated tests (38 tests across 15 suites)
npm test

# Build production bundle
npm run build

# Start production server
npm start
```

---

## 2. Where Demo Data is Generated

All synthetic and demo candlestick data generation lives in:
- **[`services/marketData.ts`](file:///F:/DEIDARA/Projects/TradeLab/services/marketData.ts)**

### Mechanics:
- `generateForexCandles(symbol, timeframe, seed, barCount, regime)` creates deterministic OHLCV bars using a Mulberry32 PRNG.
- Fixed baseline Unix timestamp (`1730505600`) guarantees 100% hydration match between SSR and client.
- Supports 4 market regimes:
  - `mixed`: Realistic alternating mini-trends and consolidations.
  - `trending_bull`: Strong bullish drift with shallow pullbacks.
  - `trending_bear`: Strong bearish selloff with lower highs.
  - `ranging_high_vol`: High volatility mean-reverting chop.
- `validateCandles(candles)` validates chronological integrity and strict OHLC bounds.

---

## 3. Where Strategy Rules Live

Strategy definitions and simulation engines are organized modularly:

- **Primary Engine (`Strategy A`)**:
  - **[`services/strategyA.ts`](file:///F:/DEIDARA/Projects/TradeLab/services/strategyA.ts)**:
    - **Multi-timeframe synchronization**: Aggregates M15 into H1 bars without lookahead (`aggregateM15ToH1`, `getLatestClosedH1Index`).
    - **H1 Trend Filter**: Evaluates H1 EMA 50/200 and structural Higher Highs / Higher Lows (`evaluateH1Trend`, `evaluateMarketStructure`).
    - **Confirmed Swing Points**: Requires $N$ subsequent bars before swings are confirmed (`detectConfirmedSwings`), eliminating future-data leakage.
    - **M15 Rejection & Zone**: Computes wick ratios ($\ge 35\%$) and tests against M15 EMA 50 / swing support/resistance (`evaluateRejectionCandle`, `evaluateSupportResistanceZone`).
    - **Execution & Conservative Resolution**: Signals generated on close of bar $i$, entered at open of bar $i+1$. Conservative simultaneous SL & TP hit resolves to Stop Loss first to eliminate optimistic bias.

- **Unified Backtesting Engine & Presets**:
  - **[`services/backtestEngine.ts`](file:///F:/DEIDARA/Projects/TradeLab/services/backtestEngine.ts)**:
    - Orchestrates backtest execution for Strategy A, EMA Pullback, Breakout Channel, and RSI Mean Reversion.
    - Computes R-multiples, Net R, Max Drawdown in R, Win Rate, Profit Factor, and Equity Curve progression.

- **Mathematical Indicators**:
  - **[`services/indicators.ts`](file:///F:/DEIDARA/Projects/TradeLab/services/indicators.ts)**:
    - `calculateSMA`, `calculateEMA`, `calculateATR`, `calculateRSI`, `calculateBollingerBands`.

---

## 4. How to Add Another Strategy

To add a new strategy (e.g. `Strategy B: SuperTrend + Volume Delta`):

1. **Define Strategy Types & Parameters**:
   In `types/trading.ts`, extend `StrategyType` and add any custom fields to `StrategyParameters`:
   ```typescript
   export type StrategyType = 'strategy_a' | 'ema_pullback' | 'breakout_retest' | 'rsi_mean_reversion' | 'my_new_strategy';
   ```

2. **Implement Strategy Logic**:
   Create `services/myNewStrategy.ts` exporting:
   ```typescript
   export function runMyNewStrategyBacktest(candles: Candle[], params: MyStrategyParams): BacktestResult { ... }
   ```

3. **Register in the Backtest Router**:
   In `services/backtestEngine.ts`:
   - Add the preset to `STRATEGY_PRESETS`.
   - Add a branch in `runBacktest()`:
     ```typescript
     if (params.strategyType === 'my_new_strategy') {
       return runMyNewStrategyBacktest(candles, params);
     }
     ```

4. **Add Cache Invalidation Keys**:
   In `services/cacheService.ts`, add the strategy's parameters to `relevantParams` in `getBacktestCacheKey()` so changes to strategy inputs instantly invalidate cached calculations.

5. **Expose Settings in UI**:
   In `components/settings/StrategySettingsDrawer.tsx`, add UI controls for the new parameters.

---

## 5. How to Replace Demo Data with a Real Market-Data Provider

The architecture is built with an abstraction layer that allows dropping in live or historical broker feeds (e.g. MetaTrader 5, OANDA, Interactive Brokers, TwelveData, Polygon.io):

1. **Standard Candle Schema**:
   All charting, indicator calculations, and backtests consume the uniform schema defined in `types/trading.ts`:
   ```typescript
   export interface Candle {
     time: number;   // Unix epoch seconds
     open: number;
     high: number;
     low: number;
     close: number;
     volume: number;
   }
   ```

2. **Replace the Candle Source in `app/page.tsx`**:
   Currently, demo candles are loaded via `generateForexCandles` or custom CSV upload.
   To connect an external API provider:
   ```typescript
   // Example service adapter: services/liveMarketData.ts
   export async function fetchLiveForexCandles(symbol: string, timeframe: string): Promise<Candle[]> {
     const response = await fetch(`/api/market-data?symbol=${symbol}&tf=${timeframe}`);
     const raw = await response.json();
     return raw.map((b: any) => ({
       time: Math.floor(new Date(b.timestamp).getTime() / 1000),
       open: Number(b.open),
       high: Number(b.high),
       low: Number(b.low),
       close: Number(b.close),
       volume: Number(b.volume || 1),
     }));
   }
   ```

3. **Offline Caching**:
   `services/cacheService.ts` already stores candle arrays in IndexedDB (`TradeLab_Cache_v1/candles`). Once fetched from a real market API, bars are automatically cached locally so users do not burn API quotas on repeated page loads.

---

## 6. Known Limitations

1. **Client-Side Compute Boundary**:
   - Backtesting runs synchronously/asynchronously inside the browser's JavaScript engine. Very large datasets (> 100,000 candles) should be downsampled or run in a Web Worker to keep the main UI thread at 60 FPS.
2. **Execution Slippage & Latency**:
   - The simulation assumes fill at exact bar close or open, plus configurable spread. Variable slippage during high-impact news spikes (e.g. NFP, CPI) is not currently modeled with tick-level order book depth.
3. **Multi-Timeframe Gap Handling**:
   - H1 aggregation assumes continuous standard Forex trading hours. Weekend gaps and holiday market closures in custom CSV files are handled chronologically but do not interpolate missing sessions.
