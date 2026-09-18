import { Module } from '@nestjs/common';
import { AuditModule } from '../audit/audit.module';
import { ProjectsService } from './services/projects.service';
import { MilestonesService } from './services/milestones.service';
import { InspectionsService } from './services/inspections.service';
import { EvidenceService } from './services/evidence.service';
import { ProjectsController } from './controllers/projects.controller';
import { MilestonesController } from './controllers/milestones.controller';
import { InspectionsController } from './controllers/inspections.controller';
import { EvidenceController } from './controllers/evidence.controller';

/**
 * No explicit import of BlockchainModule or StorageModule needed — both are
 * @Global() (see their own doc comments), so EvidenceService can inject
 * BLOCKCHAIN_ADAPTER and OBJECT_STORAGE_ADAPTER directly.
 */
@Module({
  imports: [AuditModule],
  controllers: [
    ProjectsController,
    MilestonesController,
    InspectionsController,
    EvidenceController,
  ],
  providers: [
    ProjectsService,
    MilestonesService,
    InspectionsService,
    EvidenceService,
  ],
})
export class ProjectsModule {}
