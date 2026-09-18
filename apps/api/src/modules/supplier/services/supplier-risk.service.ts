import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma } from '@bpfmps/database';
import type { SupplierRiskProfile } from '@bpfmps/database';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import type { RecordRiskAssessmentDto } from '../dto/record-risk-assessment.dto';
import type { SupplierRiskProfileView } from '../supplier.types';
import { SupplierProfileService } from './supplier-profile.service';

type Actor = { sub: string; email: string; organizationId: string | null };
type RequestMeta = { ipAddress?: string; userAgent?: string };

function toView(profile: SupplierRiskProfile): SupplierRiskProfileView {
  return {
    id: profile.id,
    supplierId: profile.supplierId,
    riskLevel: profile.riskLevel,
    score: profile.score.toString(),
    factors: profile.factors,
    notes: profile.notes,
    assessedById: profile.assessedById,
    assessedAt: profile.assessedAt.toISOString(),
  };
}

/**
 * Manual risk assessments only (see schema.prisma comment on
 * SupplierRiskProfile) — append-only history, never updated in place. The
 * "current" risk profile is simply the most recent row. Phase 8's AI Risk
 * Engine will write the same shape of row from automated detectors; nothing
 * here needs to change when that lands.
 */
@Injectable()
export class SupplierRiskService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly supplierProfileService: SupplierProfileService,
  ) {}

  async history(supplierId: string): Promise<SupplierRiskProfileView[]> {
    await this.supplierProfileService.getByIdOrThrow(supplierId);
    const profiles = await this.prisma.supplierRiskProfile.findMany({
      where: { supplierId },
      orderBy: { assessedAt: 'desc' },
    });
    return profiles.map(toView);
  }

  async current(supplierId: string): Promise<SupplierRiskProfileView | null> {
    await this.supplierProfileService.getByIdOrThrow(supplierId);
    const profile = await this.prisma.supplierRiskProfile.findFirst({
      where: { supplierId },
      orderBy: { assessedAt: 'desc' },
    });
    return profile ? toView(profile) : null;
  }

  async recordAssessment(
    supplierId: string,
    dto: RecordRiskAssessmentDto,
    actor: Actor,
    requestMeta: RequestMeta,
  ): Promise<SupplierRiskProfileView> {
    await this.supplierProfileService.getByIdOrThrow(supplierId);

    const profile = await this.prisma.supplierRiskProfile.create({
      data: {
        supplierId,
        riskLevel: dto.riskLevel,
        score: new Prisma.Decimal(dto.score),
        factors: dto.factors as Prisma.InputJsonValue,
        notes: dto.notes,
        assessedById: actor.sub,
      },
    });

    await this.auditService.append({
      eventType: 'SUPPLIER_RISK_ASSESSED',
      actorId: actor.sub,
      actorEmail: actor.email,
      organizationId: actor.organizationId ?? undefined,
      resourceType: 'SupplierRiskProfile',
      resourceId: profile.id,
      action: 'create',
      payload: {
        supplierId,
        riskProfileId: profile.id,
        riskLevel: profile.riskLevel,
        score: dto.score.toString(),
      },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    });

    return toView(profile);
  }

  async getByIdOrThrow(id: string): Promise<SupplierRiskProfile> {
    const profile = await this.prisma.supplierRiskProfile.findUnique({
      where: { id },
    });
    if (!profile) {
      throw new NotFoundException('Supplier risk profile not found');
    }
    return profile;
  }
}
