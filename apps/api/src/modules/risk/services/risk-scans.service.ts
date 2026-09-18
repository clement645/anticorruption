import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaService } from '../../../prisma/prisma.service';
import { PriceAnomalyDetector } from './price-anomaly.detector';
import { BidCollusionDetector } from './bid-collusion.detector';
import { SplitProcurementDetector } from './split-procurement.detector';
import { SupplierRiskDetector } from './supplier-risk.detector';

/**
 * On-demand re-runs of the detectors, mirroring the blockchain module's
 * manual `/anchor` trigger alongside its automatic interval job — useful
 * for an auditor investigating a specific tender/organization/supplier
 * right now, rather than waiting for the event that would naturally
 * trigger it again.
 */
@Injectable()
export class RiskScansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly priceAnomalyDetector: PriceAnomalyDetector,
    private readonly bidCollusionDetector: BidCollusionDetector,
    private readonly splitProcurementDetector: SplitProcurementDetector,
    private readonly supplierRiskDetector: SupplierRiskDetector,
  ) {}

  async scanTender(tenderId: string): Promise<{ lotsScanned: number }> {
    const tender = await this.prisma.tender.findUnique({
      where: { id: tenderId },
      include: { lots: true },
    });
    if (!tender) {
      throw new NotFoundException('Tender not found');
    }
    for (const lot of tender.lots) {
      await this.priceAnomalyDetector.evaluateLot(lot.id);
      await this.bidCollusionDetector.evaluateLot(lot.id);
    }
    return { lotsScanned: tender.lots.length };
  }

  async scanOrganization(
    organizationId: string,
  ): Promise<{ scanned: boolean }> {
    const mostRecent = await this.prisma.procurementRequest.findFirst({
      where: { organizationId, status: { in: ['SUBMITTED', 'APPROVED'] } },
      orderBy: { createdAt: 'desc' },
    });
    if (!mostRecent) {
      return { scanned: false };
    }
    await this.splitProcurementDetector.evaluateOrganization(
      organizationId,
      mostRecent.id,
    );
    return { scanned: true };
  }

  async scanSupplier(supplierId: string): Promise<{ scanned: boolean }> {
    const supplier = await this.prisma.supplier.findUnique({
      where: { id: supplierId },
    });
    if (!supplier) {
      throw new NotFoundException('Supplier not found');
    }
    await this.supplierRiskDetector.evaluateSupplier(supplierId);
    return { scanned: true };
  }
}
