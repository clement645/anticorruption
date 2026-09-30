/**
 * Live market-data pricing (post-launch, item 7). Real live pricing
 * requires a third-party market-data provider account this project doesn't
 * have, so — per the same "build as pluggable adapters, log-only for now"
 * decision covering notifications — only a log-only adapter exists today.
 * Business code depends only on this interface, never a concrete provider.
 * See notifications.types.ts for why this lives inside apps/api rather
 * than its own workspace package.
 */

export interface MarketPriceReference {
  price: number;
  currency: string;
  /** e.g. "unit", "kg", "m" — omitted when not meaningful for the query. */
  unit?: string;
  asOf: string;
  source: string;
}

export interface MarketDataAdapter {
  /**
   * Returns an independent reference price for the given item/service
   * description, or `null` if no data is available (the ONLY possible
   * outcome from LogOnlyMarketDataAdapter — this is not an error case).
   */
  getReferencePrice(description: string): Promise<MarketPriceReference | null>;
}
