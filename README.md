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

## 5. Real Market Data Mode (Twelve Data API)

TradeLab supports dual operational modes: **DEMO MODE** (synthetic procedural market cycles or imported CSV) and **REAL DATA MODE** (Twelve Data API).

### Supported Instruments & Timeframes
- **Gold (`XAU/USD`)** (Twelve Data symbol format: `XAU/USD`)
- **Forex Majors**: `EUR/USD`, `GBP/USD`, `USD/JPY`, `AUD/USD`, `USD/CAD`, `USD/CHF`
- **Timeframes**: `15m` (`15min`) and `1h` (`1h`)

### API Security & Configuration
Twelve Data API keys are strictly stored server-side and never exposed to client-side code:
1. Obtain an API key from [Twelve Data](https://twelvedata.com).
2. Copy `.env.example` to `.env.local`:
   ```bash
   cp .env.example .env.local
   ```
3. Set your API key:
   ```env
   TWELVE_DATA_API_KEY="your_api_key_here"
   ```
4. Client requests flow through the secure server API proxy at `app/api/market-data/route.ts`.
5. **No Silent Synthetic Fallbacks**: If the Twelve Data API is unreachable, quota is exceeded, or key is missing, TradeLab displays an explicit error banner and maintains strict distinction between Real and Demo data.

### Twelve Data Quotas & Caching
- **Free Tier Rate Limits**: 8 API credits per minute, 800 calls per day.
- **IndexedDB Client Caching**: Downloaded real historical candles are cached in IndexedDB (`TradeLab_Cache_v1/real_candles`). Subsequent visits load instantly without consuming API credits.
- **Forming Candle Detection**: The terminal automatically distinguishes between the active, in-progress forming candle and completed closed bars to guarantee zero intra-bar repaint bias.

---

## 6. Execution Costs & Monthly Performance Analytics

In Real Market Data mode, backtests simulate institutional execution parameters:
- **Bid/Ask Spread**: Configurable in pips (e.g. 2.0 pips for Gold).
- **ECN Commission**: Configurable in $/lot (default institutional $7.00/lot round-turn).
- **Execution Slippage**: Configurable in pips (default 0.5 pips).
- **Simultaneous SL/TP Resolution**: Conservative tie-breaker resolves simultaneous touches to Stop Loss first.
- **Monthly Analytics**: Performance breakdown grouped by calendar month (`YYYY-MM`) reporting win rate, net R, and pip gains.

---

## 7. Python & MetaTrader 5 (MT5) Roadmap

While Twelve Data powers real historical data and market analysis inside the web terminal, full automated order execution and tick-level modeling will interface with Python / MT5:
1. **Low-Latency Order Execution**: MetaTrader 5 terminal Python API (`MetaTrader5` package) for direct broker order placement, bracket orders (SL/TP), and position lifecycle management.
2. **Tick Data & DOM Order Book**: Level 2 market depth and tick-by-tick order flow analysis.
3. **Execution Bot Gateway**: A lightweight local FastAPI or WebSocket bridge connecting TradeLab UI triggers to local MT5 accounts.

---

## 8. Known Limitations

1. **Client-Side Compute Boundary**:
   - Backtesting runs synchronously/asynchronously inside the browser's JavaScript engine. Very large datasets (> 100,000 candles) should be downsampled or run in a Web Worker to keep the main UI thread at 60 FPS.
2. **Execution Slippage & Latency**:
   - The simulation assumes fill at exact bar close or open, plus configurable spread. Variable slippage during high-impact news spikes (e.g. NFP, CPI) is not currently modeled with tick-level order book depth.
3. **Multi-Timeframe Gap Handling**:
   - H1 aggregation assumes continuous standard Forex trading hours. Weekend gaps and holiday market closures in custom CSV files are handled chronologically but do not interpolate missing sessions.
