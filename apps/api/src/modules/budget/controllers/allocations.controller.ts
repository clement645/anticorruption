import { Body, Controller, Get, Param, Post, Query, Req } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AllocationsService } from '../services/allocations.service';
import { CreateCommitmentDto } from '../dto/create-commitment.dto';
import { CreateAdjustmentDto } from '../dto/create-adjustment.dto';
import { RequirePermissions } from '../../iam/decorators/permissions.decorator';
import { CurrentUser } from '../../iam/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../iam/types/jwt-payload.type';

function meta(req: Request) {
  return { ipAddress: req.ip, userAgent: req.headers['user-agent'] };
}

@ApiTags('budget')
@Controller('allocations')
export class AllocationsController {
  constructor(private readonly allocationsService: AllocationsService) {}

  @Get()
  @RequirePermissions('budget:read')
  list(
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('organizationId') organizationId?: string,
    @Query('fiscalYearId') fiscalYearId?: string,
  ) {
    return this.allocationsService.list({
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
      organizationId,
      fiscalYearId,
    });
  }

  @Get(':id')
  @RequirePermissions('budget:read')
  get(@Param('id') id: string) {
    return this.allocationsService.getView(id);
  }

  @Post(':id/commitments')
  @RequirePermissions('budget:commit')
  createCommitment(
    @Param('id') id: string,
    @Body() dto: CreateCommitmentDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.allocationsService.createCommitment(id, dto, actor, meta(req));
  }

  @Post(':id/adjustments')
  @RequirePermissions('budget:adjust')
  createAdjustment(
    @Param('id') id: string,
    @Body() dto: CreateAdjustmentDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.allocationsService.createAdjustment(id, dto, actor, meta(req));
  }
}
