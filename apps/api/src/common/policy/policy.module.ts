import { Module } from '@nestjs/common';
import { AuditModule } from '../../modules/audit/audit.module';
import { PolicyService } from './policy.service';

@Module({
  imports: [AuditModule],
  providers: [PolicyService],
  exports: [PolicyService],
})
export class PolicyModule {}
