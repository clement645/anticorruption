import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@bpfmps/database';
import type { Project } from '@bpfmps/database';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import type { CreateProjectDto } from '../dto/create-project.dto';
import type { ProjectView } from '../projects.types';

type Actor = { sub: string; email: string; organizationId: string | null };
type RequestMeta = { ipAddress?: string; userAgent?: string };

function toView(project: Project): ProjectView {
  return {
    id: project.id,
    contractId: project.contractId,
    organizationId: project.organizationId,
    name: project.name,
    description: project.description,
    location: project.location,
    status: project.status,
    startDate: project.startDate.toISOString(),
    plannedEndDate: project.plannedEndDate.toISOString(),
    actualEndDate: project.actualEndDate
      ? project.actualEndDate.toISOString()
      : null,
    createdById: project.createdById,
    createdAt: project.createdAt.toISOString(),
  };
}

/**
 * `organizationId` is derived server-side from the Contract, never accepted
 * as client input — the same anti-tampering judgment Phase 9 made for
 * Contract's own budget-line fields (see schema.prisma comment on Project).
 */
@Injectable()
export class ProjectsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(
    dto: CreateProjectDto,
    actor: Actor,
    requestMeta: RequestMeta,
  ): Promise<ProjectView> {
    const contract = await this.prisma.contract.findUnique({
      where: { id: dto.contractId },
    });
    if (!contract) {
      throw new NotFoundException('Contract not found');
    }
    if (contract.status !== 'ACTIVE') {
      throw new BadRequestException(
        'Contract must be ACTIVE before a project can be raised against it',
      );
    }

    let project: Project;
    try {
      project = await this.prisma.project.create({
        data: {
          contractId: dto.contractId,
          organizationId: contract.organizationId,
          name: dto.name,
          description: dto.description,
          location: dto.location,
          startDate: new Date(dto.startDate),
          plannedEndDate: new Date(dto.plannedEndDate),
          createdById: actor.sub,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'A project already exists for this contract',
        );
      }
      throw error;
    }

    await this.auditService.append({
      eventType: 'PROJECT_CREATED',
      actorId: actor.sub,
      actorEmail: actor.email,
      organizationId: actor.organizationId ?? undefined,
      resourceType: 'Project',
      resourceId: project.id,
      action: 'create',
      payload: {
        projectId: project.id,
        contractId: dto.contractId,
        name: dto.name,
      },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    });

    return toView(project);
  }

  async list(): Promise<ProjectView[]> {
    const projects = await this.prisma.project.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return projects.map(toView);
  }

  async getByIdOrThrow(id: string): Promise<Project> {
    const project = await this.prisma.project.findUnique({ where: { id } });
    if (!project) {
      throw new NotFoundException('Project not found');
    }
    return project;
  }

  async getView(id: string): Promise<ProjectView> {
    return toView(await this.getByIdOrThrow(id));
  }

  async activate(
    id: string,
    actor: Actor,
    requestMeta: RequestMeta,
  ): Promise<ProjectView> {
    const project = await this.getByIdOrThrow(id);
    if (project.status !== 'PLANNED') {
      throw new BadRequestException(
        `Cannot activate a project in status ${project.status}`,
      );
    }

    const updated = await this.prisma.project.update({
      where: { id },
      data: { status: 'IN_PROGRESS' },
    });

    await this.auditService.append({
      eventType: 'PROJECT_ACTIVATED',
      actorId: actor.sub,
      actorEmail: actor.email,
      organizationId: actor.organizationId ?? undefined,
      resourceType: 'Project',
      resourceId: id,
      action: 'activate',
      payload: { projectId: id },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    });

    return toView(updated);
  }

  async suspend(
    id: string,
    actor: Actor,
    requestMeta: RequestMeta,
  ): Promise<ProjectView> {
    const project = await this.getByIdOrThrow(id);
    if (project.status !== 'IN_PROGRESS') {
      throw new BadRequestException(
        `Cannot suspend a project in status ${project.status}`,
      );
    }

    const updated = await this.prisma.project.update({
      where: { id },
      data: { status: 'SUSPENDED' },
    });

    await this.auditService.append({
      eventType: 'PROJECT_SUSPENDED',
      actorId: actor.sub,
      actorEmail: actor.email,
      organizationId: actor.organizationId ?? undefined,
      resourceType: 'Project',
      resourceId: id,
      action: 'suspend',
      payload: { projectId: id },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    });

    return toView(updated);
  }

  async resume(
    id: string,
    actor: Actor,
    requestMeta: RequestMeta,
  ): Promise<ProjectView> {
    const project = await this.getByIdOrThrow(id);
    if (project.status !== 'SUSPENDED') {
      throw new BadRequestException(
        `Cannot resume a project in status ${project.status}`,
      );
    }

    const updated = await this.prisma.project.update({
      where: { id },
      data: { status: 'IN_PROGRESS' },
    });

    await this.auditService.append({
      eventType: 'PROJECT_RESUMED',
      actorId: actor.sub,
      actorEmail: actor.email,
      organizationId: actor.organizationId ?? undefined,
      resourceType: 'Project',
      resourceId: id,
      action: 'resume',
      payload: { projectId: id },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    });

    return toView(updated);
  }

  async cancel(
    id: string,
    actor: Actor,
    requestMeta: RequestMeta,
  ): Promise<ProjectView> {
    const project = await this.getByIdOrThrow(id);
    if (project.status === 'COMPLETED' || project.status === 'CANCELLED') {
      throw new BadRequestException(
        `Cannot cancel a project in status ${project.status}`,
      );
    }

    const updated = await this.prisma.project.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });

    await this.auditService.append({
      eventType: 'PROJECT_CANCELLED',
      actorId: actor.sub,
      actorEmail: actor.email,
      organizationId: actor.organizationId ?? undefined,
      resourceType: 'Project',
      resourceId: id,
      action: 'cancel',
      payload: { projectId: id },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    });

    return toView(updated);
  }

  /**
   * Called by MilestonesService after each milestone reaches VERIFIED — the
   * same "auto-transition once every child reaches its terminal state"
   * pattern Phase 6's TendersService.maybeMarkAwarded() already established.
   */
  async maybeMarkCompleted(projectId: string): Promise<void> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
      include: { milestones: true },
    });
    if (!project || project.status !== 'IN_PROGRESS') {
      return;
    }
    const allVerified =
      project.milestones.length > 0 &&
      project.milestones.every((m) => m.status === 'VERIFIED');
    if (allVerified) {
      await this.prisma.project.update({
        where: { id: projectId },
        data: { status: 'COMPLETED', actualEndDate: new Date() },
      });
    }
  }
}
