import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Query,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { RiskAlertsService } from '../services/risk-alerts.service';
import { ReviewAlertDto } from '../dto/review-alert.dto';
import { RequirePermissions } from '../../iam/decorators/permissions.decorator';
import { CurrentUser } from '../../iam/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../iam/types/jwt-payload.type';

function meta(req: Request) {
  return { ipAddress: req.ip, userAgent: req.headers['user-agent'] };
}

@ApiTags('risk')
@Controller('risk-alerts')
@RequirePermissions('risk:read')
export class RiskAlertsController {
  constructor(private readonly riskAlertsService: RiskAlertsService) {}

  @Get()
  list(
    @Query('status') status?: string,
    @Query('severity') severity?: string,
    @Query('detectorType') detectorType?: string,
    @Query('resourceType') resourceType?: string,
    @Query('resourceId') resourceId?: string,
  ) {
    return this.riskAlertsService.list({
      status,
      severity,
      detectorType,
      resourceType,
      resourceId,
    });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.riskAlertsService.getView(id);
  }

  @Post(':id/review')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('risk:review')
  review(
    @Param('id') id: string,
    @Body() dto: ReviewAlertDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.riskAlertsService.review(id, dto, actor, meta(req));
  }
}
