import { Injectable, Logger } from '@nestjs/common';
import { sha256Hex } from '@bpfmps/crypto';
import type {
  BlockchainAnchor,
  BlockchainTransaction,
  Prisma,
} from '@bpfmps/database';
import type {
  BlockchainAdapter,
  BlockchainTransactionRecord,
  BlockRecord,
  HealthCheckResult,
  RecordEventInput,
  TransactionVerificationResult,
} from '@bpfmps/blockchain';
import { PrismaService } from '../../prisma/prisma.service';

const GENESIS_BLOCK_HASH = sha256Hex('B-PFMPS-BLOCKCHAIN-GENESIS');
// Distinct from the audit chain's lock key (see AuditService) — this ledger
// is a logically independent chain and must serialize independently.
const BLOCK_LOCK_KEY = 471928650041n;

function toTransactionRecord(
  tx: BlockchainTransaction,
): BlockchainTransactionRecord {
  return {
    id: tx.id,
    eventType: tx.eventType,
    payloadHash: tx.payloadHash,
    status: tx.status,
    blockRef: tx.blockId,
    submittedAt: tx.submittedAt.toISOString(),
    confirmedAt: tx.confirmedAt ? tx.confirmedAt.toISOString() : null,
  };
}

function toBlockRecord(block: BlockchainAnchor): BlockRecord {
  return {
    id: block.id,
    sequence: block.sequence.toString(),
    previousBlockHash: block.previousBlockHash,
    blockHash: block.blockHash,
    rootHash: block.rootHash,
    transactionCount: block.transactionCount,
    createdAt: block.createdAt.toISOString(),
  };
}

/**
 * Development/prototype implementation of BlockchainAdapter: a self-contained,
 * hash-chained ledger simulation stored in PostgreSQL (`blockchain_anchors` /
 * `blockchain_transactions`) — no external network, no consensus delay. Every
 * recorded event finalizes into its own block immediately, unlike a real
 * permissioned blockchain which would batch transactions per block on a real
 * interval. Swappable for a real `PermissionedBlockchainAdapter`
 * (Hyperledger Fabric/Besu) later without any caller changing — see
 * blockchain.module.ts.
 */
@Injectable()
export class DevelopmentLedgerAdapter implements BlockchainAdapter {
  private readonly logger = new Logger(DevelopmentLedgerAdapter.name);

  constructor(private readonly prisma: PrismaService) {}

  async recordEvent(
    input: RecordEventInput,
  ): Promise<BlockchainTransactionRecord> {
    const { transaction } = await this.recordAndFinalize(input);
    return transaction;
  }

  async anchorHash(
    payloadHash: string,
    metadata?: Record<string, unknown>,
  ): Promise<{ transaction: BlockchainTransactionRecord; block: BlockRecord }> {
    return this.recordAndFinalize({
      eventType: 'AUDIT_ANCHOR',
      payloadHash,
      metadata,
    });
  }

  private async recordAndFinalize(
    input: RecordEventInput,
  ): Promise<{ transaction: BlockchainTransactionRecord; block: BlockRecord }> {
    const result = await this.prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(${BLOCK_LOCK_KEY})`;

      const lastBlock = await tx.blockchainAnchor.findFirst({
        orderBy: { sequence: 'desc' },
      });
      const previousBlockHash = lastBlock?.blockHash ?? GENESIS_BLOCK_HASH;

      const createdAt = new Date();
      // The dev adapter finalizes one transaction per block, so the block's
      // root hash is simply that transaction's payload hash. Metadata is
      // stored but deliberately NOT included in the hash — hashing arbitrary
      // JSON invites the jsonb key-order round-trip hazard documented in
      // AuditService; keeping the hash input to plain strings avoids it.
      const rootHash = input.payloadHash;
      const blockHash = sha256Hex(
        previousBlockHash + rootHash + createdAt.toISOString(),
      );

      const block = await tx.blockchainAnchor.create({
        data: {
          previousBlockHash,
          blockHash,
          rootHash,
          transactionCount: 1,
          createdAt,
        },
      });

      const transaction = await tx.blockchainTransaction.create({
        data: {
          eventType: input.eventType,
          payloadHash: input.payloadHash,
          status: 'CONFIRMED',
          metadata: (input.metadata as Prisma.InputJsonValue) ?? undefined,
          blockId: block.id,
          submittedAt: createdAt,
          confirmedAt: createdAt,
        },
      });

      return { transaction, block };
    });

    return {
      transaction: toTransactionRecord(result.transaction),
      block: toBlockRecord(result.block),
    };
  }

  async verifyTransaction(
    transactionId: string,
  ): Promise<TransactionVerificationResult> {
    const transaction = await this.prisma.blockchainTransaction.findUnique({
      where: { id: transactionId },
    });
    if (!transaction) {
      return { found: false };
    }

    if (!transaction.blockId) {
      return { found: true, transaction: toTransactionRecord(transaction) };
    }

    const block = await this.prisma.blockchainAnchor.findUnique({
      where: { id: transaction.blockId },
    });
    if (!block) {
      return { found: true, transaction: toTransactionRecord(transaction) };
    }

    const previous =
      block.sequence > 1n
        ? await this.prisma.blockchainAnchor.findUnique({
            where: { sequence: block.sequence - 1n },
          })
        : null;
    const expectedPrevious = previous?.blockHash ?? GENESIS_BLOCK_HASH;
    const recomputedBlockHash = sha256Hex(
      expectedPrevious + block.rootHash + block.createdAt.toISOString(),
    );

    const chainLinkValid =
      block.previousBlockHash === expectedPrevious &&
      recomputedBlockHash === block.blockHash;

    return {
      found: true,
      transaction: toTransactionRecord(transaction),
      block: toBlockRecord(block),
      chainLinkValid,
    };
  }

  async getTransaction(
    transactionId: string,
  ): Promise<BlockchainTransactionRecord | null> {
    const transaction = await this.prisma.blockchainTransaction.findUnique({
      where: { id: transactionId },
    });
    return transaction ? toTransactionRecord(transaction) : null;
  }

  async getBlock(blockId: string): Promise<BlockRecord | null> {
    const block = await this.prisma.blockchainAnchor.findUnique({
      where: { id: blockId },
    });
    return block ? toBlockRecord(block) : null;
  }

  async healthCheck(): Promise<HealthCheckResult> {
    try {
      const [totalBlocks, totalTransactions] = await this.prisma.$transaction([
        this.prisma.blockchainAnchor.count(),
        this.prisma.blockchainTransaction.count(),
      ]);
      return {
        healthy: true,
        adapter: 'development',
        details: { totalBlocks, totalTransactions },
      };
    } catch (error) {
      this.logger.error('Blockchain adapter health check failed', error);
      return { healthy: false, adapter: 'development' };
    }
  }
}
