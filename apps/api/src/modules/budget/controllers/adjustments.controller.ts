import {
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
import { RequirePermissions } from '../../iam/decorators/permissions.decorator';
import { CurrentUser } from '../../iam/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../iam/types/jwt-payload.type';

function meta(req: Request) {
  return { ipAddress: req.ip, userAgent: req.headers['user-agent'] };
}

@ApiTags('budget')
@Controller('adjustments')
export class AdjustmentsController {
  constructor(private readonly allocationsService: AllocationsService) {}

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('budget:approve')
  approve(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.allocationsService.approveAdjustment(id, actor, meta(req));
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('budget:approve')
  reject(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.allocationsService.rejectAdjustment(id, actor, meta(req));
  }
}
