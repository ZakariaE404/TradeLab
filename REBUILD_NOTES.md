# TradeLab rebuild - first integrity pass

## Changes in this pass

- H1 aggregation now accepts only complete, correctly aligned groups of four M15 candles. Partial hourly buckets are no longer treated as closed H1 candles.
- EMA calculations retain full floating-point precision instead of rounding every intermediate value to five decimals.
- H1 directional bias now includes EMA50 slope over a configurable number of closed H1 bars (default: five). The old HH/HL structure requirement is disabled by default; it remains an optional filter.
- Real-data backtests now receive closed M15 candles only, not the currently forming candle.
- Real H1 history requests now include at least 500 bars (within provider limits) so EMA200 has warm-up history.
- Demo M15 history was increased to 2,000 candles, yielding up to 500 complete H1 bars for EMA warm-up.
- Entry is executed at the next M15 candle open, not at the signal candle close. The signal is skipped if no next candle exists.
- Resolved Strategy A trades now have configured spread, entry/exit slippage, and estimated round-turn commission deducted from net pips/R/PnL. Gold and non-USD quote pip values are estimates and should be calibrated against the broker contract specifications.
- Existing saved nested strategy settings are merged with defaults so the new slope setting is populated for older local settings.

## Not finished yet

This is the data/execution integrity foundation, not the completed strategy experiment matrix. The next engine pass still needs separate testable implementations for:

- Trending vs ranging regime classification (with an explicit ADX definition and thresholds)
- Rejection vs engulfing confirmations
- Swing-based vs ATR-based stops
- Independent BUY and SELL experiment results
- Out-of-sample / walk-forward evaluation and richer per-configuration analytics

## Validation status

A full install/build/test run could not be completed in this environment because dependency installation timed out. A global TypeScript check was attempted, but the project dependencies and type declarations (Next.js, React, Node types) were unavailable; it therefore reported many missing-module/JSX errors. The edited service files did not show additional service-level TypeScript errors in the filtered output. Run `npm ci`, `npm test`, and `npm run build` locally before deploying.
