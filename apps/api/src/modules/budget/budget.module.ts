import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { FiscalYearsService } from './services/fiscal-years.service';
import { BudgetsService } from './services/budgets.service';
import { AllocationsService } from './services/allocations.service';
import { FiscalYearsController } from './controllers/fiscal-years.controller';
import { BudgetsController } from './controllers/budgets.controller';
import { AllocationsController } from './controllers/allocations.controller';
import { CommitmentsController } from './controllers/commitments.controller';
import { AdjustmentsController } from './controllers/adjustments.controller';

@Module({
  imports: [AuditModule],
  controllers: [
    FiscalYearsController,
    BudgetsController,
    AllocationsController,
    CommitmentsController,
    AdjustmentsController,
  ],
  providers: [FiscalYearsService, BudgetsService, AllocationsService],
  // AllocationsService is exported so Phase 6 (Procurement) can reuse its
  // row-locked commitment-control logic directly rather than duplicating it
  // — see ProcurementRequestsService.
  exports: [AllocationsService],
})
export class BudgetModule {}
