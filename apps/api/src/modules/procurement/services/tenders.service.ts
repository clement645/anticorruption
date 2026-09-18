import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@bpfmps/database';
import type { TenderStatus } from '@bpfmps/database';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { PriceAnomalyDetector } from '../../risk/services/price-anomaly.detector';
import { BidCollusionDetector } from '../../risk/services/bid-collusion.detector';
import type { CreateTenderDto } from '../dto/create-tender.dto';
import type { TenderView } from '../procurement.types';

type Actor = { sub: string; email: string; organizationId: string | null };
type RequestMeta = { ipAddress?: string; userAgent?: string };

type TenderWithLots = Prisma.TenderGetPayload<{ include: { lots: true } }>;

function toView(tender: TenderWithLots): TenderView {
  return {
    id: tender.id,
    procurementRequestId: tender.procurementRequestId,
    tenderNumber: tender.tenderNumber,
    title: tender.title,
    description: tender.description,
    status: tender.status,
    publishedAt: tender.publishedAt ? tender.publishedAt.toISOString() : null,
    closingDate: tender.closingDate.toISOString(),
    closedAt: tender.closedAt ? tender.closedAt.toISOString() : null,
    lots: tender.lots.map((lot) => ({
      id: lot.id,
      lotNumber: lot.lotNumber,
      description: lot.description,
      estimatedAmount: lot.estimatedAmount.toString(),
    })),
    createdAt: tender.createdAt.toISOString(),
  };
}

/**
 * Tender lifecycle: DRAFT → PUBLISHED → CLOSED → AWARDED | CANCELLED. Bids
 * are only accepted while PUBLISHED and before closingDate (see
 * BidsService); evaluation and per-lot awarding happen once CLOSED.
 */
@Injectable()
export class TendersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly priceAnomalyDetector: PriceAnomalyDetector,
    private readonly bidCollusionDetector: BidCollusionDetector,
  ) {}

  async create(
    procurementRequestId: string,
    dto: CreateTenderDto,
    actor: Actor,
    requestMeta: RequestMeta,
  ): Promise<TenderView> {
    const request = await this.prisma.procurementRequest.findUnique({
      where: { id: procurementRequestId },
    });
    if (!request) {
      throw new NotFoundException('Procurement request not found');
    }
    if (request.status !== 'APPROVED') {
      throw new BadRequestException(
        'Procurement request must be APPROVED before a tender can be created',
      );
    }

    const lotNumbers = dto.lots.map((l) => l.lotNumber);
    if (new Set(lotNumbers).size !== lotNumbers.length) {
      throw new BadRequestException(
        'Lot numbers must be unique within a tender',
      );
    }

    const tenderNumber = `TND-${Date.now().toString(36).toUpperCase()}-${Math.random()
      .toString(36)
      .slice(2, 6)
      .toUpperCase()}`;

    const tender = await this.prisma.tender.create({
      data: {
        procurementRequestId,
        tenderNumber,
        title: dto.title,
        description: dto.description,
        closingDate: new Date(dto.closingDate),
        createdById: actor.sub,
        lots: {
          create: dto.lots.map((lot) => ({
            lotNumber: lot.lotNumber,
            description: lot.description,
            estimatedAmount: new Prisma.Decimal(lot.estimatedAmount),
          })),
        },
      },
      include: { lots: true },
    });

    await this.auditService.append({
      eventType: 'TENDER_CREATED',
      actorId: actor.sub,
      actorEmail: actor.email,
      organizationId: actor.organizationId ?? undefined,
      resourceType: 'Tender',
      resourceId: tender.id,
      action: 'create',
      payload: {
        tenderId: tender.id,
        tenderNumber,
        lotCount: tender.lots.length,
      },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    });

    return toView(tender);
  }

  async list(status?: string): Promise<TenderView[]> {
    const tenders = await this.prisma.tender.findMany({
      where: status ? { status: status as TenderStatus } : undefined,
      include: { lots: true },
      orderBy: { createdAt: 'desc' },
    });
    return tenders.map(toView);
  }

  async getByIdOrThrow(id: string): Promise<TenderWithLots> {
    const tender = await this.prisma.tender.findUnique({
      where: { id },
      include: { lots: true },
    });
    if (!tender) {
      throw new NotFoundException('Tender not found');
    }
    return tender;
  }

  async getView(id: string): Promise<TenderView> {
    return toView(await this.getByIdOrThrow(id));
  }

  async publish(
    id: string,
    actor: Actor,
    requestMeta: RequestMeta,
  ): Promise<TenderView> {
    const tender = await this.getByIdOrThrow(id);
    if (tender.status !== 'DRAFT') {
      throw new BadRequestException(
        `Cannot publish a tender in status ${tender.status}`,
      );
    }

    const updated = await this.prisma.tender.update({
      where: { id },
      data: { status: 'PUBLISHED', publishedAt: new Date() },
      include: { lots: true },
    });

    await this.auditService.append({
      eventType: 'TENDER_PUBLISHED',
      actorId: actor.sub,
      actorEmail: actor.email,
      organizationId: actor.organizationId ?? undefined,
      resourceType: 'Tender',
      resourceId: id,
      action: 'publish',
      payload: { tenderId: id, tenderNumber: tender.tenderNumber },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    });

    return toView(updated);
  }

  async close(
    id: string,
    actor: Actor,
    requestMeta: RequestMeta,
  ): Promise<TenderView> {
    const tender = await this.getByIdOrThrow(id);
    if (tender.status !== 'PUBLISHED') {
      throw new BadRequestException(
        `Cannot close a tender in status ${tender.status}`,
      );
    }

    const updated = await this.prisma.tender.update({
      where: { id },
      data: { status: 'CLOSED', closedAt: new Date() },
      include: { lots: true },
    });

    await this.auditService.append({
      eventType: 'TENDER_CLOSED',
      actorId: actor.sub,
      actorEmail: actor.email,
      organizationId: actor.organizationId ?? undefined,
      resourceType: 'Tender',
      resourceId: id,
      action: 'close',
      payload: { tenderId: id },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    });

    // Full bid set for every lot is now final — the natural point to check
    // for price anomalies and suspiciously uniform bidding, before any
    // award decision is made (the "before any adverse action" part of the
    // human-review gate: reviewers see alerts before an award, not after).
    for (const lot of updated.lots) {
      await this.priceAnomalyDetector.evaluateLot(lot.id);
      await this.bidCollusionDetector.evaluateLot(lot.id);
    }

    return toView(updated);
  }

  async cancel(
    id: string,
    actor: Actor,
    requestMeta: RequestMeta,
  ): Promise<TenderView> {
    const tender = await this.getByIdOrThrow(id);
    if (tender.status === 'AWARDED' || tender.status === 'CANCELLED') {
      throw new BadRequestException(
        `Cannot cancel a tender in status ${tender.status}`,
      );
    }

    const updated = await this.prisma.tender.update({
      where: { id },
      data: { status: 'CANCELLED' },
      include: { lots: true },
    });

    await this.auditService.append({
      eventType: 'TENDER_CANCELLED',
      actorId: actor.sub,
      actorEmail: actor.email,
      organizationId: actor.organizationId ?? undefined,
      resourceType: 'Tender',
      resourceId: id,
      action: 'cancel',
      payload: { tenderId: id },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    });

    return toView(updated);
  }

  /** Used by BidsService to check the tender is open before accepting a bid. */
  async assertOpenForBidding(tenderId: string): Promise<void> {
    const tender = await this.getByIdOrThrow(tenderId);
    if (tender.status !== 'PUBLISHED') {
      throw new BadRequestException('Tender is not open for bidding');
    }
    if (tender.closingDate <= new Date()) {
      throw new BadRequestException('Tender bidding period has closed');
    }
  }

  /** Marks the tender AWARDED once every lot has an award. Called by AwardsService/BidsService after each award. */
  async maybeMarkAwarded(tenderId: string): Promise<void> {
    const tender = await this.prisma.tender.findUnique({
      where: { id: tenderId },
      include: { lots: { include: { award: true } } },
    });
    if (!tender || tender.status !== 'CLOSED') {
      return;
    }
    const allLotsAwarded = tender.lots.every((lot) => lot.award !== null);
    if (allLotsAwarded && tender.lots.length > 0) {
      await this.prisma.tender.update({
        where: { id: tenderId },
        data: { status: 'AWARDED' },
      });
    }
  }
}
