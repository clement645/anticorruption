import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Prisma, Supplier } from '@bpfmps/database';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { SupplierRiskDetector } from '../../risk/services/supplier-risk.detector';
import type { UpdateSupplierProfileDto } from '../dto/update-supplier-profile.dto';
import type { SupplierProfileView } from '../supplier.types';

type Actor = { sub: string; email: string; organizationId: string | null };
type RequestMeta = { ipAddress?: string; userAgent?: string };

export function toProfileView(supplier: Supplier): SupplierProfileView {
  return {
    id: supplier.id,
    name: supplier.name,
    registrationNumber: supplier.registrationNumber,
    email: supplier.email,
    phone: supplier.phone,
    status: supplier.status,
    businessType: supplier.businessType,
    taxIdentifier: supplier.taxIdentifier,
    physicalAddress: supplier.physicalAddress,
    county: supplier.county,
    contactPersonName: supplier.contactPersonName,
    createdAt: supplier.createdAt.toISOString(),
    updatedAt: supplier.updatedAt.toISOString(),
  };
}

/**
 * Extends the minimal Supplier identity Phase 6 created (see schema.prisma
 * comment on Supplier) with the registration profile fields section 12
 * expects, plus the ACTIVE/SUSPENDED/BLACKLISTED status transitions that
 * enum has always declared but nothing exercised until now —
 * `BidsService.submit()` already rejects bids from a non-ACTIVE supplier
 * (Phase 6), so these transitions are not cosmetic: suspending a supplier
 * here immediately blocks it from bidding.
 */
@Injectable()
export class SupplierProfileService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly supplierRiskDetector: SupplierRiskDetector,
  ) {}

  async getByIdOrThrow(id: string): Promise<Supplier> {
    const supplier = await this.prisma.supplier.findUnique({ where: { id } });
    if (!supplier) {
      throw new NotFoundException('Supplier not found');
    }
    return supplier;
  }

  async getView(id: string): Promise<SupplierProfileView> {
    return toProfileView(await this.getByIdOrThrow(id));
  }

  async update(
    id: string,
    dto: UpdateSupplierProfileDto,
    actor: Actor,
    requestMeta: RequestMeta,
  ): Promise<SupplierProfileView> {
    await this.getByIdOrThrow(id);

    const updated = await this.prisma.supplier.update({
      where: { id },
      data: dto,
    });

    await this.auditService.append({
      eventType: 'SUPPLIER_PROFILE_UPDATED',
      actorId: actor.sub,
      actorEmail: actor.email,
      organizationId: actor.organizationId ?? undefined,
      resourceType: 'Supplier',
      resourceId: id,
      action: 'update',
      payload: {
        supplierId: id,
        changes: dto as unknown as Prisma.InputJsonObject,
      },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    });

    return toProfileView(updated);
  }

  async suspend(
    id: string,
    actor: Actor,
    requestMeta: RequestMeta,
  ): Promise<SupplierProfileView> {
    const supplier = await this.getByIdOrThrow(id);
    if (supplier.status !== 'ACTIVE') {
      throw new BadRequestException(
        `Cannot suspend a supplier in status ${supplier.status} — only ACTIVE suppliers can be suspended`,
      );
    }

    const updated = await this.prisma.supplier.update({
      where: { id },
      data: { status: 'SUSPENDED' },
    });

    await this.auditService.append({
      eventType: 'SUPPLIER_SUSPENDED',
      actorId: actor.sub,
      actorEmail: actor.email,
      organizationId: actor.organizationId ?? undefined,
      resourceType: 'Supplier',
      resourceId: id,
      action: 'suspend',
      payload: { supplierId: id },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    });

    await this.supplierRiskDetector.evaluateSupplier(id);

    return toProfileView(updated);
  }

  async reactivate(
    id: string,
    actor: Actor,
    requestMeta: RequestMeta,
  ): Promise<SupplierProfileView> {
    const supplier = await this.getByIdOrThrow(id);
    if (supplier.status !== 'SUSPENDED') {
      throw new BadRequestException(
        `Cannot reactivate a supplier in status ${supplier.status} — only SUSPENDED suppliers can be reactivated`,
      );
    }

    const updated = await this.prisma.supplier.update({
      where: { id },
      data: { status: 'ACTIVE' },
    });

    await this.auditService.append({
      eventType: 'SUPPLIER_REACTIVATED',
      actorId: actor.sub,
      actorEmail: actor.email,
      organizationId: actor.organizationId ?? undefined,
      resourceType: 'Supplier',
      resourceId: id,
      action: 'reactivate',
      payload: { supplierId: id },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    });

    // Re-evaluate so the risk profile drops the "currently suspended"
    // factor immediately — it should reflect current reality, not stay
    // inflated after a legitimate reactivation.
    await this.supplierRiskDetector.evaluateSupplier(id);

    return toProfileView(updated);
  }

  /**
   * A one-way door by design: unlike reactivate(), there is no API path back
   * from BLACKLISTED. Un-blacklisting a supplier flagged for serious cause
   * is deliberately not a single-actor action available today — see
   * THREAT_MODEL.md Phase 7 residual risk (pending a multi-signature/policy
   * engine, same limitation already documented for budget/procurement
   * approval).
   */
  async blacklist(
    id: string,
    actor: Actor,
    requestMeta: RequestMeta,
  ): Promise<SupplierProfileView> {
    const supplier = await this.getByIdOrThrow(id);
    if (supplier.status === 'BLACKLISTED') {
      throw new BadRequestException('Supplier is already BLACKLISTED');
    }

    const updated = await this.prisma.supplier.update({
      where: { id },
      data: { status: 'BLACKLISTED' },
    });

    await this.auditService.append({
      eventType: 'SUPPLIER_BLACKLISTED',
      actorId: actor.sub,
      actorEmail: actor.email,
      organizationId: actor.organizationId ?? undefined,
      resourceType: 'Supplier',
      resourceId: id,
      action: 'blacklist',
      payload: { supplierId: id },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    });

    await this.supplierRiskDetector.evaluateSupplier(id);

    return toProfileView(updated);
  }
}
