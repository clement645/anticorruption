import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../../../prisma/prisma.service';
import { RiskAlertsService } from './risk-alerts.service';
import type { DetectionResult } from '../risk.types';
import type { EnvConfig } from '../../../config/env.validation';

/**
 * Flags an organization that has raised several procurement requests in a
 * short window whose individual amounts each stay under the configured
 * high-value threshold, but whose combined total exceeds it — the classic
 * "split a large purchase into several small ones" pattern used to dodge
 * the extra scrutiny a single large procurement would trigger. The
 * threshold/window are policy, not statistics (see env.validation.ts), so
 * they're configurable rather than hardcoded.
 */
@Injectable()
export class SplitProcurementDetector {
  private readonly logger = new Logger(SplitProcurementDetector.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly riskAlertsService: RiskAlertsService,
    private readonly config: ConfigService<EnvConfig, true>,
  ) {}

  async evaluateOrganization(
    organizationId: string,
    triggeringRequestId: string,
  ): Promise<void> {
    try {
      const windowDays = this.config.get('RISK_SPLIT_PROCUREMENT_WINDOW_DAYS', {
        infer: true,
      });
      const minCount = this.config.get('RISK_SPLIT_PROCUREMENT_MIN_COUNT', {
        infer: true,
      });
      const threshold = this.config.get('RISK_SPLIT_PROCUREMENT_THRESHOLD', {
        infer: true,
      });

      const windowStart = new Date(
        Date.now() - windowDays * 24 * 60 * 60 * 1000,
      );
      const requests = await this.prisma.procurementRequest.findMany({
        where: {
          organizationId,
          createdAt: { gte: windowStart },
          status: { in: ['SUBMITTED', 'APPROVED'] },
        },
        orderBy: { createdAt: 'asc' },
      });

      if (requests.length < minCount) {
        return;
      }

      const amounts = requests.map((r) => Number(r.estimatedAmount));
      const total = amounts.reduce((sum, a) => sum + a, 0);
      const maxSingle = Math.max(...amounts);

      // Each request individually under the radar, but the total over it —
      // if one request already exceeds the threshold on its own, this isn't
      // "split to avoid scrutiny", it's just one large legitimate purchase.
      if (total < threshold || maxSingle >= threshold) {
        return;
      }

      const result: DetectionResult = {
        severity: total >= threshold * 2 ? 'HIGH' : 'MEDIUM',
        title: 'Possible split procurement pattern',
        description: `${requests.length} procurement requests from this organization within the last ${windowDays} days total ${total.toFixed(2)}, exceeding the ${threshold} scrutiny threshold, while no single request does.`,
        evidence: {
          organizationId,
          windowDays,
          threshold,
          requestCount: requests.length,
          total,
          maxSingleAmount: maxSingle,
          requestIds: requests.map((r) => r.id),
          amounts,
        },
      };

      await this.riskAlertsService.raiseAlert(
        'SPLIT_PROCUREMENT',
        'ProcurementRequest',
        triggeringRequestId,
        result,
      );
    } catch (error) {
      this.logger.error(
        `Split procurement detection failed for organization ${organizationId}`,
        error,
      );
    }
  }
}
