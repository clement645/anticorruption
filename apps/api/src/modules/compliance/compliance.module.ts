import { Module } from '@nestjs/common';
import { ComplianceController } from './controllers/compliance.controller';

@Module({
  controllers: [ComplianceController],
})
export class ComplianceModule {}
