import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@bpfmps/database';
import type { PurchaseOrder } from '@bpfmps/database';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import type { CreatePurchaseOrderDto } from '../dto/create-purchase-order.dto';
import type { PurchaseOrderView } from '../contracts.types';

type Actor = { sub: string; email: string; organizationId: string | null };
type RequestMeta = { ipAddress?: string; userAgent?: string };

function toView(po: PurchaseOrder): PurchaseOrderView {
  return {
    id: po.id,
    contractId: po.contractId,
    poNumber: po.poNumber,
    description: po.description,
    amount: po.amount.toString(),
    status: po.status,
    issuedById: po.issuedById,
    issuedAt: po.issuedAt ? po.issuedAt.toISOString() : null,
    createdAt: po.createdAt.toISOString(),
  };
}

@Injectable()
export class PurchaseOrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
  ) {}

  async create(
    contractId: string,
    dto: CreatePurchaseOrderDto,
    actor: Actor,
    requestMeta: RequestMeta,
  ): Promise<PurchaseOrderView> {
    const contract = await this.prisma.contract.findUnique({
      where: { id: contractId },
    });
    if (!contract) {
      throw new NotFoundException('Contract not found');
    }
    if (contract.status !== 'ACTIVE') {
      throw new BadRequestException(
        'Contract must be ACTIVE before a purchase order can be raised against it',
      );
    }

    let po: PurchaseOrder;
    try {
      po = await this.prisma.purchaseOrder.create({
        data: {
          contractId,
          poNumber: dto.poNumber,
          description: dto.description,
          amount: new Prisma.Decimal(dto.amount),
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('This PO number is already in use');
      }
      throw error;
    }

    await this.auditService.append({
      eventType: 'PURCHASE_ORDER_CREATED',
      actorId: actor.sub,
      actorEmail: actor.email,
      organizationId: actor.organizationId ?? undefined,
      resourceType: 'PurchaseOrder',
      resourceId: po.id,
      action: 'create',
      payload: { purchaseOrderId: po.id, contractId, poNumber: dto.poNumber },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    });

    return toView(po);
  }

  async list(): Promise<PurchaseOrderView[]> {
    const pos = await this.prisma.purchaseOrder.findMany({
      orderBy: { createdAt: 'desc' },
    });
    return pos.map(toView);
  }

  async getByIdOrThrow(id: string): Promise<PurchaseOrder> {
    const po = await this.prisma.purchaseOrder.findUnique({ where: { id } });
    if (!po) {
      throw new NotFoundException('Purchase order not found');
    }
    return po;
  }

  async getView(id: string): Promise<PurchaseOrderView> {
    return toView(await this.getByIdOrThrow(id));
  }

  async issue(
    id: string,
    actor: Actor,
    requestMeta: RequestMeta,
  ): Promise<PurchaseOrderView> {
    const po = await this.getByIdOrThrow(id);
    if (po.status !== 'DRAFT') {
      throw new BadRequestException(
        `Cannot issue a purchase order in status ${po.status}`,
      );
    }

    const updated = await this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: 'ISSUED', issuedById: actor.sub, issuedAt: new Date() },
    });

    await this.auditService.append({
      eventType: 'PURCHASE_ORDER_ISSUED',
      actorId: actor.sub,
      actorEmail: actor.email,
      organizationId: actor.organizationId ?? undefined,
      resourceType: 'PurchaseOrder',
      resourceId: id,
      action: 'issue',
      payload: { purchaseOrderId: id },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    });

    return toView(updated);
  }

  async cancel(
    id: string,
    actor: Actor,
    requestMeta: RequestMeta,
  ): Promise<PurchaseOrderView> {
    const po = await this.getByIdOrThrow(id);
    if (po.status === 'FULFILLED' || po.status === 'CANCELLED') {
      throw new BadRequestException(
        `Cannot cancel a purchase order in status ${po.status}`,
      );
    }

    const updated = await this.prisma.purchaseOrder.update({
      where: { id },
      data: { status: 'CANCELLED' },
    });

    await this.auditService.append({
      eventType: 'PURCHASE_ORDER_CANCELLED',
      actorId: actor.sub,
      actorEmail: actor.email,
      organizationId: actor.organizationId ?? undefined,
      resourceType: 'PurchaseOrder',
      resourceId: id,
      action: 'cancel',
      payload: { purchaseOrderId: id },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    });

    return toView(updated);
  }
}
