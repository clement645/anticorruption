import { Body, Controller, Get, Param, Post, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { SupplierRiskService } from '../services/supplier-risk.service';
import { RecordRiskAssessmentDto } from '../dto/record-risk-assessment.dto';
import { RequirePermissions } from '../../iam/decorators/permissions.decorator';
import { CurrentUser } from '../../iam/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../iam/types/jwt-payload.type';

function meta(req: Request) {
  return { ipAddress: req.ip, userAgent: req.headers['user-agent'] };
}

@ApiTags('supplier')
@Controller('suppliers')
@RequirePermissions('supplier:read_sensitive')
export class SupplierRiskController {
  constructor(private readonly riskService: SupplierRiskService) {}

  @Get(':id/risk-profile')
  current(@Param('id') id: string) {
    return this.riskService.current(id);
  }

  @Get(':id/risk-profile/history')
  history(@Param('id') id: string) {
    return this.riskService.history(id);
  }

  @Post(':id/risk-profile')
  @RequirePermissions('supplier:verify')
  record(
    @Param('id') id: string,
    @Body() dto: RecordRiskAssessmentDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.riskService.recordAssessment(id, dto, actor, meta(req));
  }
}
