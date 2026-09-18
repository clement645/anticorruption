import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { BudgetModule } from '../budget/budget.module';
import { ContractsService } from './services/contracts.service';
import { PurchaseOrdersService } from './services/purchase-orders.service';
import { InvoicesService } from './services/invoices.service';
import { PaymentsService } from './services/payments.service';
import { ContractsController } from './controllers/contracts.controller';
import { PurchaseOrdersController } from './controllers/purchase-orders.controller';
import { InvoicesController } from './controllers/invoices.controller';
import {
  PaymentRequestsController,
  PaymentsController,
} from './controllers/payments.controller';

/**
 * Imports BudgetModule to reuse AllocationsService.createExpenditure()
 * directly — genuine shared business logic (the row-locked, CHECK-
 * constrained "consume a commitment" operation), the same reuse judgment
 * Phase 6 made for AllocationsService.createCommitment() and Phase 7
 * deliberately did NOT make for a one-line existence check (see
 * SupplierModule doc comment) — this module needs the real thing, not a
 * trivial read.
 */
@Module({
  imports: [AuditModule, BudgetModule],
  controllers: [
    ContractsController,
    PurchaseOrdersController,
    InvoicesController,
    PaymentRequestsController,
    PaymentsController,
  ],
  providers: [
    ContractsService,
    PurchaseOrdersService,
    InvoicesService,
    PaymentsService,
  ],
})
export class ContractsModule {}
