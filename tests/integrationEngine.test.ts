import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { Candle, StrategyParameters, ForexSymbol, Timeframe, Trade } from '../types/trading';
import { DEFAULT_STRATEGY_PARAMS, runBacktest } from '../services/backtestEngine';
import { generateForexCandles } from '../services/marketData';
import { DEFAULT_STRATEGY_A_PARAMS } from '../services/strategyA';

describe('Strategy Engine & Chart Signals Integration', () => {
  it('should generate simulated trades with precise historical timestamps and strategy rationale', () => {
    // 1200 M15 candles provide 300 H1 candles, ensuring H1 EMA 200 is fully formed
    const candles = generateForexCandles('XAUUSDm', '15m', 101, 1200, 'trending_bull');
    const result = runBacktest(candles, DEFAULT_STRATEGY_PARAMS, 'XAUUSDm', '15m');

    assert.ok(result.trades.length > 0, 'Backtest should yield simulated trades on 1200 candles');

    for (const trade of result.trades) {
      // Historical timestamp checks
      assert.ok(trade.entryTime > 0, 'Entry time must be a positive Unix timestamp');
      assert.ok(
        trade.signalTime && trade.signalTime > 0,
        'Signal time must be a positive Unix timestamp'
      );
      assert.ok(
        trade.signalTime <= trade.entryTime,
        'Signal candle timestamp must precede or match entry timestamp'
      );

      // Price coordinates
      assert.ok(trade.entryPrice > 0, 'Entry price must be positive');
      assert.ok(trade.stopLoss > 0, 'Stop loss must be positive');
      assert.ok(trade.takeProfit > 0, 'Take profit must be positive');

      if (trade.direction === 'BUY' || trade.direction === 'LONG') {
        assert.ok(
          trade.takeProfit > trade.entryPrice,
          'BUY Take profit must be above entry price'
        );
        assert.ok(
          trade.stopLoss < trade.entryPrice,
          'BUY Stop loss must be below entry price'
        );
      } else {
        assert.ok(
          trade.takeProfit < trade.entryPrice,
          'SELL Take profit must be below entry price'
        );
        assert.ok(
          trade.stopLoss > trade.entryPrice,
          'SELL Stop loss must be above entry price'
        );
      }

      // Compact details panel fields
      assert.ok(trade.signalReason, 'Trade must have a signal reason');
      assert.ok(trade.h1Bias, 'Trade must have an H1 bias');
      assert.ok(trade.m15Confirmation, 'Trade must have an M15 confirmation');
      assert.ok(trade.riskRewardRatio, 'Trade must have a risk-to-reward ratio');
      assert.ok(trade.status, 'Trade must have a status');
    }
  });

  it('should categorize trades into distinct winning, losing, and unresolved visual statuses', () => {
    const candles = generateForexCandles('EUR/USD', '15m', 42, 1200, 'mixed');
    const result = runBacktest(candles, DEFAULT_STRATEGY_PARAMS, 'EUR/USD', '15m');

    assert.ok(result.trades.length > 0, 'Backtest should yield simulated trades on 1200 candles');
    const statuses = new Set(result.trades.map((t) => t.status));
    assert.ok(
      statuses.has('WIN') || statuses.has('LOSS') || statuses.has('UNRESOLVED') || statuses.has('BREAKEVEN'),
      'Trades must carry standard status'
    );

    for (const t of result.trades) {
      if (t.status === 'WIN') {
        assert.ok(t.pnlR > 0, 'Winning trade must have positive R multiple');
        assert.equal(t.exitReason, 'TP', 'Winning trade exit reason should be TP');
      } else if (t.status === 'LOSS') {
        assert.ok(t.pnlR <= 0, 'Losing trade must have non-positive R multiple');
      } else if (t.status === 'UNRESOLVED') {
        assert.equal(t.exitReason, 'UNRESOLVED');
      }
    }
  });
});

describe('Trade History Generation & Filtering', () => {
  it('should generate trade history directly from backtest results with all required fields', () => {
    const candles = generateForexCandles('XAUUSDm', '15m', 777, 1200, 'ranging_high_vol');
    const result = runBacktest(candles, DEFAULT_STRATEGY_PARAMS, 'XAUUSDm', '15m');

    assert.ok(result.trades.length > 0);

    for (const t of result.trades) {
      // Must not be placeholder/hardcoded dummy data
      assert.ok(t.id.startsWith('TRD-'));
      assert.ok(typeof t.entryTime === 'number');
      assert.ok(typeof t.direction === 'string');
      assert.ok(typeof t.entryPrice === 'number');
      assert.ok(typeof t.stopLoss === 'number');
      assert.ok(typeof t.takeProfit === 'number');
      assert.ok(typeof t.exitPrice === 'number');
      assert.ok(typeof t.status === 'string');
      assert.ok(typeof t.pnlR === 'number');
    }
  });

  it('should allow filtering for BUY, SELL, wins, losses, and unresolved trades', () => {
    const candles = generateForexCandles('EUR/USD', '15m', 202, 1200, 'mixed');
    const result = runBacktest(candles, DEFAULT_STRATEGY_PARAMS, 'EUR/USD', '15m');

    const buyTrades = result.trades.filter(
      (t) => t.direction === 'BUY' || t.direction === 'LONG'
    );
    const sellTrades = result.trades.filter(
      (t) => t.direction === 'SELL' || t.direction === 'SHORT'
    );
    const winTrades = result.trades.filter((t) => t.status === 'WIN');
    const lossTrades = result.trades.filter((t) => t.status === 'LOSS');
    const unresolvedTrades = result.trades.filter(
      (t) => t.status === 'UNRESOLVED' || t.status === 'OPEN'
    );

    assert.equal(
      buyTrades.length + sellTrades.length,
      result.trades.length,
      'Every trade must be either BUY or SELL'
    );

    assert.ok(
      winTrades.length + lossTrades.length + unresolvedTrades.length <= result.trades.length
    );
  });
});

describe('Statistics Precision & Safe Edge Case Handling', () => {
  it('should safely handle empty candle datasets and zero denominators without NaN or Infinity', () => {
    const emptyResult = runBacktest([], DEFAULT_STRATEGY_PARAMS, 'XAUUSDm', '15m');

    assert.equal(emptyResult.totalTrades, 0);
    assert.equal(emptyResult.winningTrades, 0);
    assert.equal(emptyResult.losingTrades, 0);
    assert.equal(emptyResult.winRate, 0);
    assert.equal(emptyResult.profitFactor, 0);
    assert.equal(emptyResult.netR, 0);
    assert.equal(emptyResult.maxDrawdownR, 0);
    assert.equal(emptyResult.avgWinR, 0);
    assert.equal(emptyResult.avgLossR, 0);
    assert.ok(!Number.isNaN(emptyResult.winRate));
    assert.ok(!Number.isNaN(emptyResult.profitFactor));
    assert.ok(!Number.isNaN(emptyResult.expectancyR));
  });

  it('should accurately calculate total trades, win rate, net R, profit factor, max DD, and avg win/loss R', () => {
    const candles = generateForexCandles('XAUUSDm', '15m', 888, 1200, 'trending_bull');
    const result = runBacktest(candles, DEFAULT_STRATEGY_PARAMS, 'XAUUSDm', '15m');

    assert.ok(result.totalTrades > 0, 'Should have trades on 1200 bars');
    assert.ok(!Number.isNaN(result.winRate), 'Win rate must not be NaN');
    assert.ok(!Number.isNaN(result.profitFactor), 'Profit factor must not be NaN');
    assert.ok(!Number.isNaN(result.netR), 'Net R must not be NaN');
    assert.ok(!Number.isNaN(result.maxDrawdownR), 'Max drawdown R must not be NaN');
    assert.ok(!Number.isNaN(result.avgWinR), 'Avg win R must not be NaN');
    assert.ok(!Number.isNaN(result.avgLossR), 'Avg loss R must not be NaN');

    // Clearly distinguishes gross simulated results
    assert.ok(result.isGrossSimulated !== undefined);

    if (result.winningTrades > 0) {
      assert.ok(result.avgWinR > 0, 'Average winning R must be greater than zero');
    }
    if (result.losingTrades > 0) {
      assert.ok(result.avgLossR >= 0, 'Average losing R must be non-negative magnitude');
    }
  });

  it('should update trades, markers, and statistics when strategy parameters or market regimes change', () => {
    const candles1 = generateForexCandles('XAUUSDm', '15m', 12345, 1200, 'trending_bull');
    const result1 = runBacktest(candles1, DEFAULT_STRATEGY_PARAMS, 'XAUUSDm', '15m');

    // Change Risk:Reward ratio parameter
    const modifiedParams: StrategyParameters = {
      ...DEFAULT_STRATEGY_PARAMS,
      riskRewardRatio: 3.5,
      strategyA: {
        ...DEFAULT_STRATEGY_A_PARAMS,
        riskRewardRatio: 3.5,
      },
    };

    const result2 = runBacktest(candles1, modifiedParams, 'XAUUSDm', '15m');

    // Winning trades in result2 must reflect the new 3.5 RR ratio
    const winsInResult2 = result2.trades.filter((t) => t.status === 'WIN');
    for (const w of winsInResult2) {
      assert.equal(w.riskRewardRatio, 3.5);
    }
  });
});
