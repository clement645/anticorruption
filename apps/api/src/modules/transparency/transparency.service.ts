import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { BlockchainAdapter } from '@bpfmps/blockchain';
import { PrismaService } from '../../prisma/prisma.service';
import { AuditService } from '../audit/audit.service';
import { BLOCKCHAIN_ADAPTER } from '../blockchain/blockchain.constants';
import type {
  PublicBudgetLine,
  PublicHashVerification,
  PublicProjectDetail,
  PublicProjectSummary,
  PublicSupplierSummary,
  PublicTenderDetail,
  PublicTenderSummary,
} from './transparency.types';

export interface Paginated<T> {
  items: T[];
  total: number;
}

/**
 * Section 12/40: a public, unauthenticated, read-only window into the same
 * data every other module already manages — but through hand-written,
 * privacy-filtered DTOs (transparency.types.ts), never the internal
 * `*View` types those modules use for their own authenticated endpoints. No
 * individual actor identity, no supplier beneficial-ownership/contact data,
 * no bid amounts or evaluation scores beyond the final award, no evidence
 * file content. See SECURITY.md § Citizen Transparency Portal for the full
 * reasoning.
 */
@Injectable()
export class TransparencyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    @Inject(BLOCKCHAIN_ADAPTER) private readonly blockchain: BlockchainAdapter,
  ) {}

  async listProjects(params: {
    search?: string;
    status?: string;
    skip?: number;
    take?: number;
  }): Promise<Paginated<PublicProjectSummary>> {
    const where = {
      ...(params.search
        ? { name: { contains: params.search, mode: 'insensitive' as const } }
        : {}),
      ...(params.status ? { status: params.status as never } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.project.findMany({
        where,
        include: { organization: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        skip: params.skip ?? 0,
        take: params.take ?? 25,
      }),
      this.prisma.project.count({ where }),
    ]);
    return {
      items: rows.map((p) => ({
        id: p.id,
        name: p.name,
        description: p.description,
        location: p.location,
        status: p.status,
        organizationName: p.organization.name,
        startDate: p.startDate.toISOString(),
        plannedEndDate: p.plannedEndDate.toISOString(),
        actualEndDate: p.actualEndDate ? p.actualEndDate.toISOString() : null,
      })),
      total,
    };
  }

  async getProject(id: string): Promise<PublicProjectDetail> {
    const project = await this.prisma.project.findUnique({
      where: { id },
      include: {
        organization: { select: { name: true } },
        milestones: { orderBy: { sequenceNumber: 'asc' } },
        evidence: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!project) {
      throw new NotFoundException('Project not found');
    }
    return {
      id: project.id,
      name: project.name,
      description: project.description,
      location: project.location,
      status: project.status,
      organizationName: project.organization.name,
      startDate: project.startDate.toISOString(),
      plannedEndDate: project.plannedEndDate.toISOString(),
      actualEndDate: project.actualEndDate
        ? project.actualEndDate.toISOString()
        : null,
      milestones: project.milestones.map((m) => ({
        sequenceNumber: m.sequenceNumber,
        title: m.title,
        description: m.description,
        plannedAmount: m.plannedAmount.toString(),
        plannedDate: m.plannedDate.toISOString(),
        status: m.status,
        completedAt: m.completedAt ? m.completedAt.toISOString() : null,
      })),
      evidence: project.evidence.map((e) => ({
        id: e.id,
        fileName: e.fileName,
        mimeType: e.mimeType,
        fileSizeBytes: e.fileSizeBytes,
        fileHash: e.fileHash,
        anchored: e.blockchainTxRef !== null,
        createdAt: e.createdAt.toISOString(),
      })),
    };
  }

  async listTenders(params: {
    search?: string;
    status?: string;
    skip?: number;
    take?: number;
  }): Promise<Paginated<PublicTenderSummary>> {
    const where = {
      // DRAFT tenders are not yet public knowledge — only ever show a
      // tender once it has actually been published.
      status: params.status
        ? (params.status as never)
        : { not: 'DRAFT' as never },
      ...(params.search
        ? { title: { contains: params.search, mode: 'insensitive' as const } }
        : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.tender.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: params.skip ?? 0,
        take: params.take ?? 25,
      }),
      this.prisma.tender.count({ where }),
    ]);
    return {
      items: rows.map((t) => ({
        id: t.id,
        tenderNumber: t.tenderNumber,
        title: t.title,
        description: t.description,
        status: t.status,
        publishedAt: t.publishedAt ? t.publishedAt.toISOString() : null,
        closingDate: t.closingDate.toISOString(),
        closedAt: t.closedAt ? t.closedAt.toISOString() : null,
      })),
      total,
    };
  }

  async getTender(id: string): Promise<PublicTenderDetail> {
    const tender = await this.prisma.tender.findUnique({
      where: { id },
      include: {
        lots: {
          include: {
            award: {
              include: { bid: { include: { supplier: true } } },
            },
          },
        },
      },
    });
    if (!tender || tender.status === 'DRAFT') {
      // Same rule as listTenders: a DRAFT tender isn't public knowledge yet
      // — reported as not-found rather than distinguishing "doesn't exist"
      // from "exists but not yet published", the same information-hiding
      // judgment a 404 already makes for permission-gated resources.
      throw new NotFoundException('Tender not found');
    }
    return {
      id: tender.id,
      tenderNumber: tender.tenderNumber,
      title: tender.title,
      description: tender.description,
      status: tender.status,
      publishedAt: tender.publishedAt ? tender.publishedAt.toISOString() : null,
      closingDate: tender.closingDate.toISOString(),
      closedAt: tender.closedAt ? tender.closedAt.toISOString() : null,
      lots: tender.lots.map((lot) => ({
        lotNumber: lot.lotNumber,
        description: lot.description,
        estimatedAmount: lot.estimatedAmount.toString(),
        award: lot.award
          ? {
              supplierName: lot.award.bid.supplier.name,
              awardedAmount: lot.award.awardedAmount.toString(),
              awardedAt: lot.award.createdAt.toISOString(),
            }
          : null,
      })),
    };
  }

  async listSuppliers(params: {
    search?: string;
    status?: string;
    skip?: number;
    take?: number;
  }): Promise<Paginated<PublicSupplierSummary>> {
    const where = {
      ...(params.search
        ? { name: { contains: params.search, mode: 'insensitive' as const } }
        : {}),
      ...(params.status ? { status: params.status as never } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.supplier.findMany({
        where,
        orderBy: { name: 'asc' },
        skip: params.skip ?? 0,
        take: params.take ?? 25,
      }),
      this.prisma.supplier.count({ where }),
    ]);
    return {
      items: rows.map((s) => ({
        id: s.id,
        name: s.name,
        registrationNumber: s.registrationNumber,
        status: s.status,
        businessType: s.businessType,
        county: s.county,
      })),
      total,
    };
  }

  async getSupplier(id: string): Promise<PublicSupplierSummary> {
    const supplier = await this.prisma.supplier.findUnique({ where: { id } });
    if (!supplier) {
      throw new NotFoundException('Supplier not found');
    }
    return {
      id: supplier.id,
      name: supplier.name,
      registrationNumber: supplier.registrationNumber,
      status: supplier.status,
      businessType: supplier.businessType,
      county: supplier.county,
    };
  }

  /**
   * Sourced from `Allocation`, not `BudgetLine`/`BudgetPlan` directly — an
   * Allocation is created exactly once, the moment its owning Budget is
   * APPROVED (see schema.prisma comment on Allocation), so its mere
   * existence is already the "this is public record now" gate; no separate
   * status check on the parent Budget is needed.
   */
  async listBudgetLines(params: {
    organizationId?: string;
    fiscalYearId?: string;
    skip?: number;
    take?: number;
  }): Promise<Paginated<PublicBudgetLine>> {
    const where = {
      ...(params.organizationId
        ? { organizationId: params.organizationId }
        : {}),
      ...(params.fiscalYearId ? { fiscalYearId: params.fiscalYearId } : {}),
    };
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.allocation.findMany({
        where,
        include: {
          organization: { select: { name: true } },
          budgetLine: {
            select: {
              voteCode: true,
              voteName: true,
              programName: true,
              budget: { select: { fiscalYear: { select: { name: true } } } },
            },
          },
        },
        orderBy: { createdAt: 'desc' },
        skip: params.skip ?? 0,
        take: params.take ?? 25,
      }),
      this.prisma.allocation.count({ where }),
    ]);
    return {
      items: rows.map((a) => ({
        organizationName: a.organization.name,
        fiscalYearName: a.budgetLine.budget.fiscalYear.name,
        voteCode: a.budgetLine.voteCode,
        voteName: a.budgetLine.voteName,
        programName: a.budgetLine.programName,
        authorizedAmount: a.authorizedAmount.toString(),
        committedAmount: a.committedAmount.toString(),
        spentAmount: a.spentAmount.toString(),
        status: a.status,
      })),
      total,
    };
  }

  /**
   * The public hash-verification tool (section 40/55): given the SHA-256
   * hash of a file a citizen already has (e.g. a project photo published
   * elsewhere), confirms it matches an officially-recorded piece of
   * evidence — without ever exposing the file content itself (that still
   * requires `evidence:upload`-adjacent access, see EvidenceService), and
   * without exposing who uploaded it. `chainIntact` reuses the existing,
   * independently-tested `AuditService.verifyEvent()` against this
   * evidence's own `EVIDENCE_UPLOADED` audit event — recomputed fresh, not
   * a cached flag — but only its boolean `verified` result crosses into
   * this public response, never the underlying event's actor/payload/IP.
   */
  async verifyHash(hash: string): Promise<PublicHashVerification> {
    const evidence = await this.prisma.projectEvidence.findFirst({
      where: { fileHash: hash },
      include: { project: { select: { id: true, name: true } } },
    });
    if (!evidence) {
      return { found: false };
    }

    const auditEvent = await this.prisma.auditEvent.findFirst({
      where: {
        resourceType: 'ProjectEvidence',
        resourceId: evidence.id,
        eventType: 'EVIDENCE_UPLOADED',
      },
    });
    const chainIntact = auditEvent
      ? (await this.auditService.verifyEvent(auditEvent.id)).verified
      : undefined;

    let anchored = false;
    if (evidence.blockchainTxRef) {
      const result = await this.blockchain.verifyTransaction(
        evidence.blockchainTxRef,
      );
      anchored = result.found;
    }

    let milestoneTitle: string | null = null;
    if (evidence.inspectionId) {
      const inspection = await this.prisma.inspection.findUnique({
        where: { id: evidence.inspectionId },
        include: { milestone: { select: { title: true } } },
      });
      milestoneTitle = inspection?.milestone.title ?? null;
    }

    return {
      found: true,
      fileName: evidence.fileName,
      mimeType: evidence.mimeType,
      fileSizeBytes: evidence.fileSizeBytes,
      projectId: evidence.project.id,
      projectName: evidence.project.name,
      milestoneTitle,
      uploadedAt: evidence.createdAt.toISOString(),
      anchored,
      chainIntact,
    };
  }
}
