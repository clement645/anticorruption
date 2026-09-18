import { Module } from '@nestjs/common';
import { WhistleblowerPublicController } from './controllers/whistleblower-public.controller';
import { WhistleblowerController } from './controllers/whistleblower.controller';
import { WhistleblowerService } from './services/whistleblower.service';
import { AuditModule } from '../audit/audit.module';

// BlockchainModule and StorageModule are both @Global() (see their own
// module comments) so BLOCKCHAIN_ADAPTER/OBJECT_STORAGE_ADAPTER are
// injectable here without an explicit import — same reasoning
// ProjectsModule already documents.
@Module({
  imports: [AuditModule],
  controllers: [WhistleblowerPublicController, WhistleblowerController],
  providers: [WhistleblowerService],
})
export class WhistleblowerModule {}
