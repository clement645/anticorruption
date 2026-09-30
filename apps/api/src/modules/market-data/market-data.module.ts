import { Global, Module } from '@nestjs/common';
import { MARKET_DATA_ADAPTER } from './market-data.constants';
import { LogOnlyMarketDataAdapter } from './log-only-market-data.adapter';

/**
 * Global so MARKET_DATA_ADAPTER is injectable from any module (RiskModule's
 * PriceAnomalyDetector today) without needing to import MarketDataModule
 * directly — mirrors BlockchainModule/StorageModule/NotificationsModule's
 * own rationale exactly.
 */
@Global()
@Module({
  providers: [
    { provide: MARKET_DATA_ADAPTER, useClass: LogOnlyMarketDataAdapter },
  ],
  exports: [MARKET_DATA_ADAPTER],
})
export class MarketDataModule {}
