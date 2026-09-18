import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { sha256HexBuffer } from '@bpfmps/crypto';
import type { SupplierDocument } from '@bpfmps/database';
import { PrismaService } from '../../../prisma/prisma.service';
import { AuditService } from '../../audit/audit.service';
import { SupplierRiskDetector } from '../../risk/services/supplier-risk.detector';
import type { UploadDocumentDto } from '../dto/upload-document.dto';
import type { RejectDocumentDto } from '../dto/reject-document.dto';
import type { SupplierDocumentView } from '../supplier.types';
import { SupplierProfileService } from './supplier-profile.service';

type Actor = { sub: string; email: string; organizationId: string | null };
type RequestMeta = { ipAddress?: string; userAgent?: string };

function toView(document: SupplierDocument): SupplierDocumentView {
  return {
    id: document.id,
    supplierId: document.supplierId,
    documentType: document.documentType,
    fileName: document.fileName,
    fileHash: document.fileHash,
    fileSizeBytes: document.fileSizeBytes,
    mimeType: document.mimeType,
    status: document.status,
    expiryDate: document.expiryDate ? document.expiryDate.toISOString() : null,
    uploadedById: document.uploadedById,
    verifiedById: document.verifiedById,
    verifiedAt: document.verifiedAt ? document.verifiedAt.toISOString() : null,
    rejectionReason: document.rejectionReason,
    createdAt: document.createdAt.toISOString(),
  };
}

/**
 * Only a SHA-256 hash + metadata is ever persisted — never the document
 * bytes themselves (see schema.prisma comment on SupplierDocument: no real
 * object storage backend exists yet, that's Phase 10's evidence vault). The
 * hash is computed here, server-side, from the submitted content rather
 * than trusted from the client, so a caller can't claim an arbitrary hash
 * for content it never actually sent.
 */
@Injectable()
export class SupplierDocumentsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly auditService: AuditService,
    private readonly supplierProfileService: SupplierProfileService,
    private readonly supplierRiskDetector: SupplierRiskDetector,
  ) {}

  async list(supplierId: string): Promise<SupplierDocumentView[]> {
    await this.supplierProfileService.getByIdOrThrow(supplierId);
    const documents = await this.prisma.supplierDocument.findMany({
      where: { supplierId },
      orderBy: { createdAt: 'desc' },
    });
    return documents.map(toView);
  }

  async upload(
    supplierId: string,
    dto: UploadDocumentDto,
    actor: Actor,
    requestMeta: RequestMeta,
  ): Promise<SupplierDocumentView> {
    await this.supplierProfileService.getByIdOrThrow(supplierId);

    let content: Buffer;
    try {
      content = Buffer.from(dto.fileContentBase64, 'base64');
    } catch {
      throw new BadRequestException('fileContentBase64 is not valid base64');
    }
    if (content.length === 0) {
      throw new BadRequestException('Uploaded document content is empty');
    }

    const fileHash = sha256HexBuffer(content);

    const document = await this.prisma.supplierDocument.create({
      data: {
        supplierId,
        documentType: dto.documentType,
        fileName: dto.fileName,
        mimeType: dto.mimeType,
        fileHash,
        fileSizeBytes: content.length,
        expiryDate: dto.expiryDate ? new Date(dto.expiryDate) : undefined,
        uploadedById: actor.sub,
      },
    });

    await this.auditService.append({
      eventType: 'SUPPLIER_DOCUMENT_UPLOADED',
      actorId: actor.sub,
      actorEmail: actor.email,
      organizationId: actor.organizationId ?? undefined,
      resourceType: 'SupplierDocument',
      resourceId: document.id,
      action: 'create',
      payload: {
        supplierId,
        documentId: document.id,
        documentType: document.documentType,
        fileName: document.fileName,
        fileHash,
      },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    });

    return toView(document);
  }

  async getByIdOrThrow(id: string): Promise<SupplierDocument> {
    const document = await this.prisma.supplierDocument.findUnique({
      where: { id },
    });
    if (!document) {
      throw new NotFoundException('Supplier document not found');
    }
    return document;
  }

  async verify(
    documentId: string,
    actor: Actor,
    requestMeta: RequestMeta,
  ): Promise<SupplierDocumentView> {
    const document = await this.getByIdOrThrow(documentId);
    if (document.status !== 'PENDING') {
      throw new BadRequestException(
        `Cannot verify a document in status ${document.status} — only PENDING documents can be verified`,
      );
    }

    const updated = await this.prisma.supplierDocument.update({
      where: { id: documentId },
      data: {
        status: 'VERIFIED',
        verifiedById: actor.sub,
        verifiedAt: new Date(),
      },
    });

    await this.auditService.append({
      eventType: 'SUPPLIER_DOCUMENT_VERIFIED',
      actorId: actor.sub,
      actorEmail: actor.email,
      organizationId: actor.organizationId ?? undefined,
      resourceType: 'SupplierDocument',
      resourceId: documentId,
      action: 'verify',
      payload: { supplierId: document.supplierId, documentId },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    });

    return toView(updated);
  }

  async reject(
    documentId: string,
    dto: RejectDocumentDto,
    actor: Actor,
    requestMeta: RequestMeta,
  ): Promise<SupplierDocumentView> {
    const document = await this.getByIdOrThrow(documentId);
    if (document.status !== 'PENDING') {
      throw new BadRequestException(
        `Cannot reject a document in status ${document.status} — only PENDING documents can be rejected`,
      );
    }

    const updated = await this.prisma.supplierDocument.update({
      where: { id: documentId },
      data: {
        status: 'REJECTED',
        verifiedById: actor.sub,
        verifiedAt: new Date(),
        rejectionReason: dto.reason,
      },
    });

    await this.auditService.append({
      eventType: 'SUPPLIER_DOCUMENT_REJECTED',
      actorId: actor.sub,
      actorEmail: actor.email,
      organizationId: actor.organizationId ?? undefined,
      resourceType: 'SupplierDocument',
      resourceId: documentId,
      action: 'reject',
      payload: {
        supplierId: document.supplierId,
        documentId,
        reason: dto.reason,
      },
      ipAddress: requestMeta.ipAddress,
      userAgent: requestMeta.userAgent,
    });

    await this.supplierRiskDetector.evaluateSupplier(document.supplierId);

    return toView(updated);
  }
}
