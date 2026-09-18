import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { ProcurementPlan } from '@bpfmps/database';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import type { CreatePlanDto } from '../dto/create-plan.dto';
import type { ProcurementPlanView } from '../procurement.types';

type Actor = { sub: string; email: string; organizationId: string | null };
type RequestMeta = { ipAddress?: string; userAgent?: string };

function toView(plan: ProcurementPlan): ProcurementPlanView {
  return {
    id: plan.id,
    organizationId: plan.organizationId,
    fiscalYearId: plan.fiscalYearId,
    name: plan.name,
    description: plan.description,
    status: plan.status,
    approvedById: plan.approvedById,
    approvedAt: plan.approvedAt ? plan.approvedAt.toISOString() : null,
    createdAt: plan.createdAt.toISOString(),
  };
}

@Injectable()
export class ProcurementPlansService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(
    dto: CreatePlanDto,
    actor: Actor,
    requestMeta: RequestMeta,
  ): Promise<ProcurementPlanView> {
    const plan = await this.prisma.procurementPlan.create({
      data: {
        organizationId: dto.organizationId,
        fiscalYearId: dto.fiscalYearId,
        name: dto.name,
        description: dto.description,
        createdById: actor.sub,
      },
    });

    await this.auditService.append({
      eventType: 'PROCUREMENT_PLAN_CREATED',
      actorId: actor.sub,
      actorEmail: actor.email,
      organizationId: actor.organizationId ?? undefined,
      resourceType: 'ProcurementPlan',
      resourceId: plan.id,
      action: 'create',
      payload: {
        planId: plan.id,
        name: plan.name,
        organizationId: plan.organizationId,
      },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    });

    return toView(plan);
  }

  async list(): Promise<ProcurementPlanView[]> {
    const plans = await this.prisma.procurementPlan.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return plans.map(toView);
  }

  async getByIdOrThrow(id: string): Promise<ProcurementPlan> {
    const plan = await this.prisma.procurementPlan.findUnique({
      where: { id },
    });
    if (!plan) {
      throw new NotFoundException('Procurement plan not found');
    }
    return plan;
  }

  async getView(id: string): Promise<ProcurementPlanView> {
    return toView(await this.getByIdOrThrow(id));
  }

  async approve(
    id: string,
    actor: Actor,
    requestMeta: RequestMeta,
  ): Promise<ProcurementPlanView> {
    const plan = await this.getByIdOrThrow(id);
    if (plan.status !== 'DRAFT') {
      throw new BadRequestException(
        `Cannot approve a plan in status ${plan.status}`,
      );
    }

    const updated = await this.prisma.procurementPlan.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approvedById: actor.sub,
        approvedAt: new Date(),
      },
    });

    await this.auditService.append({
      eventType: 'PROCUREMENT_PLAN_APPROVED',
      actorId: actor.sub,
      actorEmail: actor.email,
      organizationId: actor.organizationId ?? undefined,
      resourceType: 'ProcurementPlan',
      resourceId: id,
      action: 'approve',
      payload: { planId: id },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    });

    return toView(updated);
  }
}
