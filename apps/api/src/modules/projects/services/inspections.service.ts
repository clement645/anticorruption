import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Inspection } from '@bpfmps/database';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { InspectionOutcomeDto } from '../dto/create-inspection.dto';
import type { CreateInspectionDto } from '../dto/create-inspection.dto';
import type { InspectionView } from '../projects.types';
import { MilestonesService } from './milestones.service';
import { ProjectsService } from './projects.service';

type Actor = { sub: string; email: string; organizationId: string | null };
type RequestMeta = { ipAddress?: string; userAgent?: string };

function toView(i: Inspection): InspectionView {
  return {
    id: i.id,
    milestoneId: i.milestoneId,
    inspectedById: i.inspectedById,
    inspectedAt: i.inspectedAt.toISOString(),
    outcome: i.outcome,
    findings: i.findings,
  };
}

/**
 * `project:inspect` (Engineer) is deliberately a different permission from
 * `project:manage` (Project Manager, who marks milestones COMPLETED) — see
 * schema.prisma comment on Inspection for the separation-of-duties
 * reasoning. A PASSED inspection verifies the milestone and, if every
 * milestone on the project is now VERIFIED, auto-completes the project
 * (ProjectsService.maybeMarkCompleted()).
 */
@Injectable()
export class InspectionsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly milestonesService: MilestonesService,
    private readonly projectsService: ProjectsService,
  ) {}

  async create(
    milestoneId: string,
    dto: CreateInspectionDto,
    actor: Actor,
    requestMeta: RequestMeta,
  ): Promise<InspectionView> {
    const milestone = await this.prisma.milestone.findUnique({
      where: { id: milestoneId },
    });
    if (!milestone) {
      throw new NotFoundException('Milestone not found');
    }
    if (milestone.status !== 'COMPLETED') {
      throw new BadRequestException(
        'Milestone must be COMPLETED before it can be inspected',
      );
    }

    const inspection = await this.prisma.inspection.create({
      data: {
        milestoneId,
        inspectedById: actor.sub,
        outcome: dto.outcome,
        findings: dto.findings,
      },
    });

    await this.milestonesService.applyInspectionOutcome(
      milestoneId,
      dto.outcome,
    );

    if (dto.outcome === InspectionOutcomeDto.PASSED) {
      await this.projectsService.maybeMarkCompleted(milestone.projectId);
    }

    await this.auditService.append({
      eventType: 'INSPECTION_RECORDED',
      actorId: actor.sub,
      actorEmail: actor.email,
      organizationId: actor.organizationId ?? undefined,
      resourceType: 'Inspection',
      resourceId: inspection.id,
      action: 'create',
      payload: {
        inspectionId: inspection.id,
        milestoneId,
        outcome: dto.outcome,
      },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    });

    return toView(inspection);
  }

  async list(milestoneId?: string): Promise<InspectionView[]> {
    const inspections = await this.prisma.inspection.findMany({
      where: milestoneId ? { milestoneId } : undefined,
      orderBy: { inspectedAt: 'desc' },
    });
    return inspections.map(toView);
  }

  async getByIdOrThrow(id: string): Promise<Inspection> {
    const inspection = await this.prisma.inspection.findUnique({
      where: { id },
    });
    if (!inspection) {
      throw new NotFoundException('Inspection not found');
    }
    return inspection;
  }

  async getView(id: string): Promise<InspectionView> {
    return toView(await this.getByIdOrThrow(id));
  }
}
