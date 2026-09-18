import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@bpfmps/database';
import type { Milestone } from '@bpfmps/database';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import type { CreateMilestoneDto } from '../dto/create-milestone.dto';
import type { MilestoneView } from '../projects.types';

type Actor = { sub: string; email: string; organizationId: string | null };
type RequestMeta = { ipAddress?: string; userAgent?: string };

function toView(m: Milestone): MilestoneView {
  return {
    id: m.id,
    projectId: m.projectId,
    sequenceNumber: m.sequenceNumber,
    title: m.title,
    description: m.description,
    plannedAmount: m.plannedAmount.toString(),
    plannedDate: m.plannedDate.toISOString(),
    status: m.status,
    completedAt: m.completedAt ? m.completedAt.toISOString() : null,
  };
}

/**
 * PENDING → IN_PROGRESS → COMPLETED → VERIFIED. The last transition
 * (→ VERIFIED) is not made here — it happens as a side effect of
 * InspectionsService recording a PASSED outcome, the same
 * "verification is a consequence of an independent review action, not a
 * self-declared status" judgment used throughout this project since Phase
 * 6 (evaluate → award) and Phase 9 (verify → PaymentRequest).
 */
@Injectable()
export class MilestonesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(
    projectId: string,
    dto: CreateMilestoneDto,
    actor: Actor,
    requestMeta: RequestMeta,
  ): Promise<MilestoneView> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project) {
      throw new NotFoundException('Project not found');
    }
    if (project.status !== 'PLANNED') {
      // Milestones must be fully defined while the project is still
      // PLANNED — activate() is the point at which the milestone list is
      // frozen, the same "child list is locked before the parent's
      // all-children-done auto-transition can be trusted" gate Tenders
      // enforces via CLOSED before TendersService.maybeMarkAwarded() (see
      // that method's own tender.status !== 'CLOSED' guard). Without this,
      // ProjectsService.maybeMarkCompleted() could observe "every existing
      // milestone is VERIFIED" and complete the project after only the
      // first of several intended milestones was ever added.
      throw new BadRequestException(
        `Cannot add a milestone to a project in status ${project.status} — milestones must be defined before the project is activated`,
      );
    }

    let milestone: Milestone;
    try {
      milestone = await this.prisma.milestone.create({
        data: {
          projectId,
          sequenceNumber: dto.sequenceNumber,
          title: dto.title,
          description: dto.description,
          plannedAmount: new Prisma.Decimal(dto.plannedAmount),
          plannedDate: new Date(dto.plannedDate),
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'This project already has a milestone with that sequence number',
        );
      }
      throw error;
    }

    await this.auditService.append({
      eventType: 'MILESTONE_CREATED',
      actorId: actor.sub,
      actorEmail: actor.email,
      organizationId: actor.organizationId ?? undefined,
      resourceType: 'Milestone',
      resourceId: milestone.id,
      action: 'create',
      payload: { milestoneId: milestone.id, projectId, title: dto.title },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    });

    return toView(milestone);
  }

  async list(projectId?: string): Promise<MilestoneView[]> {
    const milestones = await this.prisma.milestone.findMany({
      where: projectId ? { projectId } : undefined,
      orderBy: [{ projectId: 'asc' }, { sequenceNumber: 'asc' }],
    });
    return milestones.map(toView);
  }

  async getByIdOrThrow(id: string): Promise<Milestone> {
    const milestone = await this.prisma.milestone.findUnique({ where: { id } });
    if (!milestone) {
      throw new NotFoundException('Milestone not found');
    }
    return milestone;
  }

  async getView(id: string): Promise<MilestoneView> {
    return toView(await this.getByIdOrThrow(id));
  }

  async markInProgress(
    id: string,
    actor: Actor,
    requestMeta: RequestMeta,
  ): Promise<MilestoneView> {
    const milestone = await this.getByIdOrThrow(id);
    if (milestone.status !== 'PENDING') {
      throw new BadRequestException(
        `Cannot start a milestone in status ${milestone.status}`,
      );
    }

    const updated = await this.prisma.milestone.update({
      where: { id },
      data: { status: 'IN_PROGRESS' },
    });

    await this.auditService.append({
      eventType: 'MILESTONE_STARTED',
      actorId: actor.sub,
      actorEmail: actor.email,
      organizationId: actor.organizationId ?? undefined,
      resourceType: 'Milestone',
      resourceId: id,
      action: 'start',
      payload: { milestoneId: id },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    });

    return toView(updated);
  }

  async markCompleted(
    id: string,
    actor: Actor,
    requestMeta: RequestMeta,
  ): Promise<MilestoneView> {
    const milestone = await this.getByIdOrThrow(id);
    if (milestone.status !== 'IN_PROGRESS' && milestone.status !== 'PENDING') {
      throw new BadRequestException(
        `Cannot complete a milestone in status ${milestone.status}`,
      );
    }

    const updated = await this.prisma.milestone.update({
      where: { id },
      data: { status: 'COMPLETED', completedAt: new Date() },
    });

    await this.auditService.append({
      eventType: 'MILESTONE_COMPLETED',
      actorId: actor.sub,
      actorEmail: actor.email,
      organizationId: actor.organizationId ?? undefined,
      resourceType: 'Milestone',
      resourceId: id,
      action: 'complete',
      payload: { milestoneId: id },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    });

    return toView(updated);
  }

  /** Used by InspectionsService: PASSED -> VERIFIED, FAILED/NEEDS_REVISION -> back to IN_PROGRESS for rework. */
  async applyInspectionOutcome(
    id: string,
    outcome: 'PASSED' | 'FAILED' | 'NEEDS_REVISION',
  ): Promise<Milestone> {
    return this.prisma.milestone.update({
      where: { id },
      data: { status: outcome === 'PASSED' ? 'VERIFIED' : 'IN_PROGRESS' },
    });
  }
}
