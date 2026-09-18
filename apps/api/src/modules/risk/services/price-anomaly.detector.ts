import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { RiskAlertsService } from './risk-alerts.service';
import type { DetectionResult } from '../risk.types';
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
 */
@Injectable()
export class PriceAnomalyDetector {
  private readonly logger = new Logger(PriceAnomalyDetector.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly riskAlertsService: RiskAlertsService,
  ) {}

  async evaluateLot(tenderLotId: string): Promise<void> {
    try {
      const lot = await this.prisma.tenderLot.findUnique({
        where: { id: tenderLotId },
        include: { bids: true },
      });
      if (!lot || lot.bids.length === 0) {
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
