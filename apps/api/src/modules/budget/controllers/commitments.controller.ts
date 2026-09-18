import {
  Body,
  Controller,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Req,
} from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import { AllocationsService } from '../services/allocations.service';
import { CreateExpenditureDto } from '../dto/create-expenditure.dto';
import { RequirePermissions } from '../../iam/decorators/permissions.decorator';
import { CurrentUser } from '../../iam/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../iam/types/jwt-payload.type';

function meta(req: Request) {
  return { ipAddress: req.ip, userAgent: req.headers['user-agent'] };
}

@ApiTags('budget')
@Controller('commitments')
export class CommitmentsController {
  constructor(private readonly allocationsService: AllocationsService) {}

  @Post(':id/release')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('budget:commit')
  release(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.allocationsService.releaseCommitment(id, actor, meta(req));
  }

  @Post(':id/expenditures')
  @RequirePermissions('budget:spend')
  createExpenditure(
    @Param('id') id: string,
    @Body() dto: CreateExpenditureDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.allocationsService.createExpenditure(id, dto, actor, meta(req));
  }
}
