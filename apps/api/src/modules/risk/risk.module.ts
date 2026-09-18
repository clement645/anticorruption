import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { RiskAlertsService } from './services/risk-alerts.service';
import { PriceAnomalyDetector } from './services/price-anomaly.detector';
import { BidCollusionDetector } from './services/bid-collusion.detector';
import { SplitProcurementDetector } from './services/split-procurement.detector';
import { SupplierRiskDetector } from './services/supplier-risk.detector';
import { RiskScansService } from './services/risk-scans.service';
import { RiskAlertsController } from './controllers/risk-alerts.controller';
import { RiskScansController } from './controllers/risk-scans.controller';

/**
 * Deliberately has no dependency on ProcurementModule or SupplierModule —
 * it only ever reads raw data via Prisma to compute a finding. The
 * dependency direction runs the other way: ProcurementModule and
 * SupplierModule import RiskModule to call detectors at the natural points
 * in their own lifecycles (tender close, request approval, PEP owner
 * added, document rejected, supplier suspended/blacklisted) — see
 * IMPLEMENTATION_PLAN.md Phase 8 for exactly which call sites.
 */
@Module({
  imports: [AuditModule],
  controllers: [RiskAlertsController, RiskScansController],
  providers: [
    RiskAlertsService,
    PriceAnomalyDetector,
    BidCollusionDetector,
    SplitProcurementDetector,
    SupplierRiskDetector,
    RiskScansService,
  ],
  exports: [
    PriceAnomalyDetector,
    BidCollusionDetector,
    SplitProcurementDetector,
    SupplierRiskDetector,
  ],
})
export class RiskModule {}
