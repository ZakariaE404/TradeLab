import { StrategyRegistry } from './core/StrategyRegistry';
import { Strategy001 } from './implementations/strategy001';
import { Strategy002 } from './implementations/strategy002';

// 1. Register canonical built-in strategies
StrategyRegistry.registerStrategy(Strategy001, ['strategy_a']);
StrategyRegistry.registerStrategy(Strategy002);

// 2. Export Core Types & Interfaces
export * from './core/StrategyTypes';
export * from './core/StrategyDefinition';
export * from './core/StrategyContext';
export * from './core/StrategyRegistry';
export * from './core/StrategyExecutor';

// 3. Export Implementations
export { Strategy001 } from './implementations/strategy001';
export { Strategy002 } from './implementations/strategy002';
export { MyStrategyTemplate } from './templates/strategyTemplate';
