import {
  BadRequestException,
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@bpfmps/database';
import type { Award, Bid } from '@bpfmps/database';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { TendersService } from './tenders.service';
import type { SubmitBidDto } from '../dto/submit-bid.dto';
import type { EvaluateBidDto } from '../dto/evaluate-bid.dto';
import type {
  AwardView,
  BidEvaluationView,
  BidView,
} from '../procurement.types';

type Actor = { sub: string; email: string; organizationId: string | null };
type RequestMeta = { ipAddress?: string; userAgent?: string };

function toBidView(bid: Bid): BidView {
  return {
    id: bid.id,
    tenderLotId: bid.tenderLotId,
    supplierId: bid.supplierId,
    amount: bid.amount.toString(),
    status: bid.status,
    technicalScore: bid.technicalScore ? bid.technicalScore.toString() : null,
    financialScore: bid.financialScore ? bid.financialScore.toString() : null,
    createdAt: bid.createdAt.toISOString(),
  };
}

function toAwardView(award: Award): AwardView {
  return {
    id: award.id,
    tenderLotId: award.tenderLotId,
    bidId: award.bidId,
    awardedAmount: award.awardedAmount.toString(),
    awardedById: award.awardedById,
    createdAt: award.createdAt.toISOString(),
  };
}

/**
 * Bid lifecycle: SUBMITTED → EVALUATED → AWARDED | REJECTED. Awarding a lot
 * is a create-exactly-once operation, naturally protected by the unique
 * constraints on `Award.tenderLotId`/`Award.bidId` (a duplicate award
 * attempt fails at the database, caught here as a 409) — a unique
 * constraint, not a row lock, is the right tool for "create once", the same
 * judgment call documented for Phase 5's balance updates vs. this phase's
 * one-shot awards (see DATABASE.md § Current State).
 */
@Injectable()
export class BidsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly tendersService: TendersService,
  ) {}

  async submit(
    tenderLotId: string,
    dto: SubmitBidDto,
    actor: Actor,
    requestMeta: RequestMeta,
  ): Promise<BidView> {
    const lot = await this.prisma.tenderLot.findUnique({
      where: { id: tenderLotId },
    });
    if (!lot) {
      throw new NotFoundException('Tender lot not found');
    }
    await this.tendersService.assertOpenForBidding(lot.tenderId);

    const supplier = await this.prisma.supplier.findUnique({
      where: { id: dto.supplierId },
    });
    if (!supplier) {
      throw new NotFoundException('Supplier not found');
    }
    if (supplier.status !== 'ACTIVE') {
      throw new BadRequestException(
        `Supplier is ${supplier.status}, not eligible to bid`,
      );
    }

    let bid: Bid;
    try {
      bid = await this.prisma.bid.create({
        data: {
          tenderLotId,
          supplierId: dto.supplierId,
          amount: new Prisma.Decimal(dto.amount),
          submittedById: actor.sub,
        },
      });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'This supplier has already submitted a bid for this lot',
        );
      }
      throw error;
    }

    await this.auditService.append({
      eventType: 'BID_SUBMITTED',
      actorId: actor.sub,
      actorEmail: actor.email,
      organizationId: actor.organizationId ?? undefined,
      resourceType: 'Bid',
      resourceId: bid.id,
      action: 'create',
      payload: {
        bidId: bid.id,
        tenderLotId,
        supplierId: dto.supplierId,
        amount: dto.amount.toString(),
      },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    });

    return toBidView(bid);
  }

  async listForLot(tenderLotId: string): Promise<BidView[]> {
    const bids = await this.prisma.bid.findMany({
      where: { tenderLotId },
      orderBy: { createdAt: 'asc' },
    });
    return bids.map(toBidView);
  }

  async getByIdOrThrow(id: string): Promise<Bid> {
    const bid = await this.prisma.bid.findUnique({ where: { id } });
    if (!bid) {
      throw new NotFoundException('Bid not found');
    }
    return bid;
  }

  async evaluate(
    bidId: string,
    dto: EvaluateBidDto,
    actor: Actor,
    requestMeta: RequestMeta,
  ): Promise<BidEvaluationView> {
    const bid = await this.getByIdOrThrow(bidId);
    if (bid.status !== 'SUBMITTED') {
      throw new BadRequestException(
        `Cannot evaluate a bid in status ${bid.status} — only SUBMITTED bids can be evaluated`,
      );
    }
    const lot = await this.prisma.tenderLot.findUniqueOrThrow({
      where: { id: bid.tenderLotId },
    });
    const tender = await this.prisma.tender.findUniqueOrThrow({
      where: { id: lot.tenderId },
    });
    if (tender.status !== 'CLOSED') {
      throw new BadRequestException(
        'Tender must be CLOSED before its bids can be evaluated',
      );
    }

    const [evaluation] = await this.prisma.$transaction([
      this.prisma.bidEvaluation.create({
        data: {
          bidId,
          technicalScore: new Prisma.Decimal(dto.technicalScore),
          financialScore: new Prisma.Decimal(dto.financialScore),
          comments: dto.comments,
          evaluatedById: actor.sub,
        },
      }),
      this.prisma.bid.update({
        where: { id: bidId },
        data: {
          status: 'EVALUATED',
          technicalScore: new Prisma.Decimal(dto.technicalScore),
          financialScore: new Prisma.Decimal(dto.financialScore),
        },
      }),
    ]);

    await this.auditService.append({
      eventType: 'BID_EVALUATED',
      actorId: actor.sub,
      actorEmail: actor.email,
      organizationId: actor.organizationId ?? undefined,
      resourceType: 'Bid',
      resourceId: bidId,
      action: 'evaluate',
      payload: {
        bidId,
        technicalScore: dto.technicalScore.toString(),
        financialScore: dto.financialScore.toString(),
      },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    });

    return {
      id: evaluation.id,
      bidId: evaluation.bidId,
      technicalScore: evaluation.technicalScore.toString(),
      financialScore: evaluation.financialScore.toString(),
      comments: evaluation.comments,
      evaluatedById: evaluation.evaluatedById,
      createdAt: evaluation.createdAt.toISOString(),
    };
  }

  async award(
    bidId: string,
    actor: Actor,
    requestMeta: RequestMeta,
  ): Promise<AwardView> {
    const bid = await this.getByIdOrThrow(bidId);
    if (bid.status !== 'EVALUATED') {
      throw new BadRequestException(
        `Cannot award a bid in status ${bid.status} — only EVALUATED bids can be awarded`,
      );
    }
    const lot = await this.prisma.tenderLot.findUniqueOrThrow({
      where: { id: bid.tenderLotId },
    });
    const tender = await this.prisma.tender.findUniqueOrThrow({
      where: { id: lot.tenderId },
    });
    if (tender.status !== 'CLOSED') {
      throw new BadRequestException(
        'Tender must be CLOSED before a lot can be awarded',
      );
    }

    let award: Award;
    try {
      const result = await this.prisma.$transaction(async (tx) => {
        const created = await tx.award.create({
          data: {
            tenderLotId: bid.tenderLotId,
            bidId,
            awardedAmount: bid.amount,
            awardedById: actor.sub,
          },
        });
        await tx.bid.update({
          where: { id: bidId },
          data: { status: 'AWARDED' },
        });
        await tx.bid.updateMany({
          where: {
            tenderLotId: bid.tenderLotId,
            id: { not: bidId },
            status: { in: ['SUBMITTED', 'EVALUATED'] },
          },
          data: { status: 'REJECTED' },
        });
        return created;
      });
      award = result;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException('This lot has already been awarded');
      }
      throw error;
    }

    await this.tendersService.maybeMarkAwarded(lot.tenderId);

    await this.auditService.append({
      eventType: 'LOT_AWARDED',
      actorId: actor.sub,
      actorEmail: actor.email,
      organizationId: actor.organizationId ?? undefined,
      resourceType: 'Award',
      resourceId: award.id,
      action: 'award',
      payload: {
        awardId: award.id,
        tenderLotId: bid.tenderLotId,
        bidId,
        awardedAmount: award.awardedAmount.toString(),
      },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    });

    return toAwardView(award);
  }
}
