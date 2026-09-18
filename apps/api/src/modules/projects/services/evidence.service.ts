import {
  BadRequestException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { sha256HexBuffer } from '@bpfmps/crypto';
import type { BlockchainAdapter } from '@bpfmps/blockchain';
import type { ObjectStorageAdapter } from '@bpfmps/storage';
import type { ProjectEvidence } from '@bpfmps/database';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { BLOCKCHAIN_ADAPTER } from '../../blockchain/blockchain.constants';
import { OBJECT_STORAGE_ADAPTER } from '../../storage/storage.constants';
import type { UploadEvidenceDto } from '../dto/upload-evidence.dto';
import type {
  ProjectEvidenceDownload,
  ProjectEvidenceView,
} from '../projects.types';

type Actor = { sub: string; email: string; organizationId: string | null };
type RequestMeta = { ipAddress?: string; userAgent?: string };

function toView(e: ProjectEvidence): ProjectEvidenceView {
  return {
    id: e.id,
    projectId: e.projectId,
    inspectionId: e.inspectionId,
    fileName: e.fileName,
    fileHash: e.fileHash,
    fileSizeBytes: e.fileSizeBytes,
    mimeType: e.mimeType,
    blockchainTxRef: e.blockchainTxRef,
    uploadedById: e.uploadedById,
    createdAt: e.createdAt.toISOString(),
  };
}

/**
 * The evidence vault (section 40) — see schema.prisma comment on
 * ProjectEvidence for the full design: real encrypted storage (not hash-
 * only, unlike Phase 7's supplier documents), immediate per-file blockchain
 * anchoring (not the periodic audit-event rollup), and hash verification on
 * every download.
 */
@Injectable()
export class EvidenceService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    @Inject(OBJECT_STORAGE_ADAPTER)
    private readonly storage: ObjectStorageAdapter,
    @Inject(BLOCKCHAIN_ADAPTER) private readonly blockchain: BlockchainAdapter,
  ) {}

  async upload(
    projectId: string,
    dto: UploadEvidenceDto,
    actor: Actor,
    requestMeta: RequestMeta,
  ): Promise<ProjectEvidenceView> {
    const project = await this.prisma.project.findUnique({
      where: { id: projectId },
    });
    if (!project) {
      throw new NotFoundException('Project not found');
    }

    if (dto.inspectionId) {
      const inspection = await this.prisma.inspection.findUnique({
        where: { id: dto.inspectionId },
        include: { milestone: true },
      });
      if (!inspection || inspection.milestone.projectId !== projectId) {
        throw new BadRequestException(
          'inspectionId must reference an inspection belonging to this project',
        );
      }
    }

    let content: Buffer;
    try {
      content = Buffer.from(dto.fileContentBase64, 'base64');
    } catch {
      throw new BadRequestException('fileContentBase64 is not valid base64');
    }
    if (content.length === 0) {
      throw new BadRequestException('Uploaded evidence content is empty');
    }

    const fileHash = sha256HexBuffer(content);
    const storageKey = `evidence/${projectId}/${randomUUID()}-${dto.fileName}`;

    await this.storage.putObject({
      key: storageKey,
      data: content,
      contentType: dto.mimeType,
    });

    // Anchored immediately, not via the periodic audit-event rollup — each
    // piece of evidence is independently significant enough to anchor on
    // its own (see schema.prisma comment).
    let blockchainTxRef: string | null = null;
    try {
      const { transaction } = await this.blockchain.anchorHash(fileHash, {
        resourceType: 'ProjectEvidence',
        projectId,
        fileName: dto.fileName,
      });
      blockchainTxRef = transaction.id;
    } catch (error) {
      // Anchoring must never block evidence from being recorded — the file
      // is already safely stored and hashed; a failed anchor attempt here
      // just means blockchainTxRef stays null for now, same "never let a
      // secondary integrity layer block the primary action" principle as
      // the AI Risk Engine's detectors (Phase 8).
      blockchainTxRef = null;
      void error;
    }

    const evidence = await this.prisma.projectEvidence.create({
      data: {
        projectId,
        inspectionId: dto.inspectionId,
        fileName: dto.fileName,
        fileHash,
        fileSizeBytes: content.length,
        mimeType: dto.mimeType,
        storageKey,
        blockchainTxRef,
        uploadedById: actor.sub,
      },
    });

    await this.auditService.append({
      eventType: 'EVIDENCE_UPLOADED',
      actorId: actor.sub,
      actorEmail: actor.email,
      organizationId: actor.organizationId ?? undefined,
      resourceType: 'ProjectEvidence',
      resourceId: evidence.id,
      action: 'create',
      payload: {
        evidenceId: evidence.id,
        projectId,
        fileName: dto.fileName,
        fileHash,
        blockchainTxRef,
      },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    });

    return toView(evidence);
  }

  async list(projectId?: string): Promise<ProjectEvidenceView[]> {
    const evidence = await this.prisma.projectEvidence.findMany({
      where: projectId ? { projectId } : undefined,
      orderBy: { createdAt: 'desc' },
    });
    return evidence.map(toView);
  }

  async getByIdOrThrow(id: string): Promise<ProjectEvidence> {
    const evidence = await this.prisma.projectEvidence.findUnique({
      where: { id },
    });
    if (!evidence) {
      throw new NotFoundException('Evidence not found');
    }
    return evidence;
  }

  async getView(id: string): Promise<ProjectEvidenceView> {
    return toView(await this.getByIdOrThrow(id));
  }

  /**
   * Decrypts and returns the original content, re-hashing it first and
   * comparing against the hash recorded at upload time. Two independent
   * tamper-detection layers are in play here, and they fail differently:
   * AES-256-GCM's auth tag rejects any tampering with the ciphertext at
   * rest by throwing during decryption (caught below and turned into a
   * clear 422, since there is no content left to hand back at all), while
   * the SHA-256 comparison is defense-in-depth against corruption that
   * somehow still produces valid-but-wrong plaintext — that case is
   * reported via `hashVerified: false` rather than silently handing back
   * bad content.
   */
  async download(id: string): Promise<ProjectEvidenceDownload> {
    const evidence = await this.getByIdOrThrow(id);
    let content: Buffer;
    try {
      content = await this.storage.getObject(evidence.storageKey);
    } catch {
      throw new UnprocessableEntityException(
        'Evidence integrity check failed: the stored file could not be decrypted. It may have been corrupted or tampered with.',
      );
    }
    const recomputedHash = sha256HexBuffer(content);
    return {
      fileName: evidence.fileName,
      mimeType: evidence.mimeType,
      contentBase64: content.toString('base64'),
      hashVerified: recomputedHash === evidence.fileHash,
    };
  }
}
