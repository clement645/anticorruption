import { Injectable, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { sha256Hex, signEd25519, verifyEd25519 } from '@bpfmps/crypto';
import type { AuditEvent } from '@bpfmps/database';
import { PrismaService } from '../../prisma/prisma.service';
import type { EnvConfig } from '../../config/env.validation';
import type {
  AppendAuditEventInput,
  AuditEventView,
  ChainVerificationResult,
  EventVerificationResult,
  ResourceReconstructionResult,
} from './audit.types';

const GENESIS_HASH = sha256Hex('B-PFMPS-AUDIT-GENESIS');
// Fixed, arbitrary key for the Postgres advisory lock that serializes chain
// appends — see append() below. Any distinct bigint works; it is not a secret.
const CHAIN_LOCK_KEY = 892745100317n;

function decodePem(base64Pem: string): string {
  return Buffer.from(base64Pem, 'base64').toString('utf8');
}

/**
 * Postgres's `jsonb` type explicitly does not preserve object key order on
 * round-trip (per the PostgreSQL documentation). Hashing `JSON.stringify()`
 * directly would therefore make payloadHash legitimately unstable across a
 * write→read round-trip even with zero tampering. Sorting object keys
 * recursively (array *order* is preserved — only object key order is
 * unstable in jsonb) makes the serialization deterministic regardless of
 * whether the value just came from the caller or was just read back from the
 * database, so the same hash is computed both times.
 */
function canonicalStringify(value: unknown): string {
  return JSON.stringify(sortKeysDeep(value));
}

function sortKeysDeep(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortKeysDeep);
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).sort(
      ([a], [b]) => a.localeCompare(b),
    );
    const sorted: Record<string, unknown> = {};
    for (const [key, val] of entries) {
      sorted[key] = sortKeysDeep(val);
    }
    return sorted;
  }
  return value;
}

function toView(event: AuditEvent): AuditEventView {
  return {
    id: event.id,
    sequence: event.sequence.toString(),
    eventType: event.eventType,
    actorId: event.actorId,
    actorIdSnapshot: event.actorIdSnapshot,
    actorEmail: event.actorEmail,
    organizationId: event.organizationId,
    resourceType: event.resourceType,
    resourceId: event.resourceId,
    action: event.action,
    payload: event.payload,
    payloadHash: event.payloadHash,
    previousHash: event.previousHash,
    currentHash: event.currentHash,
    signature: event.signature,
    signatureKeyId: event.signatureKeyId,
    ipAddress: event.ipAddress,
    userAgent: event.userAgent,
    requestId: event.requestId,
    correlationId: event.correlationId,
    blockchainTxRef: event.blockchainTxRef,
    createdAt: event.createdAt.toISOString(),
  };
}

/**
 * Append-only, hash-chained, digitally-signed audit trail (section 7). No
 * method here ever issues UPDATE/DELETE against audit_events — corrections to
 * history are not representable through this service, by design.
 */
@Injectable()
export class AuditService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<EnvConfig, true>,
  ) {}

  /**
   * Appends one event to the chain. Writes are serialized with a Postgres
   * advisory transaction lock so concurrent requests cannot both read the
   * same "latest" event and fork the chain — the lock is held only for the
   * read-latest + compute + insert sequence, and is released automatically
   * at transaction end.
   */
  async append(input: AppendAuditEventInput): Promise<AuditEventView> {
    const privateKeyPem = decodePem(
      this.config.get('AUDIT_SIGNING_PRIVATE_KEY', { infer: true }),
    );
    const keyId = this.config.get('AUDIT_SIGNING_KEY_ID', { infer: true });

    const event = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${CHAIN_LOCK_KEY})`;

      const last = await tx.auditEvent.findFirst({
        orderBy: { sequence: 'desc' },
      });
      const previousHash = last?.currentHash ?? GENESIS_HASH;

      const createdAt = new Date();
      const payload = input.payload ?? {};
      const payloadHash = sha256Hex(canonicalStringify(payload));
      // Hashed using the actor id as provided now — this value is frozen into
      // actorIdSnapshot below and is what verification will always recompute
      // from, never the live (mutable, SET NULL-on-delete) `actorId` relation
      // column. See the schema comment on actorIdSnapshot.
      const currentHash = sha256Hex(
        previousHash +
          payloadHash +
          createdAt.toISOString() +
          (input.actorId ?? ''),
      );
      const signature = signEd25519(currentHash, privateKeyPem);

      return tx.auditEvent.create({
        data: {
          eventType: input.eventType,
          actorId: input.actorId,
          actorIdSnapshot: input.actorId,
          actorEmail: input.actorEmail,
          organizationId: input.organizationId,
          resourceType: input.resourceType,
          resourceId: input.resourceId,
          action: input.action,
          payload,
          payloadHash,
          previousHash,
          currentHash,
          signature,
          signatureKeyId: keyId,
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
          requestId: input.requestId,
          correlationId: input.correlationId,
          createdAt,
        },
      });
    });

    return toView(event);
  }

  async list(params: {
    skip?: number;
    take?: number;
    eventType?: string;
    actorId?: string;
    resourceType?: string;
    resourceId?: string;
  }): Promise<{ items: AuditEventView[]; total: number }> {
    const where = {
      ...(params.eventType ? { eventType: params.eventType } : {}),
      ...(params.actorId ? { actorId: params.actorId } : {}),
      ...(params.resourceType ? { resourceType: params.resourceType } : {}),
      ...(params.resourceId ? { resourceId: params.resourceId } : {}),
    };
    const [items, total] = await this.prisma.$transaction([
      this.prisma.auditEvent.findMany({
        where,
        orderBy: { sequence: 'desc' },
        skip: params.skip ?? 0,
        take: params.take ?? 25,
      }),
      this.prisma.auditEvent.count({ where }),
    ]);
    return { items: items.map(toView), total };
  }

  async getById(id: string): Promise<AuditEventView> {
    const event = await this.prisma.auditEvent.findUnique({ where: { id } });
    if (!event) {
      throw new NotFoundException('Audit event not found');
    }
    return toView(event);
  }

  /**
   * Events not yet rolled up into a blockchain anchor (Phase 4), oldest
   * first, up to `limit`. Read-only — pairs with recordAnchor() below.
   */
  async getUnanchoredEvents(limit: number): Promise<AuditEventView[]> {
    const events = await this.prisma.auditEvent.findMany({
      where: { blockchainTxRef: null },
      orderBy: { sequence: 'asc' },
      take: limit,
    });
    return events.map(toView);
  }

  /**
   * The sole exception to "no UPDATE ever" on this table (see DATABASE.md §
   * Conventions): sets `blockchainTxRef` on events that don't have one yet,
   * once they've been rolled into a confirmed blockchain anchor. Never
   * touches any hashed/signed field, never overwrites an existing reference
   * (the WHERE clause below is load-bearing, not defensive decoration), and
   * is idempotent — safe to call again with the same ids if a caller retries.
   */
  async recordAnchor(
    eventIds: string[],
    transactionId: string,
  ): Promise<number> {
    if (eventIds.length === 0) {
      return 0;
    }
    const result = await this.prisma.auditEvent.updateMany({
      where: { id: { in: eventIds }, blockchainTxRef: null },
      data: { blockchainTxRef: transactionId },
    });
    return result.count;
  }

  /**
   * Walks the entire chain in order, recomputing each event's payload hash,
   * chain link, current hash, and signature. Stops at the first mismatch —
   * that is the point of tampering (or the point after which the chain can
   * no longer be trusted without further investigation).
   */
  async verifyChain(): Promise<ChainVerificationResult> {
    const publicKeyPem = decodePem(
      this.config.get('AUDIT_SIGNING_PUBLIC_KEY', { infer: true }),
    );
    const events = await this.prisma.auditEvent.findMany({
      orderBy: { sequence: 'asc' },
    });

    let expectedPrevious = GENESIS_HASH;
    let checked = 0;

    for (const event of events) {
      checked += 1;
      const payloadHash = sha256Hex(canonicalStringify(event.payload ?? {}));
      if (payloadHash !== event.payloadHash) {
        return this.broken(checked, event, 'payload_hash_mismatch');
      }
      if (event.previousHash !== expectedPrevious) {
        return this.broken(checked, event, 'chain_link_broken');
      }
      const recomputedCurrent = sha256Hex(
        expectedPrevious +
          payloadHash +
          event.createdAt.toISOString() +
          (event.actorIdSnapshot ?? ''),
      );
      if (recomputedCurrent !== event.currentHash) {
        return this.broken(checked, event, 'current_hash_mismatch');
      }
      if (!verifyEd25519(event.currentHash, event.signature, publicKeyPem)) {
        return this.broken(checked, event, 'signature_invalid');
      }
      expectedPrevious = event.currentHash;
    }

    return { valid: true, totalChecked: checked };
  }

  /** Single-event drill-down for the auditor "verify this transaction" flow (section 55). */
  async verifyEvent(id: string): Promise<EventVerificationResult> {
    const event = await this.prisma.auditEvent.findUnique({ where: { id } });
    if (!event) {
      throw new NotFoundException('Audit event not found');
    }

    const publicKeyPem = decodePem(
      this.config.get('AUDIT_SIGNING_PUBLIC_KEY', { infer: true }),
    );
    const previous =
      event.sequence > 1n
        ? await this.prisma.auditEvent.findUnique({
            where: { sequence: event.sequence - 1n },
          })
        : null;
    const expectedPrevious = previous?.currentHash ?? GENESIS_HASH;

    const payloadHash = sha256Hex(canonicalStringify(event.payload ?? {}));
    const payloadHashValid = payloadHash === event.payloadHash;
    const chainLinkValid = event.previousHash === expectedPrevious;
    const recomputedCurrent = sha256Hex(
      expectedPrevious +
        payloadHash +
        event.createdAt.toISOString() +
        (event.actorIdSnapshot ?? ''),
    );
    const currentHashValid = recomputedCurrent === event.currentHash;
    const signatureValid = verifyEd25519(
      event.currentHash,
      event.signature,
      publicKeyPem,
    );

    return {
      event: toView(event),
      checks: {
        payloadHashValid,
        chainLinkValid,
        currentHashValid,
        signatureValid,
      },
      verified:
        payloadHashValid &&
        chainLinkValid &&
        currentHashValid &&
        signatureValid,
    };
  }

  /**
   * The Auditor Portal's forensic centerpiece (section 55, Phase 11): every
   * audit event ever recorded against one specific resource, in order, each
   * independently re-verified via the same logic as `verifyEvent()` — not a
   * cheaper "trust the stored blockchainTxRef" shortcut. Chain-link validity
   * for each event is still checked against its true predecessor in the
   * FULL chain (verifyEvent() looks that up by sequence, not by position
   * within this filtered subset), so a tampered event elsewhere in the
   * chain still correctly fails here even if it belongs to a different
   * resource entirely.
   */
  async reconstructResource(
    resourceType: string,
    resourceId: string,
  ): Promise<ResourceReconstructionResult> {
    const events = await this.prisma.auditEvent.findMany({
      where: { resourceType, resourceId },
      orderBy: { sequence: 'asc' },
      select: { id: true },
    });
    const verifications = await Promise.all(
      events.map((e) => this.verifyEvent(e.id)),
    );
    return {
      resourceType,
      resourceId,
      totalEvents: verifications.length,
      fullyVerified: verifications.every((v) => v.verified),
      events: verifications,
    };
  }

  private broken(
    checked: number,
    event: AuditEvent,
    reason: ChainVerificationResult['reason'],
  ): ChainVerificationResult {
    return {
      valid: false,
      totalChecked: checked,
      brokenAtSequence: event.sequence.toString(),
      reason,
    };
  }
}
