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
import { MilestonesService } from '../services/milestones.service';
import { InspectionsService } from '../services/inspections.service';
import { CreateInspectionDto } from '../dto/create-inspection.dto';
import { RequirePermissions } from '../../iam/decorators/permissions.decorator';
import { CurrentUser } from '../../iam/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../iam/types/jwt-payload.type';

function meta(req: Request) {
  return { ipAddress: req.ip, userAgent: req.headers['user-agent'] };
}

@ApiTags('projects')
@Controller('milestones')
@RequirePermissions('project:read')
export class MilestonesController {
  constructor(
    private readonly milestonesService: MilestonesService,
    private readonly inspectionsService: InspectionsService,
  ) {}

  @Get()
  list(@Query('projectId') projectId?: string) {
    return this.milestonesService.list(projectId);
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.milestonesService.getView(id);
  }

  @Post(':id/start')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('project:manage')
  start(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.milestonesService.markInProgress(id, actor, meta(req));
  }

  @Post(':id/complete')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('project:manage')
  complete(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.milestonesService.markCompleted(id, actor, meta(req));
  }

  @Get(':id/inspections')
  listInspections(@Param('id') id: string) {
    return this.inspectionsService.list(id);
  }

  @Post(':id/inspections')
  @RequirePermissions('project:inspect')
  inspect(
    @Param('id') milestoneId: string,
    @Body() dto: CreateInspectionDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.inspectionsService.create(milestoneId, dto, actor, meta(req));
  }
}
