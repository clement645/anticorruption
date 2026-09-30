import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';
import { RiskAlertsService } from './risk-alerts.service';
import { MARKET_DATA_ADAPTER } from '../../market-data/market-data.constants';
import type { MarketDataAdapter } from '../../market-data/market-data.types';
import type { DetectionResult } from '../risk.types';
import type { EnvConfig } from '../../../config/env.validation';
import {
  PRICE_ANOMALY_ESTIMATE_DEVIATION_THRESHOLD,
  PRICE_ANOMALY_MIN_BIDS_FOR_ZSCORE,
  PRICE_ANOMALY_Z_SCORE_HIGH,
  PRICE_ANOMALY_Z_SCORE_MEDIUM,
} from '../risk.constants';

/**
 * Flags individual bids that are statistical outliers against their lot's
 * peer bids (a genuine z-score, once there are enough bids for one to be
 * meaningful), or — with too few bids for that — bids that deviate sharply
 * from the lot's own pre-tender estimate. Amounts are converted to plain
 * JS numbers for this statistical computation; unlike Phase 5's ledger
 * arithmetic, this is a heuristic score, not money actually moving, so
 * float imprecision here is immaterial.
 *
 * Each bid's z-score is computed **leave-one-out** — against the mean/
 * stddev of the *other* bids on the lot, not the full set including
 * itself. A naive population z-score (computed from all bids, outlier
 * included) suffers from "masking": one extreme outlier inflates its own
 * reference stddev enough to lower its own z-score, sometimes hiding
 * exactly the anomaly being searched for, worse with smaller samples.
 * This was caught empirically during Phase 8 manual smoke testing (a
 * 200,000 bid alongside three ~990,000 bids scored |z|≈1.7 — below the
 * MEDIUM threshold — under the naive approach) and fixed by scoring each
 * bid against its peers rather than against a population it's a member of.
 *
 * Post-launch (item 7) adds one more, orthogonal check: the peer-bid
 * z-score above only catches a bid that stands out AMONG this lot's OWN
 * bidders — it cannot catch every bidder colluding to submit similarly
 * inflated prices, since there would be no outlier relative to that
 * (rigged) peer set. Comparing the lot's own pre-tender ESTIMATE against
 * an independent live market reference price closes exactly that gap —
 * see evaluateMarketPriceDeviation() below. Only ever fires once a real
 * MarketDataAdapter is plugged in (the default LogOnlyMarketDataAdapter
 * always returns null, so this is a no-op today — see market-data.module.ts).
 */
@Injectable()
export class PriceAnomalyDetector {
  private readonly logger = new Logger(PriceAnomalyDetector.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly riskAlertsService: RiskAlertsService,
    @Inject(MARKET_DATA_ADAPTER)
    private readonly marketDataAdapter: MarketDataAdapter,
    private readonly config: ConfigService<EnvConfig, true>,
  ) {}

  async evaluateLot(tenderLotId: string): Promise<void> {
    try {
      const lot = await this.prisma.tenderLot.findUnique({
        where: { id: tenderLotId },
        include: { bids: true },
      });
      if (!lot) {
        return;
      }

      // Independent of bid count/existence — this compares the lot's own
      // estimate against a live market reference, not against its bids.
      await this.evaluateMarketPriceDeviation(
        lot.id,
        lot.description,
        Number(lot.estimatedAmount),
      );

      if (lot.bids.length === 0) {
        return;
      }

      const amounts = lot.bids.map((b) => Number(b.amount));
      const n = amounts.length;

      for (const [index, bid] of lot.bids.entries()) {
        const amount = amounts[index];
        const peers = amounts.filter((_, i) => i !== index);
        let result: DetectionResult | null = null;

        if (n >= PRICE_ANOMALY_MIN_BIDS_FOR_ZSCORE) {
          const peerMean = peers.reduce((sum, a) => sum + a, 0) / peers.length;
          const peerVariance =
            peers.reduce((sum, a) => sum + (a - peerMean) ** 2, 0) /
            peers.length;
          const peerStddev = Math.sqrt(peerVariance);

          if (peerStddev > 0) {
            const z = (amount - peerMean) / peerStddev;
            if (Math.abs(z) >= PRICE_ANOMALY_Z_SCORE_HIGH) {
              result = this.buildResult(
                'HIGH',
                bid.id,
                amount,
                peerMean,
                peerStddev,
                z,
                lot.estimatedAmount.toString(),
              );
            } else if (Math.abs(z) >= PRICE_ANOMALY_Z_SCORE_MEDIUM) {
              result = this.buildResult(
                'MEDIUM',
                bid.id,
                amount,
                peerMean,
                peerStddev,
                z,
                lot.estimatedAmount.toString(),
              );
            }
          }
        }

        if (!result && n < PRICE_ANOMALY_MIN_BIDS_FOR_ZSCORE) {
          const estimate = Number(lot.estimatedAmount);
          const deviation =
            estimate > 0 ? Math.abs(amount - estimate) / estimate : 0;
          if (deviation > PRICE_ANOMALY_ESTIMATE_DEVIATION_THRESHOLD) {
            result = {
              severity: 'MEDIUM',
              title: `Bid deviates sharply from the tender estimate`,
              description: `Bid amount ${amount} deviates by ${(deviation * 100).toFixed(1)}% from the lot's estimated amount ${estimate} — too few peer bids (${n}) for a statistical comparison.`,
              evidence: {
                bidId: bid.id,
                amount,
                estimatedAmount: estimate,
                deviationFraction: deviation,
                peerBidCount: n,
              },
            };
          }
        }

        if (result) {
          await this.riskAlertsService.raiseAlert(
            'PRICE_ANOMALY',
            'Bid',
            bid.id,
            result,
          );
        }
      }
    } catch (error) {
      // A detector must never break the business action that triggered it
      // (tender close) — log and move on, same principle as the audit
      // guard's "logging must never itself become the reason a security
      // decision fails to be enforced" (see PermissionsGuard).
      this.logger.error(
        `Price anomaly detection failed for lot ${tenderLotId}`,
        error,
      );
    }
  }

  /**
   * The one check in this detector that never looks at bids — see the
   * class doc comment for why this catches a pattern the peer-bid z-score
   * structurally cannot (every bidder colluding to submit similarly
   * inflated prices). A separate try/catch from evaluateLot()'s own: a
   * market-data lookup failure must never prevent the peer-bid/estimate
   * checks below it from still running.
   */
  private async evaluateMarketPriceDeviation(
    tenderLotId: string,
    description: string,
    estimatedAmount: number,
  ): Promise<void> {
    try {
      const reference =
        await this.marketDataAdapter.getReferencePrice(description);
      if (!reference || reference.price <= 0) {
        return;
      }

      const deviation =
        Math.abs(estimatedAmount - reference.price) / reference.price;
      const threshold = this.config.get(
        'RISK_MARKET_PRICE_DEVIATION_THRESHOLD',
        {
          infer: true,
        },
      );
      if (deviation <= threshold) {
        return;
      }

      const severity = deviation > threshold * 2 ? 'HIGH' : 'MEDIUM';
      await this.riskAlertsService.raiseAlert(
        'MARKET_PRICE_DEVIATION',
        'TenderLot',
        tenderLotId,
        {
          severity,
          title: 'Tender estimate deviates from live market reference price',
          description:
            `This lot's estimated amount ${estimatedAmount} deviates by ` +
            `${(deviation * 100).toFixed(1)}% from an independent market reference ` +
            `price of ${reference.price} ${reference.currency} (source: ${reference.source}, as of ${reference.asOf}).`,
          evidence: {
            tenderLotId,
            estimatedAmount,
            referencePrice: reference.price,
            referenceCurrency: reference.currency,
            referenceSource: reference.source,
            referenceAsOf: reference.asOf,
            deviationFraction: deviation,
            thresholdFraction: threshold,
          },
        },
      );
    } catch (error) {
      this.logger.error(
        `Market price deviation check failed for lot ${tenderLotId}`,
        error,
      );
    }
  }

  private buildResult(
    severity: 'MEDIUM' | 'HIGH',
    bidId: string,
    amount: number,
    mean: number,
    stddev: number,
    z: number,
    estimatedAmount: string,
  ): DetectionResult {
    return {
      severity,
      title: 'Statistically anomalous bid amount',
      description: `Bid amount ${amount} is ${Math.abs(z).toFixed(2)} standard deviations from the peer-bid mean ${mean.toFixed(2)} on this lot.`,
      evidence: { bidId, amount, mean, stddev, zScore: z, estimatedAmount },
    };
  }
}
