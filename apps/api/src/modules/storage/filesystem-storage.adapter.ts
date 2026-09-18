import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, join, normalize, resolve } from 'node:path';
import { encryptBuffer, decryptBuffer } from '@bpfmps/crypto';
import type {
  HealthCheckResult,
  ObjectStorageAdapter,
  PutObjectInput,
  PutObjectResult,
} from '@bpfmps/storage';
import type { EnvConfig } from '../../config/env.validation';

/**
 * Real local implementation of ObjectStorageAdapter: files are actually
 * written to disk, AES-256-GCM encrypted at rest (`packages/crypto`'s
 * binary-safe `encryptBuffer`/`decryptBuffer`, added for exactly this use),
 * and readable back out — not a hash-only placeholder. This is the same
 * "prove it against a real local stand-in, swappable later" judgment
 * already made for `DATABASE_URL` (local Postgres vs Neon) and
 * `BLOCKCHAIN_ADAPTER` (the development ledger vs a future permissioned
 * chain) — see ARCHITECTURE.md § 7 and § 9.
 */
@Injectable()
export class FilesystemObjectStorageAdapter implements ObjectStorageAdapter {
  private readonly logger = new Logger(FilesystemObjectStorageAdapter.name);
  private readonly basePath: string;
  private readonly encryptionKey: string;

  constructor(private readonly config: ConfigService<EnvConfig, true>) {
    const configuredPath = this.config.get('EVIDENCE_STORAGE_PATH', {
      infer: true,
    });
    this.basePath = isAbsolute(configuredPath)
      ? configuredPath
      : resolve(process.cwd(), configuredPath);
    this.encryptionKey = this.config.get('EVIDENCE_ENCRYPTION_KEY', {
      infer: true,
    });
  }

  /**
   * Resolves a storage key to an on-disk path, rejecting anything that
   * would escape `basePath` (defense in depth — keys are always
   * server-generated UUIDs today, never taken directly from user input, but
   * a future caller shouldn't be able to introduce a path-traversal bug by
   * forgetting that).
   */
  private resolvePath(key: string): string {
    const resolved = normalize(join(this.basePath, key));
    if (!resolved.startsWith(this.basePath)) {
      throw new Error(
        `Refusing to resolve storage key outside base path: ${key}`,
      );
    }
    return resolved;
  }

  async putObject(input: PutObjectInput): Promise<PutObjectResult> {
    const path = this.resolvePath(input.key);
    await mkdir(dirname(path), { recursive: true });
    const encrypted = encryptBuffer(input.data, this.encryptionKey);
    await writeFile(path, encrypted);
    return { key: input.key, sizeBytes: input.data.length };
  }

  async getObject(key: string): Promise<Buffer> {
    const path = this.resolvePath(key);
    const encrypted = await readFile(path);
    return decryptBuffer(encrypted, this.encryptionKey);
  }

  async deleteObject(key: string): Promise<void> {
    const path = this.resolvePath(key);
    await rm(path, { force: true });
  }

  async healthCheck(): Promise<HealthCheckResult> {
    try {
      await mkdir(this.basePath, { recursive: true });
      return {
        healthy: true,
        adapter: 'filesystem',
        details: { basePath: this.basePath },
      };
    } catch (error) {
      this.logger.error('Evidence storage health check failed', error);
      return { healthy: false, adapter: 'filesystem' };
    }
  }
}
