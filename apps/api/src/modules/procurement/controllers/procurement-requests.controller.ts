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
import { ProcurementRequestsService } from '../services/procurement-requests.service';
import { TendersService } from '../services/tenders.service';
import { CreateRequestDto } from '../dto/create-request.dto';
import { CreateTenderDto } from '../dto/create-tender.dto';
import { RequirePermissions } from '../../iam/decorators/permissions.decorator';
import { CurrentUser } from '../../iam/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../iam/types/jwt-payload.type';

function meta(req: Request) {
  return { ipAddress: req.ip, userAgent: req.headers['user-agent'] };
}

@ApiTags('procurement')
@Controller('procurement-requests')
@RequirePermissions('procurement:read')
export class ProcurementRequestsController {
  constructor(
    private readonly requestsService: ProcurementRequestsService,
    private readonly tendersService: TendersService,
  ) {}

  @Get()
  list(
    @Query('organizationId') organizationId?: string,
    @Query('status') status?: string,
  ) {
    return this.requestsService.list({ organizationId, status });
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.requestsService.getView(id);
  }

  @Post()
  @RequirePermissions('procurement:create')
  create(
    @Body() dto: CreateRequestDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.requestsService.create(dto, actor, meta(req));
  }

  @Post(':id/submit')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('procurement:create')
  submit(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.requestsService.submit(id, actor, meta(req));
  }

  @Post(':id/approve')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('procurement:approve')
  approve(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.requestsService.approve(id, actor, meta(req));
  }

  @Post(':id/reject')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('procurement:approve')
  reject(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.requestsService.reject(id, actor, meta(req));
  }

  @Post(':id/tenders')
  @RequirePermissions('procurement:create')
  createTender(
    @Param('id') id: string,
    @Body() dto: CreateTenderDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.tendersService.create(id, dto, actor, meta(req));
  }
}
