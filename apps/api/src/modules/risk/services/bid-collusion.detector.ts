import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { RiskAlertsService } from './risk-alerts.service';
import type { DetectionResult } from '../risk.types';
import {
  BID_COLLUSION_CV_HIGH,
  BID_COLLUSION_CV_MEDIUM,
  BID_COLLUSION_MIN_BIDS,
} from '../risk.constants';

/**
 * Flags a tender lot whose bids cluster suspiciously tightly around one
 * price — genuinely independent competitors don't usually converge within
 * a percent or two of each other. The coefficient of variation
 * (stddev/mean) is scale-independent, so it works the same whether the lot
 * is worth thousands or millions.
 */
@Injectable()
export class BidCollusionDetector {
  private readonly logger = new Logger(BidCollusionDetector.name);

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
      if (!lot || lot.bids.length < BID_COLLUSION_MIN_BIDS) {
        return;
      }

      const amounts = lot.bids.map((b) => Number(b.amount));
      const n = amounts.length;
      const mean = amounts.reduce((sum, a) => sum + a, 0) / n;
      if (mean === 0) {
        return;
      }
      const variance = amounts.reduce((sum, a) => sum + (a - mean) ** 2, 0) / n;
      const stddev = Math.sqrt(variance);
      const cv = stddev / mean;

      let severity: 'MEDIUM' | 'HIGH' | null = null;
      if (cv < BID_COLLUSION_CV_HIGH) {
        severity = 'HIGH';
      } else if (cv < BID_COLLUSION_CV_MEDIUM) {
        severity = 'MEDIUM';
      }
      if (!severity) {
        return;
      }

      const result: DetectionResult = {
        severity,
        title: 'Suspiciously uniform bid pricing on this lot',
        description: `${n} bids on this lot cluster within a coefficient of variation of ${(cv * 100).toFixed(2)}% (mean ${mean.toFixed(2)}) — tighter than independent competitors typically produce.`,
        evidence: {
          tenderLotId,
          bidCount: n,
          mean,
          stddev,
          coefficientOfVariation: cv,
          bidIds: lot.bids.map((b) => b.id),
          amounts,
        },
      };

      await this.riskAlertsService.raiseAlert(
        'BID_COLLUSION',
        'TenderLot',
        tenderLotId,
        result,
      );
    } catch (error) {
      this.logger.error(
        `Bid collusion detection failed for lot ${tenderLotId}`,
        error,
      );
    }
  }
}
