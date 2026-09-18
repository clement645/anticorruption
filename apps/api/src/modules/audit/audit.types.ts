import type { Prisma } from '@bpfmps/database';

export interface AppendAuditEventInput {
  eventType: string;
  actorId?: string;
  actorEmail?: string;
  organizationId?: string;
  resourceType?: string;
  resourceId?: string;
  action: string;
  payload?: Prisma.InputJsonValue;
  ipAddress?: string;
  userAgent?: string;
  requestId?: string;
  correlationId?: string;
}

/** JSON-safe view of an AuditEvent row — `sequence` (BigInt) is a string here. */
export interface AuditEventView {
  id: string;
  sequence: string;
  eventType: string;
  actorId: string | null;
  actorIdSnapshot: string | null;
  actorEmail: string | null;
  organizationId: string | null;
  resourceType: string | null;
  resourceId: string | null;
  action: string;
  payload: unknown;
  payloadHash: string;
  previousHash: string;
  currentHash: string;
  signature: string;
  signatureKeyId: string;
  ipAddress: string | null;
  userAgent: string | null;
  requestId: string | null;
  correlationId: string | null;
  blockchainTxRef: string | null;
  createdAt: string;
}

export interface ChainVerificationResult {
  valid: boolean;
  totalChecked: number;
  brokenAtSequence?: string;
  reason?:
    | 'payload_hash_mismatch'
    | 'chain_link_broken'
    | 'current_hash_mismatch'
    | 'signature_invalid';
}

export interface EventVerificationResult {
  event: AuditEventView;
  checks: {
    payloadHashValid: boolean;
    chainLinkValid: boolean;
    currentHashValid: boolean;
    signatureValid: boolean;
  };
  verified: boolean;
}

/**
 * "Transaction reconstruction" (section 55): every audit event recorded
 * against one specific resource, each independently re-verified — not just
 * filtered from the raw list. `resourceType`/`resourceId` are plain strings
 * on `AuditEvent` (never a foreign key — see schema.prisma comment), so this
 * is a string-match query only; AuditService never needs to know what a
 * "Contract" or "Project" actually is.
 */
export interface ResourceReconstructionResult {
  resourceType: string;
  resourceId: string;
  totalEvents: number;
  fullyVerified: boolean;
  events: EventVerificationResult[];
}
