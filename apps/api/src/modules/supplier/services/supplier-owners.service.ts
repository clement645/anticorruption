import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@bpfmps/database';
import type { SupplierOwner } from '@bpfmps/database';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { SupplierRiskDetector } from '../../risk/services/supplier-risk.detector';
import type { AddOwnerDto } from '../dto/add-owner.dto';
import type { SupplierOwnerView } from '../supplier.types';
import { SupplierProfileService } from './supplier-profile.service';

type Actor = { sub: string; email: string; organizationId: string | null };
type RequestMeta = { ipAddress?: string; userAgent?: string };

function toView(owner: SupplierOwner): SupplierOwnerView {
  return {
    id: owner.id,
    supplierId: owner.supplierId,
    fullName: owner.fullName,
    nationalIdOrPassport: owner.nationalIdOrPassport,
    ownershipPercentage: owner.ownershipPercentage.toString(),
    position: owner.position,
    isPoliticallyExposedPerson: owner.isPoliticallyExposedPerson,
    createdAt: owner.createdAt.toISOString(),
  };
}

/**
 * Beneficial ownership disclosure (section 12). The 0-100 bound on a single
 * row is a DB CHECK constraint (defense in depth); the "total ownership
 * across owners should not exceed 100%" invariant is checked here at the
 * application layer only — a deliberate, documented gap (not a financial
 * balance, low real-world concurrency, doesn't justify a row lock — see
 * schema.prisma comment on the CHECK-constraint migration and
 * THREAT_MODEL.md Phase 7).
 */
@Injectable()
export class SupplierOwnersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly supplierProfileService: SupplierProfileService,
    private readonly supplierRiskDetector: SupplierRiskDetector,
  ) {}

  async list(supplierId: string): Promise<SupplierOwnerView[]> {
    await this.supplierProfileService.getByIdOrThrow(supplierId);
    const owners = await this.prisma.supplierOwner.findMany({
      where: { supplierId },
      orderBy: { createdAt: 'asc' },
    });
    return owners.map(toView);
  }

  async add(
    supplierId: string,
    dto: AddOwnerDto,
    actor: Actor,
    requestMeta: RequestMeta,
  ): Promise<SupplierOwnerView> {
    await this.supplierProfileService.getByIdOrThrow(supplierId);

    const existing = await this.prisma.supplierOwner.findMany({
      where: { supplierId },
      select: { ownershipPercentage: true },
    });
    const currentTotal = existing.reduce(
      (sum, o) => sum.add(o.ownershipPercentage),
      new Prisma.Decimal(0),
    );
    const newTotal = currentTotal.add(
      new Prisma.Decimal(dto.ownershipPercentage),
    );
    if (newTotal.gt(100)) {
      throw new BadRequestException(
        `Total disclosed ownership would be ${newTotal.toString()}% — cannot exceed 100%`,
      );
    }

    const owner = await this.prisma.supplierOwner.create({
      data: {
        supplierId,
        fullName: dto.fullName,
        nationalIdOrPassport: dto.nationalIdOrPassport,
        ownershipPercentage: new Prisma.Decimal(dto.ownershipPercentage),
        position: dto.position,
        isPoliticallyExposedPerson: dto.isPoliticallyExposedPerson ?? false,
      },
    });

    await this.auditService.append({
      eventType: 'SUPPLIER_OWNER_ADDED',
      actorId: actor.sub,
      actorEmail: actor.email,
      organizationId: actor.organizationId ?? undefined,
      resourceType: 'SupplierOwner',
      resourceId: owner.id,
      action: 'create',
      payload: {
        supplierId,
        ownerId: owner.id,
        ownershipPercentage: dto.ownershipPercentage.toString(),
        isPoliticallyExposedPerson: owner.isPoliticallyExposedPerson,
      },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    });

    if (owner.isPoliticallyExposedPerson) {
      await this.supplierRiskDetector.evaluateSupplier(supplierId);
    }

    return toView(owner);
  }

  async remove(
    supplierId: string,
    ownerId: string,
    actor: Actor,
    requestMeta: RequestMeta,
  ): Promise<void> {
    const owner = await this.prisma.supplierOwner.findUnique({
      where: { id: ownerId },
    });
    if (!owner || owner.supplierId !== supplierId) {
      throw new NotFoundException('Supplier owner record not found');
    }

    await this.prisma.supplierOwner.delete({ where: { id: ownerId } });

    // The row is gone, but the audit event preserves who was removed, when,
    // and by whom — append-only history survives even though the live
    // ownership table doesn't keep soft-deleted rows.
    await this.auditService.append({
      eventType: 'SUPPLIER_OWNER_REMOVED',
      actorId: actor.sub,
      actorEmail: actor.email,
      organizationId: actor.organizationId ?? undefined,
      resourceType: 'SupplierOwner',
      resourceId: ownerId,
      action: 'delete',
      payload: {
        supplierId,
        ownerId,
        fullName: owner.fullName,
        ownershipPercentage: owner.ownershipPercentage.toString(),
      },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    });
  }
}
