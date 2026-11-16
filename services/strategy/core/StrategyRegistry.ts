import { StrategyDefinition } from './StrategyDefinition';

class StrategyRegistryClass {
  private strategies: Map<string, StrategyDefinition> = new Map();
  private aliases: Map<string, string> = new Map();

  /**
   * Registers a modular strategy implementation into the central registry
   */
  public registerStrategy(strategy: StrategyDefinition, aliases: string[] = []): void {
    if (!strategy.id) {
      throw new Error('[StrategyRegistry] Cannot register strategy without an id.');
    }

    this.strategies.set(strategy.id, strategy);

    for (const alias of aliases) {
      this.aliases.set(alias, strategy.id);
    }
  }

  /**
   * Retrieves a registered strategy by id or alias
   */
  public getStrategy(id: string): StrategyDefinition | undefined {
    if (!id) return undefined;
    const direct = this.strategies.get(id);
    if (direct) return direct;

    const resolvedId = this.aliases.get(id);
    if (resolvedId) {
      return this.strategies.get(resolvedId);
    }

    return undefined;
  }

  /**
   * Checks if a strategy is active and validated for execution.
   */
  public isStrategyValidated(id: string): boolean {
    const strat = this.getStrategy(id);
    if (!strat) return false;
    return strat.status === 'active' || strat.status === 'validated';
  }

  /**
   * Asserts that a strategy exists and is validated for execution.
   * Throws an explicit error if the strategy is disabled or unvalidated.
   */
  public assertStrategyExecutable(id: string): StrategyDefinition {
    const strat = this.getStrategy(id);
    if (!strat) {
      throw new Error(`[StrategyRegistry] Strategy "${id}" is not registered.`);
    }
    if (strat.status === 'disabled' || strat.status === 'not_validated') {
      throw new Error(
        `[StrategyRegistry] Strategy "${strat.name}" (${strat.id}) is Disabled / Not Validated. ${strat.statusMessage || 'Only Strategy 001 is active pending validation.'}`
      );
    }
    return strat;
  }

  /**
   * Returns all registered strategies as an array
   */
  public getAllStrategies(): StrategyDefinition[] {
    return Array.from(this.strategies.values());
  }

  /**
   * Returns only active and validated strategies
   */
  public getActiveStrategies(): StrategyDefinition[] {
    return Array.from(this.strategies.values()).filter(
      (s) => s.status === 'active' || s.status === 'validated'
    );
  }

  /**
   * Checks if a strategy is registered under an id or alias
   */
  public hasStrategy(id: string): boolean {
    return this.strategies.has(id) || this.aliases.has(id);
  }

  /**
   * Unregisters a strategy (mainly for testing)
   */
  public unregisterStrategy(id: string): void {
    this.strategies.delete(id);
    for (const [alias, target] of this.aliases.entries()) {
      if (target === id) {
        this.aliases.delete(alias);
      }
    }
  }

  /**
   * Clears registry
   */
  public clear(): void {
    this.strategies.clear();
    this.aliases.clear();
  }
}

export const StrategyRegistry = new StrategyRegistryClass();
