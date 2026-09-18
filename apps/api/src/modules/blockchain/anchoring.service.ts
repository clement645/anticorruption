import { Inject, Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Interval } from '@nestjs/schedule';
import { sha256Hex } from '@bpfmps/crypto';
import type { BlockchainAdapter } from '@bpfmps/blockchain';
import { AuditService } from '../audit/audit.service';
import type { EnvConfig } from '../../config/env.validation';
import { BLOCKCHAIN_ADAPTER } from './blockchain.constants';

export interface AnchoringRunResult {
  anchoredCount: number;
  transactionId?: string;
  blockId?: string;
}

/**
 * Periodically rolls up not-yet-anchored audit_events into one blockchain
 * transaction/block. Runs on an interval (BLOCKCHAIN_ANCHOR_INTERVAL_SECONDS)
 * and can also be triggered on demand via POST /api/v1/blockchain/anchor —
 * both paths call the same runOnce(), so there is exactly one code path to
 * reason about.
 */
@Injectable()
export class AnchoringService {
  private readonly logger = new Logger(AnchoringService.name);
  // Holds the in-flight run's promise (not just a boolean) so that a caller
  // who arrives while a run is already underway — the 5s interval tick and
  // a manual POST /blockchain/anchor racing each other — awaits and returns
  // that SAME real result, instead of a boolean guard short-circuiting with
  // a misleading `{anchoredCount: 0}` while genuine anchoring is happening
  // concurrently in the background. Found via Phase 8's repeated
  // stress-testing pass (this test suite failing intermittently, roughly
  // every other accumulated run) — a real pre-existing Phase 4 race, not
  // something Phase 8 introduced, but worth fixing now that it surfaced.
  private runningPromise: Promise<AnchoringRunResult> | null = null;
  // Starts the countdown from process boot, not epoch 0 — otherwise the
  // first 5s tick's elapsed-time check (Date.now() - 0) is always far past
  // the configured interval, firing an automatic run immediately on every
  // boot. That both surprises operators (an expensive job firing the instant
  // a fresh instance starts) and, in tests, can race a manual trigger for
  // the same events. Manual triggers via runOnce() are unaffected either way.
  private lastRunAt = Date.now();

  constructor(
    private readonly auditService: AuditService,
    private readonly config: ConfigService<EnvConfig, true>,
    @Inject(BLOCKCHAIN_ADAPTER) private readonly blockchain: BlockchainAdapter,
  ) {}

  // Ticks every 5s (NestJS @Interval takes a compile-time constant, so it
  // can't read the configured cadence directly); the configured
  // BLOCKCHAIN_ANCHOR_INTERVAL_SECONDS is enforced by the elapsed-time guard
  // below, which is the value that actually governs anchoring frequency.
  @Interval(5_000)
  async handleInterval(): Promise<void> {
    const intervalMs =
      this.config.get('BLOCKCHAIN_ANCHOR_INTERVAL_SECONDS', { infer: true }) *
      1000;
    if (Date.now() - this.lastRunAt < intervalMs) {
      return;
    }
    this.lastRunAt = Date.now();
    await this.runOnce();
  }

  /**
   * Rolls up up to BLOCKCHAIN_ANCHOR_BATCH_SIZE unanchored events into a
   * single anchor. An in-process promise (not a DB lock) serializes
   * overlapping runs within this same process — a concurrent caller awaits
   * and receives the SAME result rather than triggering a second redundant
   * run; the blockchain adapter's own advisory lock is still the source of
   * truth for cross-process safety.
   */
  async runOnce(): Promise<AnchoringRunResult> {
    if (this.runningPromise) {
      return this.runningPromise;
    }
    this.runningPromise = this.doRun();
    try {
      return await this.runningPromise;
    } finally {
      this.runningPromise = null;
    }
  }

  private async doRun(): Promise<AnchoringRunResult> {
    try {
      const batchSize = this.config.get('BLOCKCHAIN_ANCHOR_BATCH_SIZE', {
        infer: true,
      });
      const events = await this.auditService.getUnanchoredEvents(batchSize);

      if (events.length === 0) {
        return { anchoredCount: 0 };
      }

      // Concatenating hashes (not JSON) sidesteps the jsonb key-order hazard
      // entirely — there is no object serialization involved here.
      const rootHash = sha256Hex(events.map((e) => e.currentHash).join('|'));

      const { transaction, block } = await this.blockchain.anchorHash(
        rootHash,
        {
          eventCount: events.length,
          fromSequence: events[0].sequence,
          toSequence: events[events.length - 1].sequence,
        },
      );

      const anchoredCount = await this.auditService.recordAnchor(
        events.map((e) => e.id),
        transaction.id,
      );

      this.logger.log(
        `Anchored ${anchoredCount} audit event(s) into blockchain transaction ${transaction.id} (block ${block.id})`,
      );

      return {
        anchoredCount,
        transactionId: transaction.id,
        blockId: block.id,
      };
    } catch (error) {
      this.logger.error('Anchoring run failed', error);
      return { anchoredCount: 0 };
    }
  }
}
