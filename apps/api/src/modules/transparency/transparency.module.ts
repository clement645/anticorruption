import { Module } from '@nestjs/common';
import { TransparencyController } from './transparency.controller';
import { TransparencyService } from './transparency.service';
import { AuditModule } from '../audit/audit.module';

// BlockchainModule is @Global() (see blockchain.module.ts) so
// BLOCKCHAIN_ADAPTER is injectable here without an explicit import — same
// reasoning ProjectsModule already documents.
@Module({
  imports: [AuditModule],
  controllers: [TransparencyController],
  providers: [TransparencyService],
})
export class TransparencyModule {}
