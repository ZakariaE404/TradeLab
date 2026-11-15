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
   * Returns all registered strategies as an array
   */
  public getAllStrategies(): StrategyDefinition[] {
    return Array.from(this.strategies.values());
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
