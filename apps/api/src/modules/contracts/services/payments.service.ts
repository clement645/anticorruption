import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@bpfmps/database';
import type {
  Payment,
  PaymentRequest,
  PaymentReconciliation,
} from '@bpfmps/database';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { AllocationsService } from '../../budget/services/allocations.service';
import { PaymentApprovalDecisionDto } from '../dto/payment-approval.dto';
import type { PaymentApprovalDto } from '../dto/payment-approval.dto';
import type { RecordReconciliationDto } from '../dto/record-reconciliation.dto';
import type {
  PaymentReconciliationView,
  PaymentRequestView,
  PaymentView,
} from '../contracts.types';

type Actor = { sub: string; email: string; organizationId: string | null };
type RequestMeta = { ipAddress?: string; userAgent?: string };

type PaymentRequestWithApprovals = Prisma.PaymentRequestGetPayload<{
  include: { approvals: true };
}>;

function toRequestView(pr: PaymentRequestWithApprovals): PaymentRequestView {
  return {
    id: pr.id,
    invoiceId: pr.invoiceId,
    amount: pr.amount.toString(),
    requiredApprovals: pr.requiredApprovals,
    status: pr.status,
    approvals: pr.approvals.map((a) => ({
      id: a.id,
      approvedById: a.approvedById,
      decision: a.decision,
      notes: a.notes,
      createdAt: a.createdAt.toISOString(),
    })),
    createdAt: pr.createdAt.toISOString(),
  };
}

function toPaymentView(payment: Payment): PaymentView {
  return {
    id: payment.id,
    paymentRequestId: payment.paymentRequestId,
    expenditureId: payment.expenditureId,
    amount: payment.amount.toString(),
    idempotencyKey: payment.idempotencyKey,
    reference: payment.reference,
    executedById: payment.executedById,
    executedAt: payment.executedAt.toISOString(),
  };
}

function toReconciliationView(
  r: PaymentReconciliation,
): PaymentReconciliationView {
  return {
    id: r.id,
    paymentId: r.paymentId,
    externalReference: r.externalReference,
    status: r.status,
    notes: r.notes,
    reconciledById: r.reconciledById,
    createdAt: r.createdAt.toISOString(),
  };
}

/**
 * Multi-signature payment approval + Idempotency-Key-backed execution
 * (section 18 / SECURITY.md § Idempotency & Concurrency). See schema.prisma
 * comments on PaymentRequest and Payment for the concurrency-safety
 * reasoning behind the row-locked approval count and the claim-then-work
 * execution sequence, respectively.
 */
@Injectable()
export class PaymentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly allocationsService: AllocationsService,
  ) {}

  async listRequests(): Promise<PaymentRequestView[]> {
    const requests = await this.prisma.paymentRequest.findMany({
      include: { approvals: true },
      orderBy: { createdAt: 'desc' },
    });
    return requests.map(toRequestView);
  }

  async getRequestByIdOrThrow(
    id: string,
  ): Promise<PaymentRequestWithApprovals> {
    const pr = await this.prisma.paymentRequest.findUnique({
      where: { id },
      include: { approvals: true },
    });
    if (!pr) {
      throw new NotFoundException('Payment request not found');
    }
    return pr;
  }

  async getRequestView(id: string): Promise<PaymentRequestView> {
    return toRequestView(await this.getRequestByIdOrThrow(id));
  }

  /** Row-locks the PaymentRequest for the count-check-then-transition — a running-tally problem, same shape as Phase 5's allocation balances, not a "create once" one (see DATABASE.md § 4 Conventions). */
  private async lockPaymentRequest(
    tx: Prisma.TransactionClient,
    id: string,
  ): Promise<PaymentRequest> {
    const rows = await tx.$queryRaw<PaymentRequest[]>`
      SELECT * FROM payment_requests WHERE id = ${id} FOR UPDATE
    `;
    if (rows.length === 0) {
      throw new NotFoundException('Payment request not found');
    }
    return rows[0];
  }

  async castApproval(
    paymentRequestId: string,
    dto: PaymentApprovalDto,
    actor: Actor,
    requestMeta: RequestMeta,
  ): Promise<PaymentRequestView> {
    const invoiceCheck = await this.prisma.paymentRequest.findUnique({
      where: { id: paymentRequestId },
      include: { invoice: true },
    });
    if (!invoiceCheck) {
      throw new NotFoundException('Payment request not found');
    }
    if (invoiceCheck.invoice.verifiedById === actor.sub) {
      throw new ForbiddenException(
        'Cannot approve a payment for an invoice you verified yourself',
      );
    }

    const updated = await this.prisma.$transaction(async (tx) => {
      const pr = await this.lockPaymentRequest(tx, paymentRequestId);
      if (pr.status !== 'PENDING') {
        throw new BadRequestException(
          `Cannot record an approval decision — this payment request is ${pr.status}`,
        );
      }

      try {
        await tx.paymentApproval.create({
          data: {
            paymentRequestId,
            approvedById: actor.sub,
            decision: dto.decision,
            notes: dto.notes,
          },
        });
      } catch (error) {
        if (
          error instanceof Prisma.PrismaClientKnownRequestError &&
          error.code === 'P2002'
        ) {
          throw new ConflictException(
            'You have already recorded a decision on this payment request',
          );
        }
        throw error;
      }

      if (dto.decision === PaymentApprovalDecisionDto.REJECT) {
        return tx.paymentRequest.update({
          where: { id: paymentRequestId },
          data: { status: 'REJECTED' },
          include: { approvals: true },
        });
      }

      const approveCount = await tx.paymentApproval.count({
        where: { paymentRequestId, decision: 'APPROVE' },
      });
      if (approveCount >= pr.requiredApprovals) {
        return tx.paymentRequest.update({
          where: { id: paymentRequestId },
          data: { status: 'APPROVED' },
          include: { approvals: true },
        });
      }
      return tx.paymentRequest.findUniqueOrThrow({
        where: { id: paymentRequestId },
        include: { approvals: true },
      });
    });

    await this.auditService.append({
      eventType: 'PAYMENT_APPROVAL_RECORDED',
      actorId: actor.sub,
      actorEmail: actor.email,
      organizationId: actor.organizationId ?? undefined,
      resourceType: 'PaymentRequest',
      resourceId: paymentRequestId,
      action: 'approve',
      payload: {
        paymentRequestId,
        decision: dto.decision,
        resultingStatus: updated.status,
      },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    });

    return toRequestView(updated);
  }

  async execute(
    paymentRequestId: string,
    idempotencyKey: string,
    actor: Actor,
    requestMeta: RequestMeta,
  ): Promise<PaymentView> {
    // Checked FIRST, before any status validation — a genuine client retry
    // (the exact scenario Idempotency-Key exists for: the first attempt's
    // response was dropped, but it actually succeeded server-side) arrives
    // AFTER the payment request has already moved to EXECUTED. Validating
    // status before checking for a prior replay of this same key would
    // incorrectly 400 a legitimate retry instead of handing back the
    // original result — found via manual smoke testing before this ever
    // reached an automated test.
    const existingByKey = await this.prisma.payment.findUnique({
      where: { idempotencyKey },
    });
    if (existingByKey) {
      return toPaymentView(existingByKey);
    }

    const pr = await this.prisma.paymentRequest.findUnique({
      where: { id: paymentRequestId },
      include: {
        invoice: {
          include: { purchaseOrder: { include: { contract: true } } },
        },
      },
    });
    if (!pr) {
      throw new NotFoundException('Payment request not found');
    }
    if (pr.status !== 'APPROVED') {
      throw new BadRequestException(
        `Cannot execute a payment request in status ${pr.status} — it must be APPROVED`,
      );
    }

    // Phase 1: atomically claim the idempotency key BEFORE touching the
    // budget. The unique constraint on `idempotencyKey` (and, as a second
    // independent guard, on `paymentRequestId`) is what arbitrates a genuine
    // concurrent race that both requests slip past the check above —
    // whichever concurrent call's INSERT wins proceeds to Phase 2; the loser
    // is simply handed back this same row without ever calling into the
    // budget.
    let payment: Payment;
    try {
      payment = await this.prisma.payment.create({
        data: {
          paymentRequestId,
          amount: pr.amount,
          idempotencyKey,
          reference: `PAY-${Date.now().toString(36).toUpperCase()}-${randomUUID().slice(0, 8).toUpperCase()}`,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        // Deliberately does NOT branch on error.meta.target: this Payment
        // row has unique constraints on BOTH idempotencyKey AND
        // paymentRequestId, and under genuine multi-way concurrency with
        // every request sharing the SAME key, several losing requests
        // violate both simultaneously — Postgres/Prisma does not
        // consistently report the same one as "the" violated constraint
        // across concurrent callers. Found via a real 5-way concurrent
        // stress test: some losers were reported against
        // `paymentRequestId` even though their key was identical, which a
        // target-based branch would have misclassified as "different key"
        // and wrongly rejected. Checking directly for an existing row under
        // THIS key is unambiguous regardless of what Postgres reported.
        const existingByKey = await this.prisma.payment.findUnique({
          where: { idempotencyKey },
        });
        if (existingByKey) {
          return toPaymentView(existingByKey);
        }
        throw new ConflictException(
          'This payment request has already been executed under a different idempotency key',
        );
      }
      throw error;
    }

    // Phase 2: do the real work — this is the actual trigger, at last, for
    // a budget Expenditure sourced from procurement (see schema.prisma
    // comment on Contract for the one Phase 5 interaction this has: if this
    // contract's commitment was already consumed by a sibling contract's
    // payment, createExpenditure() throws a clear 400, not a raw
    // constraint error).
    try {
      const expenditure = await this.allocationsService.createExpenditure(
        pr.invoice.purchaseOrder.contract.commitmentId,
        {
          amount: Number(pr.amount),
          description: `Payment for invoice ${pr.invoice.invoiceNumber} (PO ${pr.invoice.purchaseOrder.poNumber})`,
        },
        actor,
        requestMeta,
      );

      const [finalizedPayment] = await this.prisma.$transaction([
        this.prisma.payment.update({
          where: { id: payment.id },
          data: { expenditureId: expenditure.id, executedById: actor.sub },
        }),
        this.prisma.invoice.update({
          where: { id: pr.invoiceId },
          data: { status: 'PAID' },
        }),
        this.prisma.paymentRequest.update({
          where: { id: paymentRequestId },
          data: { status: 'EXECUTED' },
        }),
      ]);

      await this.auditService.append({
        eventType: 'PAYMENT_EXECUTED',
        actorId: actor.sub,
        actorEmail: actor.email,
        organizationId: actor.organizationId ?? undefined,
        resourceType: 'Payment',
        resourceId: finalizedPayment.id,
        action: 'execute',
        payload: {
          paymentId: finalizedPayment.id,
          paymentRequestId,
          expenditureId: expenditure.id,
          amount: pr.amount.toString(),
          idempotencyKey,
        },
        ipAddress: requestMeta.ipAddress,
        userAgent: requestMeta.userAgent,
      });

      return toPaymentView(finalizedPayment);
    } catch (error) {
      // The claim succeeded but the real work failed — delete the claim so
      // this idempotency key isn't permanently poisoned; a client that
      // fixes the underlying problem (e.g. waits for a sibling payment to
      // clear) can legitimately retry with a NEW key.
      await this.prisma.payment.delete({ where: { id: payment.id } });
      throw error;
    }
  }

  async listPayments(): Promise<PaymentView[]> {
    const payments = await this.prisma.payment.findMany({
      where: { expenditureId: { not: null } },
      orderBy: { executedAt: 'desc' },
    });
    return payments.map(toPaymentView);
  }

  async getPaymentByIdOrThrow(id: string): Promise<Payment> {
    const payment = await this.prisma.payment.findUnique({ where: { id } });
    if (!payment) {
      throw new NotFoundException('Payment not found');
    }
    return payment;
  }

  async getPaymentView(id: string): Promise<PaymentView> {
    return toPaymentView(await this.getPaymentByIdOrThrow(id));
  }

  async recordReconciliation(
    paymentId: string,
    dto: RecordReconciliationDto,
    actor: Actor,
    requestMeta: RequestMeta,
  ): Promise<PaymentReconciliationView> {
    await this.getPaymentByIdOrThrow(paymentId);

    const reconciliation = await this.prisma.paymentReconciliation.create({
      data: {
        paymentId,
        externalReference: dto.externalReference,
        status: dto.status,
        notes: dto.notes,
        reconciledById: actor.sub,
      },
    });

    await this.auditService.append({
      eventType: 'PAYMENT_RECONCILED',
      actorId: actor.sub,
      actorEmail: actor.email,
      organizationId: actor.organizationId ?? undefined,
      resourceType: 'Payment',
      resourceId: paymentId,
      action: 'reconcile',
      payload: {
        paymentId,
        status: dto.status,
        externalReference: dto.externalReference,
      },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    });

    return toReconciliationView(reconciliation);
  }
}
