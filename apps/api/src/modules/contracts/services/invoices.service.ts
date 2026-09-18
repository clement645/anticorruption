import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@bpfmps/database';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import type { CreateInvoiceDto } from '../dto/create-invoice.dto';
import type { RejectInvoiceDto } from '../dto/reject-invoice.dto';
import type { InvoiceView } from '../contracts.types';

type Actor = { sub: string; email: string; organizationId: string | null };
type RequestMeta = { ipAddress?: string; userAgent?: string };

type InvoiceWithItems = Prisma.InvoiceGetPayload<{ include: { items: true } }>;

function toView(invoice: InvoiceWithItems): InvoiceView {
  return {
    id: invoice.id,
    purchaseOrderId: invoice.purchaseOrderId,
    supplierId: invoice.supplierId,
    invoiceNumber: invoice.invoiceNumber,
    amount: invoice.amount.toString(),
    dueDate: invoice.dueDate ? invoice.dueDate.toISOString() : null,
    status: invoice.status,
    items: invoice.items.map((item) => ({
      id: item.id,
      description: item.description,
      quantity: item.quantity.toString(),
      unitPrice: item.unitPrice.toString(),
      amount: item.amount.toString(),
    })),
    submittedById: invoice.submittedById,
    verifiedById: invoice.verifiedById,
    verifiedAt: invoice.verifiedAt ? invoice.verifiedAt.toISOString() : null,
    rejectionReason: invoice.rejectionReason,
    createdAt: invoice.createdAt.toISOString(),
  };
}

/**
 * No supplier self-service portal exists yet — an invoice is recorded BY
 * internal staff (`invoice:submit`) on a supplier's behalf, not submitted
 * through the supplier's own login (see schema.prisma comment on Invoice).
 * `verify()` is the real trigger for a PaymentRequest — mirrors Phase 6's
 * "approving a request auto-creates a Commitment" pattern.
 */
@Injectable()
export class InvoicesService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(
    purchaseOrderId: string,
    dto: CreateInvoiceDto,
    actor: Actor,
    requestMeta: RequestMeta,
  ): Promise<InvoiceView> {
    const po = await this.prisma.purchaseOrder.findUnique({
      where: { id: purchaseOrderId },
      include: { contract: true },
    });
    if (!po) {
      throw new NotFoundException('Purchase order not found');
    }
    if (po.status !== 'ISSUED') {
      throw new BadRequestException(
        'Purchase order must be ISSUED before an invoice can be submitted against it',
      );
    }

    let invoice: InvoiceWithItems;
    try {
      invoice = await this.prisma.invoice.create({
        data: {
          purchaseOrderId,
          supplierId: po.contract.supplierId,
          invoiceNumber: dto.invoiceNumber,
          amount: new Prisma.Decimal(dto.amount),
          dueDate: dto.dueDate ? new Date(dto.dueDate) : undefined,
          submittedById: actor.sub,
          items: {
            create: dto.items.map((item) => ({
              description: item.description,
              quantity: new Prisma.Decimal(item.quantity),
              unitPrice: new Prisma.Decimal(item.unitPrice),
              amount: new Prisma.Decimal(item.amount),
            })),
          },
        },
        include: { items: true },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('This invoice number is already in use');
      }
      throw error;
    }

    await this.auditService.append({
      eventType: 'INVOICE_SUBMITTED',
      actorId: actor.sub,
      actorEmail: actor.email,
      organizationId: actor.organizationId ?? undefined,
      resourceType: 'Invoice',
      resourceId: invoice.id,
      action: 'create',
      payload: {
        invoiceId: invoice.id,
        purchaseOrderId,
        invoiceNumber: dto.invoiceNumber,
        amount: dto.amount.toString(),
      },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    });

    return toView(invoice);
  }

  async list(): Promise<InvoiceView[]> {
    const invoices = await this.prisma.invoice.findMany({
      include: { items: true },
      orderBy: { createdAt: 'desc' },
    });
    return invoices.map(toView);
  }

  async getByIdOrThrow(id: string): Promise<InvoiceWithItems> {
    const invoice = await this.prisma.invoice.findUnique({
      where: { id },
      include: { items: true },
    });
    if (!invoice) {
      throw new NotFoundException('Invoice not found');
    }
    return invoice;
  }

  async getView(id: string): Promise<InvoiceView> {
    return toView(await this.getByIdOrThrow(id));
  }

  async verify(
    id: string,
    actor: Actor,
    requestMeta: RequestMeta,
  ): Promise<InvoiceView> {
    const invoice = await this.getByIdOrThrow(id);
    if (invoice.status !== 'SUBMITTED') {
      throw new BadRequestException(
        `Cannot verify an invoice in status ${invoice.status} — only SUBMITTED invoices can be verified`,
      );
    }

    const [updated] = await this.prisma.$transaction([
      this.prisma.invoice.update({
        where: { id },
        data: {
          status: 'VERIFIED',
          verifiedById: actor.sub,
          verifiedAt: new Date(),
        },
        include: { items: true },
      }),
      this.prisma.paymentRequest.create({
        data: { invoiceId: id, amount: invoice.amount },
      }),
    ]);

    await this.auditService.append({
      eventType: 'INVOICE_VERIFIED',
      actorId: actor.sub,
      actorEmail: actor.email,
      organizationId: actor.organizationId ?? undefined,
      resourceType: 'Invoice',
      resourceId: id,
      action: 'verify',
      payload: { invoiceId: id },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    });

    return toView(updated);
  }

  async reject(
    id: string,
    dto: RejectInvoiceDto,
    actor: Actor,
    requestMeta: RequestMeta,
  ): Promise<InvoiceView> {
    const invoice = await this.getByIdOrThrow(id);
    if (invoice.status !== 'SUBMITTED') {
      throw new BadRequestException(
        `Cannot reject an invoice in status ${invoice.status} — only SUBMITTED invoices can be rejected`,
      );
    }

    const updated = await this.prisma.invoice.update({
      where: { id },
      data: { status: 'REJECTED', rejectionReason: dto.reason },
      include: { items: true },
    });

    await this.auditService.append({
      eventType: 'INVOICE_REJECTED',
      actorId: actor.sub,
      actorEmail: actor.email,
      organizationId: actor.organizationId ?? undefined,
      resourceType: 'Invoice',
      resourceId: id,
      action: 'reject',
      payload: { invoiceId: id, reason: dto.reason },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    });

    return toView(updated);
  }
}
