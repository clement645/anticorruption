import { Injectable, Logger } from '@nestjs/common';
import { Prisma } from '@bpfmps/database';
import { PrismaService } from '../../../prisma/prisma.service';
import { RiskAlertsService } from './risk-alerts.service';
import type { DetectionResult } from '../risk.types';
import {
  SUPPLIER_RISK_LEVEL_THRESHOLDS,
  SUPPLIER_RISK_WEIGHTS,
} from '../risk.constants';

interface Factor {
  signal: string;
  weight: number;
  detail: string;
}

/**
 * Aggregates existing Phase 7 signals (PEP ownership, rejected/expired
 * compliance documents, suspension/blacklist history) into a weighted score
 * and writes it as a new SupplierRiskProfile row — the same table Phase 7
 * built for manual assessments, deliberately kept detector-agnostic so this
 * phase needs no schema change (see schema.prisma comment on
 * SupplierRiskProfile). `assessedById` is left null: this assessment was
 * made by the engine, not a person, and it would be dishonest to attribute
 * it to whichever actor happened to trigger the re-evaluation.
 */
@Injectable()
export class SupplierRiskDetector {
  private readonly logger = new Logger(SupplierRiskDetector.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly riskAlertsService: RiskAlertsService,
  ) {}

  async evaluateSupplier(supplierId: string): Promise<void> {
    try {
      const supplier = await this.prisma.supplier.findUnique({
        where: { id: supplierId },
        include: { owners: true, documents: true },
      });
      if (!supplier) {
        return;
      }

      const factors: Factor[] = [];
      const now = new Date();

      const pepOwners = supplier.owners.filter(
        (o) => o.isPoliticallyExposedPerson,
      );
      for (const owner of pepOwners) {
        factors.push({
          signal: 'politically_exposed_owner',
          weight: SUPPLIER_RISK_WEIGHTS.politicallyExposedOwner,
          detail: `Owner ${owner.id} is flagged as a politically exposed person`,
        });
      }

      const rejectedDocs = supplier.documents.filter(
        (d) => d.status === 'REJECTED',
      );
      for (const doc of rejectedDocs) {
        factors.push({
          signal: 'rejected_document',
          weight: SUPPLIER_RISK_WEIGHTS.rejectedDocument,
          detail: `Document ${doc.id} (${doc.documentType}) was rejected: ${doc.rejectionReason ?? 'no reason recorded'}`,
        });
      }

      const expiredDocs = supplier.documents.filter(
        (d) =>
          d.status === 'VERIFIED' &&
          d.expiryDate !== null &&
          d.expiryDate < now,
      );
      for (const doc of expiredDocs) {
        factors.push({
          signal: 'expired_verified_document',
          weight: SUPPLIER_RISK_WEIGHTS.expiredVerifiedDocument,
          detail: `Document ${doc.id} (${doc.documentType}) was verified but expired on ${doc.expiryDate?.toISOString()}`,
        });
      }

      if (supplier.status === 'SUSPENDED') {
        factors.push({
          signal: 'currently_suspended',
          weight: SUPPLIER_RISK_WEIGHTS.suspended,
          detail: 'Supplier is currently SUSPENDED',
        });
      }
      if (supplier.status === 'BLACKLISTED') {
        factors.push({
          signal: 'currently_blacklisted',
          weight: SUPPLIER_RISK_WEIGHTS.blacklisted,
          detail: 'Supplier is currently BLACKLISTED',
        });
      }

      const rawScore = factors.reduce((sum, f) => sum + f.weight, 0);
      const score = Math.min(100, rawScore);
      const riskLevel =
        score >= SUPPLIER_RISK_LEVEL_THRESHOLDS.CRITICAL
          ? 'CRITICAL'
          : score >= SUPPLIER_RISK_LEVEL_THRESHOLDS.HIGH
            ? 'HIGH'
            : score >= SUPPLIER_RISK_LEVEL_THRESHOLDS.MEDIUM
              ? 'MEDIUM'
              : 'LOW';

      await this.prisma.supplierRiskProfile.create({
        data: {
          supplierId,
          riskLevel,
          score: new Prisma.Decimal(score),
          factors: factors as unknown as Prisma.InputJsonValue,
          notes: 'Automated assessment by the AI Risk Engine (Phase 8)',
          assessedById: null,
        },
      });

      // Only surface a review-queue alert for genuinely noteworthy findings —
      // a routine LOW/MEDIUM automated assessment updates the risk profile
      // silently, matching the "don't spam the review queue" principle
      // RiskAlertsService's dedup already applies at the alert level.
      if (riskLevel === 'HIGH' || riskLevel === 'CRITICAL') {
        const result: DetectionResult = {
          severity: riskLevel,
          title: `Supplier risk score elevated to ${riskLevel} (${score}/100)`,
          description: `Automated assessment found ${factors.length} contributing risk factor(s) for this supplier, totaling a score of ${score}/100.`,
          evidence: { supplierId, score, riskLevel, factors },
        };
        await this.riskAlertsService.raiseAlert(
          'SUPPLIER_RISK',
          'Supplier',
          supplierId,
          result,
        );
      }
    } catch (error) {
      this.logger.error(
        `Supplier risk detection failed for supplier ${supplierId}`,
        error,
      );
    }
  }
}
