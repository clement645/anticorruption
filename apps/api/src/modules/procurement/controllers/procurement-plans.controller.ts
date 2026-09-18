import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { ProcurementPlansService } from '../services/procurement-plans.service';
import { CreatePlanDto } from '../dto/create-plan.dto';
import { RequirePermissions } from '../../iam/decorators/permissions.decorator';
import { CurrentUser } from '../../iam/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../iam/types/jwt-payload.type';

function meta(req: Request) {
  return { ipAddress: req.ip, userAgent: req.headers['user-agent'] };
}

@ApiTags('procurement')
@Controller('procurement-plans')
@RequirePermissions('procurement:read')
export class ProcurementPlansController {
  constructor(private readonly plansService: ProcurementPlansService) {}

  @Get()
  list() {
    return this.plansService.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.plansService.getView(id);
  }

  @Post()
  @RequirePermissions('procurement:manage')
  create(
    @Body() dto: CreatePlanDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.plansService.create(dto, actor, meta(req));
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('procurement:approve')
  approve(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.plansService.approve(id, actor, meta(req));
  }
}
