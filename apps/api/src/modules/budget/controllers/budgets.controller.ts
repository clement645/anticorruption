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
import { BudgetsService } from '../services/budgets.service';
import { CreateBudgetDto } from '../dto/create-budget.dto';
import { RejectBudgetDto } from '../dto/reject-budget.dto';
import { RequirePermissions } from '../../iam/decorators/permissions.decorator';
import { CurrentUser } from '../../iam/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../iam/types/jwt-payload.type';

function meta(req: Request) {
  return { ipAddress: req.ip, userAgent: req.headers['user-agent'] };
}

@ApiTags('budget')
@Controller('budgets')
export class BudgetsController {
  constructor(private readonly budgetsService: BudgetsService) {}

  @Get()
  @RequirePermissions('budget:read')
  list(
    @Query('skip') skip?: string,
    @Query('take') take?: string,
    @Query('organizationId') organizationId?: string,
    @Query('fiscalYearId') fiscalYearId?: string,
    @Query('status') status?: string,
  ) {
    return this.budgetsService.list({
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
      organizationId,
      fiscalYearId,
      status,
    });
  }

  @Get(':id')
  @RequirePermissions('budget:read')
  get(@Param('id') id: string) {
    return this.budgetsService.getView(id);
  }

  @Post()
  @RequirePermissions('budget:create')
  create(
    @Body() dto: CreateBudgetDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.budgetsService.create(dto, actor, meta(req));
  }

  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('budget:create')
  submit(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.budgetsService.submit(id, actor, meta(req));
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('budget:approve')
  approve(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.budgetsService.approve(id, actor, meta(req));
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('budget:approve')
  reject(
    @Param('id') id: string,
    @Body() dto: RejectBudgetDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.budgetsService.reject(id, dto.reason, actor, meta(req));
  }
}
