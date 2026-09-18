import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@bpfmps/database';
import type {
  ProcurementRequest,
  ProcurementRequestStatus,
} from '@bpfmps/database';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { AllocationsService } from '../../budget/services/allocations.service';
import { SplitProcurementDetector } from '../../risk/services/split-procurement.detector';
import type { CreateRequestDto } from '../dto/create-request.dto';
import type { ProcurementRequestView } from '../procurement.types';

type Actor = { sub: string; email: string; organizationId: string | null };
type RequestMeta = { ipAddress?: string; userAgent?: string };

function toView(request: ProcurementRequest): ProcurementRequestView {
  return {
    id: request.id,
    procurementPlanId: request.procurementPlanId,
    organizationId: request.organizationId,
    allocationId: request.allocationId,
    title: request.title,
    description: request.description,
    estimatedAmount: request.estimatedAmount.toString(),
    status: request.status,
    commitmentId: request.commitmentId,
    requestedById: request.requestedById,
    approvedById: request.approvedById,
    approvedAt: request.approvedAt ? request.approvedAt.toISOString() : null,
    rejectedAt: request.rejectedAt ? request.rejectedAt.toISOString() : null,
    createdAt: request.createdAt.toISOString(),
  };
}

/**
 * The Budget↔Procurement integration point (section 9): approving a request
 * creates a real budget Commitment against the referenced Allocation, by
 * calling into Phase 5's AllocationsService — reusing its row-locked
 * "cannot commit beyond available balance" safety rather than duplicating
 * that logic here.
 */
@Injectable()
export class ProcurementRequestsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly allocationsService: AllocationsService,
    private readonly splitProcurementDetector: SplitProcurementDetector,
  ) {}

  async create(
    dto: CreateRequestDto,
    actor: Actor,
    requestMeta: RequestMeta,
  ): Promise<ProcurementRequestView> {
    const plan = await this.prisma.procurementPlan.findUnique({
      where: { id: dto.procurementPlanId },
    });
    if (!plan) {
      throw new NotFoundException('Procurement plan not found');
    }
    if (plan.status !== 'APPROVED') {
      throw new BadRequestException(
        'Procurement plan must be APPROVED before requests can be raised against it',
      );
    }
    const allocation = await this.prisma.allocation.findUnique({
      where: { id: dto.allocationId },
    });
    if (!allocation) {
      throw new NotFoundException('Allocation not found');
    }

    const request = await this.prisma.procurementRequest.create({
      data: {
        procurementPlanId: dto.procurementPlanId,
        organizationId: dto.organizationId,
        allocationId: dto.allocationId,
        title: dto.title,
        description: dto.description,
        estimatedAmount: new Prisma.Decimal(dto.estimatedAmount),
        requestedById: actor.sub,
      },
    });

    await this.auditService.append({
      eventType: 'PROCUREMENT_REQUEST_CREATED',
      actorId: actor.sub,
      actorEmail: actor.email,
      organizationId: actor.organizationId ?? undefined,
      resourceType: 'ProcurementRequest',
      resourceId: request.id,
      action: 'create',
      payload: {
        requestId: request.id,
        title: request.title,
        allocationId: request.allocationId,
        estimatedAmount: dto.estimatedAmount.toString(),
      },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    });

    return toView(request);
  }

  async list(params: {
    organizationId?: string;
    status?: string;
  }): Promise<ProcurementRequestView[]> {
    const requests = await this.prisma.procurementRequest.findMany({
      where: {
        ...(params.organizationId
          ? { organizationId: params.organizationId }
          : {}),
        ...(params.status
          ? { status: params.status as ProcurementRequestStatus }
          : {}),
      },
      orderBy: { createdAt: 'desc' },
    });
    return requests.map(toView);
  }

  async getByIdOrThrow(id: string): Promise<ProcurementRequest> {
    const request = await this.prisma.procurementRequest.findUnique({
      where: { id },
    });
    if (!request) {
      throw new NotFoundException('Procurement request not found');
    }
    return request;
  }

  async getView(id: string): Promise<ProcurementRequestView> {
    return toView(await this.getByIdOrThrow(id));
  }

  async submit(
    id: string,
    actor: Actor,
    requestMeta: RequestMeta,
  ): Promise<ProcurementRequestView> {
    const request = await this.getByIdOrThrow(id);
    if (request.status !== 'DRAFT') {
      throw new BadRequestException(
        `Cannot submit a request in status ${request.status}`,
      );
    }

    const updated = await this.prisma.procurementRequest.update({
      where: { id },
      data: { status: 'SUBMITTED' },
    });

    await this.auditService.append({
      eventType: 'PROCUREMENT_REQUEST_SUBMITTED',
      actorId: actor.sub,
      actorEmail: actor.email,
      organizationId: actor.organizationId ?? undefined,
      resourceType: 'ProcurementRequest',
      resourceId: id,
      action: 'submit',
      payload: { requestId: id },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    });

    return toView(updated);
  }

  async approve(
    id: string,
    actor: Actor,
    requestMeta: RequestMeta,
  ): Promise<ProcurementRequestView> {
    const request = await this.getByIdOrThrow(id);
    if (request.status !== 'SUBMITTED') {
      throw new BadRequestException(
        `Cannot approve a request in status ${request.status}`,
      );
    }

    // Reuses Phase 5's row-locked commitment creation — this is where
    // "insufficient available budget" (409) would surface if the allocation
    // can't cover the estimated amount.
    const commitment = await this.allocationsService.createCommitment(
      request.allocationId,
      {
        amount: Number(request.estimatedAmount),
        description: `Procurement request: ${request.title}`,
      },
      actor,
      requestMeta,
    );

    const updated = await this.prisma.procurementRequest.update({
      where: { id },
      data: {
        status: 'APPROVED',
        approvedById: actor.sub,
        approvedAt: new Date(),
        commitmentId: commitment.id,
      },
    });

    await this.auditService.append({
      eventType: 'PROCUREMENT_REQUEST_APPROVED',
      actorId: actor.sub,
      actorEmail: actor.email,
      organizationId: actor.organizationId ?? undefined,
      resourceType: 'ProcurementRequest',
      resourceId: id,
      action: 'approve',
      payload: { requestId: id, commitmentId: commitment.id },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    });

    await this.splitProcurementDetector.evaluateOrganization(
      updated.organizationId,
      updated.id,
    );

    return toView(updated);
  }

  async reject(
    id: string,
    actor: Actor,
    requestMeta: RequestMeta,
  ): Promise<ProcurementRequestView> {
    const request = await this.getByIdOrThrow(id);
    if (request.status !== 'SUBMITTED') {
      throw new BadRequestException(
        `Cannot reject a request in status ${request.status}`,
      );
    }

    const updated = await this.prisma.procurementRequest.update({
      where: { id },
      data: { status: 'REJECTED', rejectedAt: new Date() },
    });

    await this.auditService.append({
      eventType: 'PROCUREMENT_REQUEST_REJECTED',
      actorId: actor.sub,
      actorEmail: actor.email,
      organizationId: actor.organizationId ?? undefined,
      resourceType: 'ProcurementRequest',
      resourceId: id,
      action: 'reject',
      payload: { requestId: id },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    });

    return toView(updated);
  }
}
