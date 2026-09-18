import { Global, Module } from '@nestjs/common';
import { ScheduleModule } from '@nestjs/schedule';
import { AuditModule } from '../audit/audit.module';
import { BLOCKCHAIN_ADAPTER } from './blockchain.constants';
import { DevelopmentLedgerAdapter } from './development-ledger.adapter';
import { AnchoringService } from './anchoring.service';
import { BlockchainController } from './blockchain.controller';

/**
 * Global so the BLOCKCHAIN_ADAPTER token is injectable from any module
 * (e.g. AuditController composing audit + blockchain verification results)
 * without those modules needing to import BlockchainModule directly — which
 * would create a circular import, since AnchoringService here needs
 * AuditModule. This mirrors how PrismaModule is already registered globally.
 */
@Global()
@Module({
  imports: [ScheduleModule.forRoot(), AuditModule],
  controllers: [BlockchainController],
  providers: [
    { provide: BLOCKCHAIN_ADAPTER, useClass: DevelopmentLedgerAdapter },
    AnchoringService,
  ],
  exports: [BLOCKCHAIN_ADAPTER],
})
export class BlockchainModule {}
