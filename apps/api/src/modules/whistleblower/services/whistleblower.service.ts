import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { randomUUID } from 'node:crypto';
import {
  encrypt,
  decrypt,
  generateOpaqueToken,
  sha256Hex,
  sha256HexBuffer,
} from '@bpfmps/crypto';
import type { BlockchainAdapter } from '@bpfmps/blockchain';
import type { ObjectStorageAdapter } from '@bpfmps/storage';
import type { Report, ReportEvidence, ReportUpdate } from '@bpfmps/database';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { BLOCKCHAIN_ADAPTER } from '../../blockchain/blockchain.constants';
import { OBJECT_STORAGE_ADAPTER } from '../../storage/storage.constants';
import type { EnvConfig } from '../../../config/env.validation';
import type { SubmitReportDto } from '../dto/submit-report.dto';
import type { AddEvidenceDto } from '../dto/add-evidence.dto';
import type { ChangeStatusDto } from '../dto/change-status.dto';
import type {
  ReportDetailView,
  ReportEvidenceView,
  ReportPublicStatus,
  ReportUpdateView,
  ReportView,
  SubmitReportResult,
} from '../whistleblower.types';

type Actor = { sub: string; email: string; organizationId: string | null };
type RequestMeta = { ipAddress?: string; userAgent?: string };

const TRACKING_CODE_PREFIX = 'WB-';

function toEvidenceView(e: ReportEvidence): ReportEvidenceView {
  return {
    id: e.id,
    fileName: e.fileName,
    mimeType: e.mimeType,
    fileSizeBytes: e.fileSizeBytes,
    fileHash: e.fileHash,
    anchored: e.blockchainTxRef !== null,
    createdAt: e.createdAt.toISOString(),
  };
}

function toUpdateView(u: ReportUpdate): ReportUpdateView {
  return {
    id: u.id,
    author: u.author,
    message: u.message,
    createdAt: u.createdAt.toISOString(),
  };
}

/**
 * The Whistleblower Portal (Phase 13, section 12/40). Two distinct halves,
 * deliberately kept in one service since they share the same tables, but
 * with a hard line between them that every method here respects:
 *
 *  - "By tracking code": always anonymous, always public-callable, and
 *    NEVER passes an actor or request metadata to AuditService.append() —
 *    there genuinely is none. See schema.prisma comment on `Report` for the
 *    full "why" behind the possession-based-secret design.
 *  - "Investigator": always authenticated, always audited the normal way
 *    (actor + IP + user agent, like every other module) — an investigator
 *    is fully accountable for their own actions here, same as anywhere else
 *    in the system.
 */
@Injectable()
export class WhistleblowerService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly config: ConfigService<EnvConfig, true>,
    @Inject(OBJECT_STORAGE_ADAPTER)
    private readonly storage: ObjectStorageAdapter,
    @Inject(BLOCKCHAIN_ADAPTER) private readonly blockchain: BlockchainAdapter,
  ) {}

  // ---------------------------------------------------------------------
  // Anonymous / tracking-code side
  // ---------------------------------------------------------------------

  async submitReport(dto: SubmitReportDto): Promise<SubmitReportResult> {
    const trackingCode = TRACKING_CODE_PREFIX + generateOpaqueToken(24);
    const trackingCodeHash = sha256Hex(trackingCode);

    const contactKey = this.config.get('WHISTLEBLOWER_CONTACT_ENCRYPTION_KEY', {
      infer: true,
    });

    const report = await this.prisma.report.create({
      data: {
        trackingCodeHash,
        category: dto.category,
        description: dto.description,
        organizationId: dto.organizationId,
        contactEncrypted: dto.contact ? encrypt(dto.contact, contactKey) : null,
      },
    });

    for (const item of dto.evidence ?? []) {
      await this.storeEvidence(report.id, item);
    }

    // No actorId, no ipAddress, no userAgent — this is the one action in
    // the entire codebase that must never be attributable to anyone. The
    // payload is deliberately minimal (not even organizationId) so that
    // plain `audit:read` visibility (much broader than `whistleblower:read`)
    // never reveals more than "a report of this category exists" — see
    // THREAT_MODEL.md Phase 13.
    await this.auditService.append({
      eventType: 'WHISTLEBLOWER_REPORT_SUBMITTED',
      resourceType: 'Report',
      resourceId: report.id,
      action: 'create',
      payload: {
        reportId: report.id,
        category: dto.category,
        evidenceCount: dto.evidence?.length ?? 0,
      },
    });

    return { trackingCode, reportId: report.id };
  }

  async getStatusByTrackingCode(
    trackingCode: string,
  ): Promise<ReportPublicStatus> {
    const report = await this.findByTrackingCodeOrThrow(trackingCode);
    return {
      category: report.category,
      description: report.description,
      status: report.status,
      createdAt: report.createdAt.toISOString(),
      evidence: report.evidence.map(toEvidenceView),
      updates: report.updates.map(toUpdateView),
    };
  }

  async addEvidenceByTrackingCode(
    trackingCode: string,
    dto: AddEvidenceDto,
  ): Promise<ReportEvidenceView> {
    const report = await this.findByTrackingCodeOrThrow(trackingCode);
    const evidence = await this.storeEvidence(report.id, dto);

    await this.auditService.append({
      eventType: 'WHISTLEBLOWER_EVIDENCE_ADDED',
      resourceType: 'Report',
      resourceId: report.id,
      action: 'add_evidence',
      payload: { reportId: report.id },
    });

    return toEvidenceView(evidence);
  }

  async addReporterUpdateByTrackingCode(
    trackingCode: string,
    message: string,
  ): Promise<ReportUpdateView> {
    const report = await this.findByTrackingCodeOrThrow(trackingCode);
    const update = await this.prisma.reportUpdate.create({
      data: { reportId: report.id, author: 'REPORTER', message },
    });

    await this.auditService.append({
      eventType: 'WHISTLEBLOWER_REPORTER_REPLIED',
      resourceType: 'Report',
      resourceId: report.id,
      action: 'reply',
      payload: { reportId: report.id },
    });

    return toUpdateView(update);
  }

  private async findByTrackingCodeOrThrow(trackingCode: string) {
    const report = await this.prisma.report.findUnique({
      where: { trackingCodeHash: sha256Hex(trackingCode) },
      include: {
        evidence: { orderBy: { createdAt: 'asc' } },
        updates: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!report) {
      // Generic — never reveal whether a code is malformed vs. simply not
      // found, the same information-hiding judgment login already applies.
      throw new NotFoundException('Report not found');
    }
    return report;
  }

  /** Shared by initial submission and the later tracking-code follow-up route. */
  private async storeEvidence(
    reportId: string,
    input: { fileName: string; mimeType: string; fileContentBase64: string },
  ): Promise<ReportEvidence> {
    let content: Buffer;
    try {
      content = Buffer.from(input.fileContentBase64, 'base64');
    } catch {
      throw new BadRequestException('fileContentBase64 is not valid base64');
    }
    if (content.length === 0) {
      throw new BadRequestException('Uploaded evidence content is empty');
    }

    const fileHash = sha256HexBuffer(content);
    const storageKey = `whistleblower/${reportId}/${randomUUID()}-${input.fileName}`;
    await this.storage.putObject({
      key: storageKey,
      data: content,
      contentType: input.mimeType,
    });

    let blockchainTxRef: string | null = null;
    try {
      const { transaction } = await this.blockchain.anchorHash(fileHash, {
        resourceType: 'ReportEvidence',
        reportId,
        fileName: input.fileName,
      });
      blockchainTxRef = transaction.id;
    } catch {
      // Never let a failed anchor attempt block evidence being recorded —
      // the same principle as Phase 10's ProjectEvidence and Phase 8's risk
      // detectors: a secondary integrity layer must never block the primary
      // action.
      blockchainTxRef = null;
    }

    return this.prisma.reportEvidence.create({
      data: {
        reportId,
        fileName: input.fileName,
        fileHash,
        fileSizeBytes: content.length,
        mimeType: input.mimeType,
        storageKey,
        blockchainTxRef,
      },
    });
  }

  // ---------------------------------------------------------------------
  // Investigator side (authenticated, `whistleblower:read`/`investigate`)
  // ---------------------------------------------------------------------

  async list(params: {
    status?: string;
    skip?: number;
    take?: number;
  }): Promise<{ items: ReportView[]; total: number }> {
    const where = params.status ? { status: params.status as never } : {};
    const [rows, total] = await this.prisma.$transaction([
      this.prisma.report.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: params.skip ?? 0,
        take: params.take ?? 25,
      }),
      this.prisma.report.count({ where }),
    ]);
    return { items: rows.map((r) => this.toView(r)), total };
  }

  async getDetail(id: string): Promise<ReportDetailView> {
    const report = await this.prisma.report.findUnique({
      where: { id },
      include: {
        evidence: { orderBy: { createdAt: 'asc' } },
        updates: { orderBy: { createdAt: 'asc' } },
      },
    });
    if (!report) {
      throw new NotFoundException('Report not found');
    }
    return {
      ...this.toView(report),
      evidence: report.evidence.map(toEvidenceView),
      updates: report.updates.map(toUpdateView),
    };
  }

  async assignToSelf(
    id: string,
    actor: Actor,
    requestMeta: RequestMeta,
  ): Promise<ReportView> {
    const report = await this.getByIdOrThrow(id);
    const updated = await this.prisma.report.update({
      where: { id },
      data: { assignedToId: actor.sub },
    });

    await this.auditService.append({
      eventType: 'WHISTLEBLOWER_REPORT_ASSIGNED',
      actorId: actor.sub,
      actorEmail: actor.email,
      organizationId: actor.organizationId ?? undefined,
      resourceType: 'Report',
      resourceId: report.id,
      action: 'assign',
      payload: { reportId: report.id },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    });

    return this.toView(updated);
  }

  async changeStatus(
    id: string,
    dto: ChangeStatusDto,
    actor: Actor,
    requestMeta: RequestMeta,
  ): Promise<ReportView> {
    const report = await this.getByIdOrThrow(id);
    const legal: Record<string, string[]> = {
      SUBMITTED: ['UNDER_REVIEW'],
      UNDER_REVIEW: ['SUBSTANTIATED', 'UNSUBSTANTIATED'],
      SUBSTANTIATED: [],
      UNSUBSTANTIATED: [],
    };
    if (!legal[report.status]?.includes(dto.status)) {
      throw new BadRequestException(
        `Cannot move a report from ${report.status} to ${dto.status}`,
      );
    }

    const updated = await this.prisma.report.update({
      where: { id },
      data: { status: dto.status },
    });

    await this.auditService.append({
      eventType: 'WHISTLEBLOWER_REPORT_STATUS_CHANGED',
      actorId: actor.sub,
      actorEmail: actor.email,
      organizationId: actor.organizationId ?? undefined,
      resourceType: 'Report',
      resourceId: report.id,
      action: 'change_status',
      payload: { reportId: report.id, from: report.status, to: dto.status },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    });

    return this.toView(updated);
  }

  async addInvestigatorUpdate(
    id: string,
    message: string,
    actor: Actor,
    requestMeta: RequestMeta,
  ): Promise<ReportUpdateView> {
    const report = await this.getByIdOrThrow(id);
    const update = await this.prisma.reportUpdate.create({
      data: {
        reportId: report.id,
        author: 'INVESTIGATOR',
        message,
        postedById: actor.sub,
      },
    });

    await this.auditService.append({
      eventType: 'WHISTLEBLOWER_INVESTIGATOR_UPDATE_POSTED',
      actorId: actor.sub,
      actorEmail: actor.email,
      organizationId: actor.organizationId ?? undefined,
      resourceType: 'Report',
      resourceId: report.id,
      action: 'post_update',
      payload: { reportId: report.id },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    });

    return toUpdateView(update);
  }

  private async getByIdOrThrow(id: string): Promise<Report> {
    const report = await this.prisma.report.findUnique({ where: { id } });
    if (!report) {
      throw new NotFoundException('Report not found');
    }
    return report;
  }

  private toView(report: Report): ReportView {
    const contactKey = this.config.get('WHISTLEBLOWER_CONTACT_ENCRYPTION_KEY', {
      infer: true,
    });
    return {
      id: report.id,
      category: report.category,
      description: report.description,
      organizationId: report.organizationId,
      status: report.status,
      contact: report.contactEncrypted
        ? decrypt(report.contactEncrypted, contactKey)
        : null,
      assignedToId: report.assignedToId,
      createdAt: report.createdAt.toISOString(),
      updatedAt: report.updatedAt.toISOString(),
    };
  }
}
