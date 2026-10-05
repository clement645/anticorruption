import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@bpfmps/database';
import type { Allocation, BudgetStatus } from '@bpfmps/database';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { assertSameOrganization } from '../../../common/authz/organization-scope';
import { PolicyService } from '../../../common/policy/policy.service';
import type { CreateBudgetDto } from '../dto/create-budget.dto';
import type { BudgetView } from '../budget.types';

type Actor = {
  sub: string;
  email: string;
  organizationId: string | null;
  roles: string[];
};

type BudgetWithLines = Prisma.BudgetPlanGetPayload<{
  include: { lines: true };
}>;

function toView(budget: BudgetWithLines): BudgetView {
  const totalAuthorizedAmount = budget.lines
    .reduce(
      (sum, line) => sum.add(line.authorizedAmount),
      new Prisma.Decimal(0),
    )
    .toString();
  return {
    id: budget.id,
    fiscalYearId: budget.fiscalYearId,
    organizationId: budget.organizationId,
    name: budget.name,
    description: budget.description,
    status: budget.status,
    createdById: budget.createdById,
    approvedById: budget.approvedById,
    approvedAt: budget.approvedAt ? budget.approvedAt.toISOString() : null,
    rejectedAt: budget.rejectedAt ? budget.rejectedAt.toISOString() : null,
    totalAuthorizedAmount,
    lines: budget.lines.map((line) => ({
      id: line.id,
      code: line.code,
      voteCode: line.voteCode,
      voteName: line.voteName,
      programName: line.programName,
      subProgramName: line.subProgramName,
      description: line.description,
      authorizedAmount: line.authorizedAmount.toString(),
    })),
    createdAt: budget.createdAt.toISOString(),
  };
}

/**
 * Budget lifecycle: DRAFT → PENDING_APPROVAL → APPROVED | REJECTED. Strict
 * state transitions, matching the same rigor section 11 requires for
 * procurement — a budget record cannot jump between states arbitrarily.
 * Approval is the moment each BudgetLine gets its Allocation — the "Digital
 * Budget Entitlement" of section 10 — created exactly once.
 */
@Injectable()
export class BudgetsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly policy: PolicyService,
  ) {}

  async create(
    dto: CreateBudgetDto,
    actor: Actor,
    requestMeta: { ipAddress?: string; userAgent?: string },
  ): Promise<BudgetView> {
    // Closes F-001 at the point of creation: a non-Super-Administrator actor
    // can only ever create a budget for their OWN organization — the client
    // body is no longer trusted to place a budget wherever it likes. This
    // is a 403, not a silent override, so a caller that got this wrong sees
    // exactly why rather than a budget landing somewhere unexpected.
    if (
      !actor.roles.includes('Super Administrator') &&
      dto.organizationId !== actor.organizationId
    ) {
      throw new ForbiddenException(
        'You can only create a budget for your own organization',
      );
    }

    const fiscalYear = await this.prisma.fiscalYear.findUnique({
      where: { id: dto.fiscalYearId },
    });
    if (!fiscalYear) {
      throw new NotFoundException('Fiscal year not found');
    }
    if (fiscalYear.status === 'CLOSED') {
      throw new BadRequestException(
        'Cannot create a budget in a closed fiscal year',
      );
    }
    const organization = await this.prisma.organization.findUnique({
      where: { id: dto.organizationId },
    });
    if (!organization) {
      throw new NotFoundException('Organization not found');
    }

    const codes = dto.lines.map((l) => l.code);
    if (new Set(codes).size !== codes.length) {
      throw new BadRequestException(
        'Budget line codes must be unique within a budget',
      );
    }

    let budget: BudgetWithLines;
    try {
      budget = await this.prisma.budgetPlan.create({
        data: {
          fiscalYearId: dto.fiscalYearId,
          organizationId: dto.organizationId,
          name: dto.name,
          description: dto.description,
          createdById: actor.sub,
          lines: {
            create: dto.lines.map((line) => ({
              code: line.code,
              voteCode: line.voteCode,
              voteName: line.voteName,
              programName: line.programName,
              subProgramName: line.subProgramName,
              description: line.description,
              authorizedAmount: new Prisma.Decimal(line.authorizedAmount),
            })),
          },
        },
        include: { lines: true },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'A budget with this name already exists for this fiscal year/organization',
        );
      }
      throw error;
    }

    const view = toView(budget);
    await this.auditService.append({
      eventType: 'BUDGET_CREATED',
      actorId: actor.sub,
      actorEmail: actor.email,
      organizationId: actor.organizationId ?? undefined,
      resourceType: 'Budget',
      resourceId: budget.id,
      action: 'create',
      payload: {
        budgetId: budget.id,
        name: budget.name,
        fiscalYearId: budget.fiscalYearId,
        organizationId: budget.organizationId,
        lineCount: budget.lines.length,
        totalAuthorizedAmount: view.totalAuthorizedAmount,
      },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    });

    return view;
  }

  async list(params: {
    skip?: number;
    take?: number;
    organizationId?: string;
    fiscalYearId?: string;
    status?: string;
  }): Promise<{ items: BudgetView[]; total: number }> {
    const where = {
      ...(params.organizationId
        ? { organizationId: params.organizationId }
        : {}),
      ...(params.fiscalYearId ? { fiscalYearId: params.fiscalYearId } : {}),
      ...(params.status ? { status: params.status as BudgetStatus } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.budgetPlan.findMany({
        where,
        include: { lines: true },
        orderBy: { createdAt: 'desc' },
        skip: params.skip ?? 0,
        take: params.take ?? 25,
      }),
      this.prisma.budgetPlan.count({ where }),
    ]);
    return { items: items.map(toView), total };
  }

  async getByIdOrThrow(id: string): Promise<BudgetWithLines> {
    const budget = await this.prisma.budgetPlan.findUnique({
      where: { id },
      include: { lines: true },
    });
    if (!budget) {
      throw new NotFoundException('Budget not found');
    }
    return budget;
  }

  async getView(id: string): Promise<BudgetView> {
    return toView(await this.getByIdOrThrow(id));
  }

  async submit(
    id: string,
    actor: Actor,
    requestMeta: { ipAddress?: string; userAgent?: string },
  ): Promise<BudgetView> {
    const budget = await this.getByIdOrThrow(id);
    await assertSameOrganization(actor, budget.organizationId, 'budget', {
      auditService: this.auditService,
      resourceType: 'Budget',
      resourceId: id,
      action: 'submit',
      requestMeta,
    });
    if (budget.status !== 'DRAFT') {
      throw new BadRequestException(
        `Cannot submit a budget in status ${budget.status} — only DRAFT budgets can be submitted`,
      );
    }

    const updated = await this.prisma.budgetPlan.update({
      where: { id },
      data: { status: 'PENDING_APPROVAL' },
      include: { lines: true },
    });

    await this.auditService.append({
      eventType: 'BUDGET_SUBMITTED',
      actorId: actor.sub,
      actorEmail: actor.email,
      organizationId: actor.organizationId ?? undefined,
      resourceType: 'Budget',
      resourceId: id,
      action: 'submit',
      payload: { budgetId: id },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    });

    return toView(updated);
  }

  async approve(
    id: string,
    actor: Actor,
    requestMeta: { ipAddress?: string; userAgent?: string },
    verifiedSignature?: {
      signature: string;
      keyId: string;
      signedPayload: string;
    },
    stepUpVerified = false,
  ): Promise<BudgetView> {
    const budget = await this.getByIdOrThrow(id);
    await assertSameOrganization(actor, budget.organizationId, 'budget', {
      auditService: this.auditService,
      resourceType: 'Budget',
      resourceId: id,
      action: 'approve',
      requestMeta,
    });
    // F-003: the actor who created/submitted this budget cannot also be the
    // one who approves it — mirrors PaymentsService.castApproval()'s
    // existing, already-correct self-approval guard. Enforcement was
    // previously entirely operational (relying on seed data never granting
    // one account both roles); this makes it a real, code-level invariant.
    if (budget.createdById && budget.createdById === actor.sub) {
      await this.auditService
        .append({
          eventType: 'AUTHORIZATION_DENIED',
          actorId: actor.sub,
          actorEmail: actor.email,
          organizationId: actor.organizationId ?? undefined,
          resourceType: 'Budget',
          resourceId: id,
          action: 'approve',
          payload: { reason: 'self_approval_denied' },
          ipAddress: requestMeta.ipAddress,
          userAgent: requestMeta.userAgent,
        })
        .catch(() => undefined);
      throw new ForbiddenException(
        'You cannot approve a budget you created yourself',
      );
    }
    if (budget.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException(
        `Cannot approve a budget in status ${budget.status} — only PENDING_APPROVAL budgets can be approved`,
      );
    }
    await this.policy.enforce(
      {
        action: 'budget:approve',
        actor,
        resource: {
          organizationId: budget.organizationId,
          amount: budget.lines.reduce((sum, line) => sum + Number(line.authorizedAmount), 0),
        },
        stepUpVerified,
      },
      'Budget',
      id,
      requestMeta,
    );

    const allocations = await this.prisma.$transaction(async (tx) => {
      const updated = await tx.budgetPlan.update({
        where: { id },
        data: {
          status: 'APPROVED',
          approvedById: actor.sub,
          approvedAt: new Date(),
        },
      });

      const created: Allocation[] = [];
      for (const line of budget.lines) {
        const allocation = await tx.allocation.create({
          data: {
            budgetLineId: line.id,
            organizationId: budget.organizationId,
            fiscalYearId: budget.fiscalYearId,
            authorizedAmount: line.authorizedAmount,
            authorizationReference: `AUTH-${budget.id.slice(0, 8)}-${line.code}`,
          },
        });
        created.push(allocation);
      }
      return { updated, created };
    });

    for (const allocation of allocations.created) {
      await this.auditService.append({
        eventType: 'ALLOCATION_CREATED',
        actorId: actor.sub,
        actorEmail: actor.email,
        organizationId: budget.organizationId,
        resourceType: 'Allocation',
        resourceId: allocation.id,
        action: 'create',
        payload: {
          allocationId: allocation.id,
          budgetLineId: allocation.budgetLineId,
          authorizedAmount: allocation.authorizedAmount.toString(),
          authorizationReference: allocation.authorizationReference,
        },
        ipAddress: requestMeta.ipAddress,
        userAgent: requestMeta.userAgent,
      });
    }

    await this.auditService.append({
      eventType: 'BUDGET_APPROVED',
      actorId: actor.sub,
      actorEmail: actor.email,
      organizationId: actor.organizationId ?? undefined,
      resourceType: 'Budget',
      resourceId: id,
      action: 'approve',
      payload: { budgetId: id, allocationsCreated: allocations.created.length },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
      actorSignature: verifiedSignature?.signature,
      actorKeyId: verifiedSignature?.keyId,
      actorSignedPayload: verifiedSignature?.signedPayload,
    });

    return this.getView(id);
  }

  async reject(
    id: string,
    reason: string | undefined,
    actor: Actor,
    requestMeta: { ipAddress?: string; userAgent?: string },
  ): Promise<BudgetView> {
    const budget = await this.getByIdOrThrow(id);
    await assertSameOrganization(actor, budget.organizationId, 'budget', {
      auditService: this.auditService,
      resourceType: 'Budget',
      resourceId: id,
      action: 'reject',
      requestMeta,
    });
    if (budget.status !== 'PENDING_APPROVAL') {
      throw new BadRequestException(
        `Cannot reject a budget in status ${budget.status} — only PENDING_APPROVAL budgets can be rejected`,
      );
    }

    const updated = await this.prisma.budgetPlan.update({
      where: { id },
      data: { status: 'REJECTED', rejectedAt: new Date() },
      include: { lines: true },
    });

    await this.auditService.append({
      eventType: 'BUDGET_REJECTED',
      actorId: actor.sub,
      actorEmail: actor.email,
      organizationId: actor.organizationId ?? undefined,
      resourceType: 'Budget',
      resourceId: id,
      action: 'reject',
      payload: { budgetId: id, reason: reason ?? null },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    });

    return toView(updated);
  }
}
