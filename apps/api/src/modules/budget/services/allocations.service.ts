import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@bpfmps/database';
import type { Allocation, Commitment } from '@bpfmps/database';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import type { CreateCommitmentDto } from '../dto/create-commitment.dto';
import type { CreateExpenditureDto } from '../dto/create-expenditure.dto';
import type { CreateAdjustmentDto } from '../dto/create-adjustment.dto';
import type {
  AllocationView,
  BudgetAdjustmentView,
  CommitmentView,
  ExpenditureView,
} from '../budget.types';

type Actor = { sub: string; email: string; organizationId: string | null };
type RequestMeta = { ipAddress?: string; userAgent?: string };

function availableOf(allocation: {
  authorizedAmount: Prisma.Decimal;
  committedAmount: Prisma.Decimal;
  spentAmount: Prisma.Decimal;
}): Prisma.Decimal {
  return allocation.authorizedAmount
    .sub(allocation.committedAmount)
    .sub(allocation.spentAmount);
}

function toAllocationView(allocation: Allocation): AllocationView {
  return {
    id: allocation.id,
    budgetLineId: allocation.budgetLineId,
    organizationId: allocation.organizationId,
    fiscalYearId: allocation.fiscalYearId,
    authorizedAmount: allocation.authorizedAmount.toString(),
    committedAmount: allocation.committedAmount.toString(),
    spentAmount: allocation.spentAmount.toString(),
    availableAmount: availableOf(allocation).toString(),
    status: allocation.status,
    authorizationReference: allocation.authorizationReference,
    blockchainTxRef: allocation.blockchainTxRef,
    createdAt: allocation.createdAt.toISOString(),
  };
}

function toCommitmentView(commitment: Commitment): CommitmentView {
  return {
    id: commitment.id,
    allocationId: commitment.allocationId,
    amount: commitment.amount.toString(),
    description: commitment.description,
    status: commitment.status,
    createdById: commitment.createdById,
    releasedAt: commitment.releasedAt
      ? commitment.releasedAt.toISOString()
      : null,
    createdAt: commitment.createdAt.toISOString(),
  };
}

/**
 * Commitment-control accounting for Allocations (section 9/10): every
 * balance-changing operation runs inside a transaction that takes a
 * `SELECT ... FOR UPDATE` row lock on the Allocation first, so two
 * concurrent requests against the same allocation cannot both read a stale
 * "available" balance and both succeed when only one has room — the second
 * blocks until the first commits, then re-checks against the now-current
 * balance. A DB CHECK constraint on `allocations` (see schema.prisma) is the
 * defense-in-depth backstop if this invariant is ever violated by a future
 * code path that forgets to lock.
 */
@Injectable()
export class AllocationsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async list(params: {
    skip?: number;
    take?: number;
    organizationId?: string;
    fiscalYearId?: string;
  }): Promise<{ items: AllocationView[]; total: number }> {
    const where = {
      ...(params.organizationId
        ? { organizationId: params.organizationId }
        : {}),
      ...(params.fiscalYearId ? { fiscalYearId: params.fiscalYearId } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.allocation.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: params.skip ?? 0,
        take: params.take ?? 25,
      }),
      this.prisma.allocation.count({ where }),
    ]);
    return { items: items.map(toAllocationView), total };
  }

  async getView(id: string): Promise<AllocationView> {
    const allocation = await this.prisma.allocation.findUnique({
      where: { id },
    });
    if (!allocation) {
      throw new NotFoundException('Allocation not found');
    }
    return toAllocationView(allocation);
  }

  /** Locks the row and returns its current balances. Must run inside `tx`. */
  private async lockAllocation(
    tx: Prisma.TransactionClient,
    allocationId: string,
  ): Promise<Allocation> {
    const rows = await tx.$queryRaw<Allocation[]>`
      SELECT * FROM allocations WHERE id = ${allocationId} FOR UPDATE
    `;
    if (rows.length === 0) {
      throw new NotFoundException('Allocation not found');
    }
    return rows[0];
  }

  async createCommitment(
    allocationId: string,
    dto: CreateCommitmentDto,
    actor: Actor,
    requestMeta: RequestMeta,
  ): Promise<CommitmentView> {
    const amount = new Prisma.Decimal(dto.amount);

    const commitment = await this.prisma.$transaction(async (tx) => {
      const allocation = await this.lockAllocation(tx, allocationId);
      if (allocation.status !== 'ACTIVE') {
        throw new BadRequestException(
          `Allocation is ${allocation.status}, not ACTIVE`,
        );
      }
      const available = availableOf(allocation);
      if (amount.gt(available)) {
        throw new ConflictException(
          `Insufficient available budget: requested ${amount.toString()}, available ${available.toString()}`,
        );
      }

      await tx.allocation.update({
        where: { id: allocationId },
        data: { committedAmount: allocation.committedAmount.add(amount) },
      });

      return tx.commitment.create({
        data: {
          allocationId,
          amount,
          description: dto.description,
          createdById: actor.sub,
        },
      });
    });

    await this.auditService.append({
      eventType: 'COMMITMENT_CREATED',
      actorId: actor.sub,
      actorEmail: actor.email,
      organizationId: actor.organizationId ?? undefined,
      resourceType: 'Commitment',
      resourceId: commitment.id,
      action: 'create',
      payload: {
        commitmentId: commitment.id,
        allocationId,
        amount: amount.toString(),
        description: dto.description,
      },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    });

    return toCommitmentView(commitment);
  }

  async releaseCommitment(
    commitmentId: string,
    actor: Actor,
    requestMeta: RequestMeta,
  ): Promise<CommitmentView> {
    const existing = await this.prisma.commitment.findUnique({
      where: { id: commitmentId },
    });
    if (!existing) {
      throw new NotFoundException('Commitment not found');
    }
    if (existing.status !== 'ACTIVE') {
      throw new BadRequestException(
        `Commitment is ${existing.status}, not ACTIVE`,
      );
    }

    const commitment = await this.prisma.$transaction(async (tx) => {
      const allocation = await this.lockAllocation(tx, existing.allocationId);
      await tx.allocation.update({
        where: { id: allocation.id },
        data: {
          committedAmount: allocation.committedAmount.sub(existing.amount),
        },
      });
      return tx.commitment.update({
        where: { id: commitmentId },
        data: { status: 'RELEASED', releasedAt: new Date() },
      });
    });

    await this.auditService.append({
      eventType: 'COMMITMENT_RELEASED',
      actorId: actor.sub,
      actorEmail: actor.email,
      organizationId: actor.organizationId ?? undefined,
      resourceType: 'Commitment',
      resourceId: commitmentId,
      action: 'release',
      payload: {
        commitmentId,
        allocationId: existing.allocationId,
        amount: existing.amount.toString(),
      },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    });

    return toCommitmentView(commitment);
  }

  async createExpenditure(
    commitmentId: string,
    dto: CreateExpenditureDto,
    actor: Actor,
    requestMeta: RequestMeta,
  ): Promise<ExpenditureView> {
    const existing = await this.prisma.commitment.findUnique({
      where: { id: commitmentId },
    });
    if (!existing) {
      throw new NotFoundException('Commitment not found');
    }
    if (existing.status !== 'ACTIVE') {
      throw new BadRequestException(
        `Commitment is ${existing.status}, not ACTIVE`,
      );
    }
    const amount = new Prisma.Decimal(dto.amount);
    if (amount.gt(existing.amount)) {
      throw new BadRequestException(
        `Expenditure amount ${amount.toString()} exceeds committed amount ${existing.amount.toString()}`,
      );
    }

    const expenditure = await this.prisma.$transaction(async (tx) => {
      const allocation = await this.lockAllocation(tx, existing.allocationId);
      // The full committed reservation is released — any difference between
      // the commitment and the actual expenditure simply becomes available
      // again (see schema.prisma comment: no partial-commitment tracking
      // across multiple expenditures in this phase).
      await tx.allocation.update({
        where: { id: allocation.id },
        data: {
          committedAmount: allocation.committedAmount.sub(existing.amount),
          spentAmount: allocation.spentAmount.add(amount),
        },
      });
      await tx.commitment.update({
        where: { id: commitmentId },
        data: { status: 'CONSUMED' },
      });
      return tx.expenditure.create({
        data: {
          commitmentId,
          allocationId: existing.allocationId,
          amount,
          description: dto.description,
          recordedById: actor.sub,
        },
      });
    });

    await this.auditService.append({
      eventType: 'EXPENDITURE_RECORDED',
      actorId: actor.sub,
      actorEmail: actor.email,
      organizationId: actor.organizationId ?? undefined,
      resourceType: 'Expenditure',
      resourceId: expenditure.id,
      action: 'create',
      payload: {
        expenditureId: expenditure.id,
        commitmentId,
        allocationId: existing.allocationId,
        amount: amount.toString(),
      },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    });

    return {
      id: expenditure.id,
      commitmentId: expenditure.commitmentId,
      allocationId: expenditure.allocationId,
      amount: expenditure.amount.toString(),
      description: expenditure.description,
      recordedById: expenditure.recordedById,
      createdAt: expenditure.createdAt.toISOString(),
    };
  }

  async createAdjustment(
    allocationId: string,
    dto: CreateAdjustmentDto,
    actor: Actor,
    requestMeta: RequestMeta,
  ): Promise<BudgetAdjustmentView> {
    const allocation = await this.prisma.allocation.findUnique({
      where: { id: allocationId },
    });
    if (!allocation) {
      throw new NotFoundException('Allocation not found');
    }

    const adjustment = await this.prisma.budgetAdjustment.create({
      data: {
        allocationId,
        type: dto.type,
        amount: new Prisma.Decimal(dto.amount),
        reason: dto.reason,
        requestedById: actor.sub,
      },
    });

    await this.auditService.append({
      eventType: 'BUDGET_ADJUSTMENT_REQUESTED',
      actorId: actor.sub,
      actorEmail: actor.email,
      organizationId: actor.organizationId ?? undefined,
      resourceType: 'BudgetAdjustment',
      resourceId: adjustment.id,
      action: 'request',
      payload: {
        adjustmentId: adjustment.id,
        allocationId,
        type: dto.type,
        amount: dto.amount.toString(),
        reason: dto.reason,
      },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    });

    return {
      id: adjustment.id,
      allocationId: adjustment.allocationId,
      type: adjustment.type,
      amount: adjustment.amount.toString(),
      reason: adjustment.reason,
      status: adjustment.status,
      requestedById: adjustment.requestedById,
      approvedById: adjustment.approvedById,
      approvedAt: adjustment.approvedAt
        ? adjustment.approvedAt.toISOString()
        : null,
      createdAt: adjustment.createdAt.toISOString(),
    };
  }

  async approveAdjustment(
    adjustmentId: string,
    actor: Actor,
    requestMeta: RequestMeta,
  ): Promise<BudgetAdjustmentView> {
    const existing = await this.prisma.budgetAdjustment.findUnique({
      where: { id: adjustmentId },
    });
    if (!existing) {
      throw new NotFoundException('Adjustment not found');
    }
    if (existing.status !== 'PENDING') {
      throw new BadRequestException(
        `Adjustment is ${existing.status}, not PENDING`,
      );
    }

    const adjustment = await this.prisma.$transaction(async (tx) => {
      const allocation = await this.lockAllocation(tx, existing.allocationId);

      let newAuthorized: Prisma.Decimal;
      // Comparing against the string literal, not BudgetAdjustmentTypeDto,
      // since `existing.type` is Prisma's own generated enum (same string
      // values, distinct TS enum type) — the DTO enum is only for request
      // validation.
      if (existing.type === 'INCREASE') {
        newAuthorized = allocation.authorizedAmount.add(existing.amount);
      } else {
        newAuthorized = allocation.authorizedAmount.sub(existing.amount);
        const committedPlusSpent = allocation.committedAmount.add(
          allocation.spentAmount,
        );
        if (newAuthorized.lt(committedPlusSpent)) {
          throw new ConflictException(
            `Cannot decrease authorized amount below already committed+spent (${committedPlusSpent.toString()})`,
          );
        }
      }

      await tx.allocation.update({
        where: { id: allocation.id },
        data: { authorizedAmount: newAuthorized },
      });

      return tx.budgetAdjustment.update({
        where: { id: adjustmentId },
        data: {
          status: 'APPROVED',
          approvedById: actor.sub,
          approvedAt: new Date(),
        },
      });
    });

    await this.auditService.append({
      eventType: 'BUDGET_ADJUSTMENT_APPROVED',
      actorId: actor.sub,
      actorEmail: actor.email,
      organizationId: actor.organizationId ?? undefined,
      resourceType: 'BudgetAdjustment',
      resourceId: adjustmentId,
      action: 'approve',
      payload: {
        adjustmentId,
        allocationId: existing.allocationId,
        type: existing.type,
        amount: existing.amount.toString(),
      },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    });

    return {
      id: adjustment.id,
      allocationId: adjustment.allocationId,
      type: adjustment.type,
      amount: adjustment.amount.toString(),
      reason: adjustment.reason,
      status: adjustment.status,
      requestedById: adjustment.requestedById,
      approvedById: adjustment.approvedById,
      approvedAt: adjustment.approvedAt
        ? adjustment.approvedAt.toISOString()
        : null,
      createdAt: adjustment.createdAt.toISOString(),
    };
  }

  async rejectAdjustment(
    adjustmentId: string,
    actor: Actor,
    requestMeta: RequestMeta,
  ): Promise<BudgetAdjustmentView> {
    const existing = await this.prisma.budgetAdjustment.findUnique({
      where: { id: adjustmentId },
    });
    if (!existing) {
      throw new NotFoundException('Adjustment not found');
    }
    if (existing.status !== 'PENDING') {
      throw new BadRequestException(
        `Adjustment is ${existing.status}, not PENDING`,
      );
    }

    const adjustment = await this.prisma.budgetAdjustment.update({
      where: { id: adjustmentId },
      data: { status: 'REJECTED' },
    });

    await this.auditService.append({
      eventType: 'BUDGET_ADJUSTMENT_REJECTED',
      actorId: actor.sub,
      actorEmail: actor.email,
      organizationId: actor.organizationId ?? undefined,
      resourceType: 'BudgetAdjustment',
      resourceId: adjustmentId,
      action: 'reject',
      payload: { adjustmentId },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    });

    return {
      id: adjustment.id,
      allocationId: adjustment.allocationId,
      type: adjustment.type,
      amount: adjustment.amount.toString(),
      reason: adjustment.reason,
      status: adjustment.status,
      requestedById: adjustment.requestedById,
      approvedById: adjustment.approvedById,
      approvedAt: adjustment.approvedAt
        ? adjustment.approvedAt.toISOString()
        : null,
      createdAt: adjustment.createdAt.toISOString(),
    };
  }
}
