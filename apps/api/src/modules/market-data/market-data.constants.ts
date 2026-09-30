/**
 * DI token for the active MarketDataAdapter. Business code injects this
 * token, never a concrete adapter class — mirrors BLOCKCHAIN_ADAPTER/
 * OBJECT_STORAGE_ADAPTER/NOTIFICATION_ADAPTER: swapping
 * `LogOnlyMarketDataAdapter` for a future real provider is a one-line
 * change to the provider in market-data.module.ts.
 */
export const MARKET_DATA_ADAPTER = Symbol('MARKET_DATA_ADAPTER');
