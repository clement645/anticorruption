import { Injectable, Logger } from '@nestjs/common';
import type {
  MarketDataAdapter,
  MarketPriceReference,
} from './market-data.types';

/**
 * The only MarketDataAdapter this deployment has — see market-data.types.ts
 * for why. Never contacts any real pricing provider; logs what WOULD have
 * been queried and always returns `null` ("no data available"), which is
 * the honest, correct answer when no provider is configured — never a
 * fabricated or estimated figure standing in for real market data.
 * MarketPriceDeviationDetector's whole check is a no-op end to end until a
 * real adapter replaces this one.
 */
@Injectable()
export class LogOnlyMarketDataAdapter implements MarketDataAdapter {
  private readonly logger = new Logger(LogOnlyMarketDataAdapter.name);

  getReferencePrice(description: string): Promise<MarketPriceReference | null> {
    this.logger.debug(
      `[LOG-ONLY] Would query live market pricing for "${description}" — ` +
        'no live market-data provider is configured.',
    );
    return Promise.resolve(null);
  }
}
