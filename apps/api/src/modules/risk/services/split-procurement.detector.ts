import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { RiskAlert } from '@bpfmps/database';
import { PrismaService } from '../../../prisma/prisma.service';
import { RiskAlertsService } from './risk-alerts.service';
import type { DetectionResult } from '../risk.types';
import type { EnvConfig } from '../../../config/env.validation';

/**
 * Regulation 43 of the Public Procurement and Asset Disposal Regulations,
 * 2020 (Legal Notice No. 69 of 2020) — "Procurement pricing and requirement
 * not to split contracts". See apps/api/src/modules/compliance for the full
 * citable rule registry this references.
 */
export const SPLIT_PROCUREMENT_CITATION =
  'Public Procurement and Asset Disposal Regulations, 2020, Regulation 43 (requirement not to split contracts)';

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

  /**
   * Preventive gate, not just detection: a request that is itself one of the
   * requests named in an unresolved (OPEN or UNDER_REVIEW) HIGH-severity
   * split-procurement alert cannot be approved until an independent Auditor
   * reviews it (CONFIRMED or DISMISSED; `risk:review` is deliberately
   * withheld from Procurement Officer, see Phase 8). Called by
   * ProcurementRequestsService.approve() BEFORE the budget commitment is
   * created — previously this detector only ran AFTER approval, by which
   * point the money was already committed.
   *
   * Deliberately scoped to the SPECIFIC flagged batch (`evidence.requestIds`
   * contains this request), not "this organization has any unresolved alert
   * anywhere" — a real ministry legitimately raises many unrelated
   * procurement requests across different programs; freezing all of an
   * organization's future procurement over one old, unrelated flag would be
   * a disproportionate, easily-gamed-as-a-denial-of-service side effect, not
   * a meaningful anti-corruption control. Returns the blocking alert, or
   * null if approval may proceed.
   */
  async findBlockingAlert(
    organizationId: string,
    requestId: string,
  ): Promise<RiskAlert | null> {
    return this.prisma.riskAlert.findFirst({
      where: {
        detectorType: 'SPLIT_PROCUREMENT',
        severity: 'HIGH',
        status: { in: ['OPEN', 'UNDER_REVIEW'] },
        resourceType: 'ProcurementRequest',
        AND: [
          { evidence: { path: ['organizationId'], equals: organizationId } },
          { evidence: { path: ['requestIds'], array_contains: requestId } },
        ],
      },
      orderBy: { createdAt: 'desc' },
    });
  }
}
