import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { BudgetModule } from '../budget/budget.module';
import { RiskModule } from '../risk/risk.module';
import { SuppliersService } from './services/suppliers.service';
import { ProcurementPlansService } from './services/procurement-plans.service';
import { ProcurementRequestsService } from './services/procurement-requests.service';
import { TendersService } from './services/tenders.service';
import { BidsService } from './services/bids.service';
import { SuppliersController } from './controllers/suppliers.controller';
import { ProcurementPlansController } from './controllers/procurement-plans.controller';
import { ProcurementRequestsController } from './controllers/procurement-requests.controller';
import { TendersController } from './controllers/tenders.controller';
import {
  TenderLotBidsController,
  BidsController,
} from './controllers/bids.controller';

@Module({
  imports: [AuditModule, BudgetModule, RiskModule],
  controllers: [
    SuppliersController,
    ProcurementPlansController,
    ProcurementRequestsController,
    TendersController,
    TenderLotBidsController,
    BidsController,
  ],
  providers: [
    SuppliersService,
    ProcurementPlansService,
    ProcurementRequestsService,
    TendersService,
    BidsService,
  ],
})
export class ProcurementModule {}
