import {
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
import { TendersService } from '../services/tenders.service';
import { RequirePermissions } from '../../iam/decorators/permissions.decorator';
import { CurrentUser } from '../../iam/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../iam/types/jwt-payload.type';

function meta(req: Request) {
  return { ipAddress: req.ip, userAgent: req.headers['user-agent'] };
}

@ApiTags('procurement')
@Controller('tenders')
@RequirePermissions('procurement:read')
export class TendersController {
  constructor(private readonly tendersService: TendersService) {}

  @Get()
  list(@Query('status') status?: string) {
    return this.tendersService.list(status);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.tendersService.getView(id);
  }

  @Post(':id/publish')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('procurement:publish')
  publish(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.tendersService.publish(id, actor, meta(req));
  }

  @Post(':id/close')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('procurement:publish')
  close(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.tendersService.close(id, actor, meta(req));
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('procurement:approve')
  cancel(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.tendersService.cancel(id, actor, meta(req));
  }
}
