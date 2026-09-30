import { Injectable } from '@nestjs/common';
import { Prisma } from '@bpfmps/database';
import { PrismaService } from '../../prisma/prisma.service';
import type { PublicOfficialScorecard } from './accountability.types';

const ZERO = new Prisma.Decimal(0);

/**
 * Every metric here is computed directly from the real, existing
 * foreign-key relationships this project already has (Prisma aggregates at
 * request time — no new table, no cached/stored running total that could
 * drift from the underlying rows, same "derive, don't store" judgment as
 * the duplicate-payment over-invoicing ceiling). See accountability.types.ts
 * for the public-disclosure boundary this module deliberately draws.
 */
@Injectable()
export class AccountabilityService {
  constructor(private readonly prisma: PrismaService) {}

  /** Every user id that has taken at least one of the 6 qualifying actions, anywhere. */
  private async listOfficialIds(): Promise<string[]> {
    const [budgets, requests, awards, invoices, payments, inspections] =
      await Promise.all([
        this.prisma.budgetPlan.findMany({
          where: { approvedById: { not: null } },
          distinct: ['approvedById'],
          select: { approvedById: true },
        }),
        this.prisma.procurementRequest.findMany({
          where: { approvedById: { not: null } },
          distinct: ['approvedById'],
          select: { approvedById: true },
        }),
        this.prisma.award.findMany({
          where: { awardedById: { not: null } },
          distinct: ['awardedById'],
          select: { awardedById: true },
        }),
        this.prisma.invoice.findMany({
          where: { verifiedById: { not: null } },
          distinct: ['verifiedById'],
          select: { verifiedById: true },
        }),
        this.prisma.paymentApproval.findMany({
          distinct: ['approvedById'],
          select: { approvedById: true },
        }),
        this.prisma.inspection.findMany({
          where: { inspectedById: { not: null } },
          distinct: ['inspectedById'],
          select: { inspectedById: true },
        }),
      ]);

    const ids = new Set<string>();
    for (const b of budgets) if (b.approvedById) ids.add(b.approvedById);
    for (const r of requests) if (r.approvedById) ids.add(r.approvedById);
    for (const a of awards) if (a.awardedById) ids.add(a.awardedById);
    for (const i of invoices) if (i.verifiedById) ids.add(i.verifiedById);
    for (const p of payments) ids.add(p.approvedById);
    for (const insp of inspections)
      if (insp.inspectedById) ids.add(insp.inspectedById);
    return Array.from(ids);
  }

  async listScorecards(params: {
    skip?: number;
    take?: number;
  }): Promise<{ items: PublicOfficialScorecard[]; total: number }> {
    const allIds = await this.listOfficialIds();
    const total = allIds.length;
    const pageIds = allIds.slice(
      params.skip ?? 0,
      (params.skip ?? 0) + (params.take ?? 25),
    );
    const items = await Promise.all(
      pageIds.map((id) => this.computeScorecard(id)),
    );
    return {
      items: items.filter((i): i is PublicOfficialScorecard => i !== null),
      total,
    };
  }

  async getScorecard(userId: string): Promise<PublicOfficialScorecard | null> {
    return this.computeScorecard(userId);
  }

  private async computeScorecard(
    userId: string,
  ): Promise<PublicOfficialScorecard | null> {
    const user = await this.prisma.user.findUnique({
      where: { id: userId },
      select: {
        firstName: true,
        lastName: true,
        organization: { select: { name: true } },
        roles: { select: { role: { select: { name: true } } } },
      },
    });
    if (!user) {
      return null;
    }

    const [
      budgetsApproved,
      requestsApproved,
      awards,
      invoicesVerified,
      paymentsApproved,
      inspections,
    ] = await Promise.all([
      this.prisma.budgetPlan.findMany({
        where: { approvedById: userId },
        select: { id: true, lines: { select: { authorizedAmount: true } } },
      }),
      this.prisma.procurementRequest.findMany({
        where: { approvedById: userId },
        select: { id: true, estimatedAmount: true },
      }),
      this.prisma.award.findMany({
        where: { awardedById: userId },
        select: {
          id: true,
          bidId: true,
          tenderLotId: true,
          awardedAmount: true,
          bid: { select: { supplierId: true } },
        },
      }),
      this.prisma.invoice.findMany({
        where: { verifiedById: userId },
        select: { id: true, amount: true },
      }),
      this.prisma.paymentApproval.findMany({
        where: { approvedById: userId },
        select: { id: true, paymentRequest: { select: { amount: true } } },
      }),
      this.prisma.inspection.findMany({
        where: { inspectedById: userId },
        select: { outcome: true },
      }),
    ]);

    const budgetsTotal = budgetsApproved.reduce(
      (sum, b) =>
        sum.add(
          b.lines.reduce((lineSum, l) => lineSum.add(l.authorizedAmount), ZERO),
        ),
      ZERO,
    );
    const requestsTotal = requestsApproved.reduce(
      (sum, r) => sum.add(r.estimatedAmount),
      ZERO,
    );
    const awardsTotal = awards.reduce(
      (sum, a) => sum.add(a.awardedAmount),
      ZERO,
    );
    const distinctSuppliers = new Set(awards.map((a) => a.bid.supplierId)).size;
    const invoicesTotal = invoicesVerified.reduce(
      (sum, i) => sum.add(i.amount),
      ZERO,
    );
    const paymentsTotal = paymentsApproved.reduce(
      (sum, p) => sum.add(p.paymentRequest.amount),
      ZERO,
    );

    const [flaggedRequests, flaggedInvoices, flaggedBids, flaggedLots] =
      await Promise.all([
        this.findFlaggedResourceIds(
          'ProcurementRequest',
          requestsApproved.map((r) => r.id),
        ),
        this.findFlaggedResourceIds(
          'Invoice',
          invoicesVerified.map((i) => i.id),
        ),
        this.findFlaggedResourceIds(
          'Bid',
          awards.map((a) => a.bidId),
        ),
        this.findFlaggedResourceIds(
          'TenderLot',
          awards.map((a) => a.tenderLotId),
        ),
      ]);

    // An award counts as flagged if EITHER its bid or its lot was flagged —
    // dedupe by award, not by the two underlying resource ids separately.
    const flaggedBidIds = new Set(flaggedBids.map((f) => f.resourceId));
    const flaggedLotIds = new Set(flaggedLots.map((f) => f.resourceId));
    const flaggedAwardCount = awards.filter(
      (a) => flaggedBidIds.has(a.bidId) || flaggedLotIds.has(a.tenderLotId),
    ).length;

    const totalActions =
      budgetsApproved.length +
      requestsApproved.length +
      awards.length +
      invoicesVerified.length +
      paymentsApproved.length +
      inspections.length;

    const riskFlaggedActionCount =
      flaggedRequests.length + flaggedInvoices.length + flaggedAwardCount;

    return {
      userId,
      firstName: user.firstName,
      lastName: user.lastName,
      organizationName: user.organization?.name ?? null,
      roles: user.roles.map((ur) => ur.role.name),
      totalActions,
      budgetsApproved: {
        count: budgetsApproved.length,
        totalAmount: budgetsTotal.toString(),
      },
      procurementRequestsApproved: {
        count: requestsApproved.length,
        totalAmount: requestsTotal.toString(),
      },
      awardsMade: {
        count: awards.length,
        totalAmount: awardsTotal.toString(),
        distinctSuppliers,
        vendorDiversityRatio:
          awards.length === 0 ? null : distinctSuppliers / awards.length,
      },
      invoicesVerified: {
        count: invoicesVerified.length,
        totalAmount: invoicesTotal.toString(),
      },
      paymentsApproved: {
        count: paymentsApproved.length,
        totalAmount: paymentsTotal.toString(),
      },
      inspectionsConducted: {
        count: inspections.length,
        passed: inspections.filter((i) => i.outcome === 'PASSED').length,
        failed: inspections.filter((i) => i.outcome === 'FAILED').length,
        needsRevision: inspections.filter((i) => i.outcome === 'NEEDS_REVISION')
          .length,
      },
      riskFlaggedActionCount,
      complianceRate:
        totalActions === 0 ? null : 1 - riskFlaggedActionCount / totalActions,
    };
  }

  private async findFlaggedResourceIds(
    resourceType: string,
    resourceIds: string[],
  ): Promise<Array<{ resourceId: string }>> {
    if (resourceIds.length === 0) {
      return [];
    }
    return this.prisma.riskAlert.findMany({
      where: { resourceType, resourceId: { in: resourceIds } },
      select: { resourceId: true },
      distinct: ['resourceId'],
    });
  }
}
