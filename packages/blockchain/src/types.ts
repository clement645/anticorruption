/**
 * BlockchainAdapter — the integrity-layer abstraction described in section 54
 * of the governing spec. Business/audit code depends only on this interface,
 * never on a concrete ledger implementation, so the backing ledger can be
 * swapped (e.g. `DevelopmentLedgerAdapter` → a future Hyperledger
 * Fabric/Besu-backed `PermissionedBlockchainAdapter`) without any caller
 * changing. See ARCHITECTURE.md § Blockchain vs. Database.
 */

export type BlockchainTransactionStatus = 'PENDING' | 'CONFIRMED' | 'FAILED';

export interface RecordEventInput {
  /** e.g. "AUDIT_ANCHOR" today; business event types (BudgetAllocated, TenderAwarded, ...) in later phases. */
  eventType: string;
  /** The hash being recorded/anchored — never raw sensitive payload content. */
  payloadHash: string;
  metadata?: Record<string, unknown>;
}

export interface BlockchainTransactionRecord {
  id: string;
  eventType: string;
  payloadHash: string;
  status: BlockchainTransactionStatus;
  blockRef: string | null;
  submittedAt: string;
  confirmedAt: string | null;
}

export interface BlockRecord {
  id: string;
  sequence: string;
  previousBlockHash: string;
  blockHash: string;
  rootHash: string;
  transactionCount: number;
  createdAt: string;
}

export interface TransactionVerificationResult {
  found: boolean;
  transaction?: BlockchainTransactionRecord;
  block?: BlockRecord;
  /** Whether the block containing this transaction still correctly links to its predecessor. */
  chainLinkValid?: boolean;
}

export interface HealthCheckResult {
  healthy: boolean;
  adapter: string;
  details?: Record<string, unknown>;
}

export interface BlockchainAdapter {
  /** Submits a transaction to the ledger and returns once it is durably recorded. */
  recordEvent(input: RecordEventInput): Promise<BlockchainTransactionRecord>;
  /** Convenience wrapper around recordEvent for the common "anchor a single hash" case. */
  anchorHash(
    payloadHash: string,
    metadata?: Record<string, unknown>,
  ): Promise<{ transaction: BlockchainTransactionRecord; block: BlockRecord }>;
  verifyTransaction(transactionId: string): Promise<TransactionVerificationResult>;
  getTransaction(transactionId: string): Promise<BlockchainTransactionRecord | null>;
  getBlock(blockId: string): Promise<BlockRecord | null>;
  healthCheck(): Promise<HealthCheckResult>;
}
