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
import { ProjectsService } from '../services/projects.service';
import { MilestonesService } from '../services/milestones.service';
import { EvidenceService } from '../services/evidence.service';
import { CreateProjectDto } from '../dto/create-project.dto';
import { CreateMilestoneDto } from '../dto/create-milestone.dto';
import { UploadEvidenceDto } from '../dto/upload-evidence.dto';
import { RequirePermissions } from '../../iam/decorators/permissions.decorator';
import { CurrentUser } from '../../iam/decorators/current-user.decorator';
import type { AuthenticatedUser } from '../../iam/types/jwt-payload.type';

function meta(req: Request) {
  return { ipAddress: req.ip, userAgent: req.headers['user-agent'] };
}

@ApiTags('projects')
@Controller('projects')
@RequirePermissions('project:read')
export class ProjectsController {
  constructor(
    private readonly projectsService: ProjectsService,
    private readonly milestonesService: MilestonesService,
    private readonly evidenceService: EvidenceService,
  ) {}

  @Get()
  list() {
    return this.projectsService.list();
  }

  @Get(':id')
  get(@Param('id') id: string) {
    return this.projectsService.getView(id);
  }

  @Post()
  @RequirePermissions('project:manage')
  create(
    @Body() dto: CreateProjectDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.projectsService.create(dto, actor, meta(req));
  }

  @Post(':id/activate')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('project:manage')
  activate(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.projectsService.activate(id, actor, meta(req));
  }

  @Post(':id/suspend')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('project:manage')
  suspend(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.projectsService.suspend(id, actor, meta(req));
  }

  @Post(':id/resume')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('project:manage')
  resume(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.projectsService.resume(id, actor, meta(req));
  }

  @Post(':id/cancel')
  @HttpCode(HttpStatus.OK)
  @RequirePermissions('project:manage')
  cancel(
    @Param('id') id: string,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.projectsService.cancel(id, actor, meta(req));
  }

  @Get(':id/milestones')
  listMilestones(@Param('id') id: string) {
    return this.milestonesService.list(id);
  }

  @Post(':id/milestones')
  @RequirePermissions('project:manage')
  createMilestone(
    @Param('id') projectId: string,
    @Body() dto: CreateMilestoneDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.milestonesService.create(projectId, dto, actor, meta(req));
  }

  @Get(':id/evidence')
  @RequirePermissions('project:read')
  listEvidence(@Param('id') id: string) {
    return this.evidenceService.list(id);
  }

  @Post(':id/evidence')
  @RequirePermissions('evidence:upload')
  uploadEvidence(
    @Param('id') projectId: string,
    @Body() dto: UploadEvidenceDto,
    @CurrentUser() actor: AuthenticatedUser,
    @Req() req: Request,
  ) {
    return this.evidenceService.upload(projectId, dto, actor, meta(req));
  }
}
