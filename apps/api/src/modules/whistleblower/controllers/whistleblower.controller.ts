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
import { WhistleblowerService } from '../services/whistleblower.service';
import { ChangeStatusDto } from '../dto/change-status.dto';
import { PostInvestigatorUpdateDto } from '../dto/post-investigator-update.dto';
import { RequirePermissions } from '../../iam/decorators/permissions.decorator';
import { CurrentUser } from '../../iam/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../iam/types/jwt-payload.type';

function meta(req: Request) {
  return { ipAddress: req.ip, userAgent: req.headers['user-agent'] };
}

/**
 * Investigator side — authenticated, permission-gated, fully audited (actor
 * + IP + user agent) like every other module. Deliberately the narrowest
 * grant in the whole permission set: only Auditor/Internal Auditor hold
 * `whistleblower:read`/`investigate` in seed.ts — see THREAT_MODEL.md
 * Phase 13 for why even Procurement/Finance/Approving roles, who hold broad
 * *:read elsewhere, are never given visibility here.
 */
@ApiTags('whistleblower')
@Controller('whistleblower')
@RequirePermissions('whistleblower:read')
export class WhistleblowerController {
  constructor(private readonly whistleblower: WhistleblowerService) {}

  @Get('reports')
  list(
    @Query('status') status?: string,
    @Query('skip') skip?: string,
    @Query('take') take?: string,
  ) {
    return this.whistleblower.list({
      status,
      skip: skip ? Number(skip) : undefined,
      take: take ? Number(take) : undefined,
    });
  }

  @Get('reports/:id')
  getDetail(@Param('id') id: string) {
    return this.whistleblower.getDetail(id);
  }

  @Post('reports/:id/assign')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('whistleblower:investigate')
  assign(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.whistleblower.assignToSelf(id, actor, meta(req));
  }

  @Post('reports/:id/status')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('whistleblower:investigate')
  changeStatus(
    @Param('id') id: string,
    @Body() dto: ChangeStatusDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.whistleblower.changeStatus(id, dto, actor, meta(req));
  }

  @Post('reports/:id/updates')
  @RequirePermissions('whistleblower:investigate')
  postUpdate(
    @Param('id') id: string,
    @Body() dto: PostInvestigatorUpdateDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.whistleblower.addInvestigatorUpdate(
      id,
      dto.message,
      actor,
      meta(req),
    );
  }
}
