import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { RiskModule } from '../risk/risk.module';
import { SupplierProfileService } from './services/supplier-profile.service';
import { SupplierOwnersService } from './services/supplier-owners.service';
import { SupplierDocumentsService } from './services/supplier-documents.service';
import { SupplierRiskService } from './services/supplier-risk.service';
import { SupplierProfileController } from './controllers/supplier-profile.controller';
import { SupplierOwnersController } from './controllers/supplier-owners.controller';
import {
  SupplierDocumentsController,
  SupplierDocumentVerificationController,
} from './controllers/supplier-documents.controller';
import { SupplierRiskController } from './controllers/supplier-risk.controller';

/**
 * Deliberately does NOT import ProcurementModule. It only needs to check
 * that a given supplierId exists, which SupplierProfileService does with a
 * one-line Prisma lookup — not enough shared logic to justify a
 * cross-module dependency (unlike Phase 6's real reuse of
 * AllocationsService.createCommitment(), which is genuine business logic).
 * ProcurementModule's own minimal SuppliersService (create/list/lookup for
 * bidding) is untouched — this module extends the same `suppliers` table
 * through new routes and tables, not by modifying Phase 6's code.
 */
@Module({
  imports: [AuditModule, RiskModule],
  controllers: [
    SupplierProfileController,
    SupplierOwnersController,
    SupplierDocumentsController,
    SupplierDocumentVerificationController,
    SupplierRiskController,
  ],
  providers: [
    SupplierProfileService,
    SupplierOwnersService,
    SupplierDocumentsService,
    SupplierRiskService,
  ],
})
export class SupplierModule {}
