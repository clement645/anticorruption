/**
 * ObjectStorageAdapter — the "large documents live in encrypted object
 * storage, only their hash is anchored on-chain" abstraction described in
 * ARCHITECTURE.md § 7 (Blockchain vs. Database, section 40). Business code
 * depends only on this interface, never on a concrete backend, so the
 * backing store can be swapped (e.g. `FilesystemObjectStorageAdapter` for
 * this prototype → a future S3-compatible `S3ObjectStorageAdapter`) without
 * any caller changing — the same abstraction judgment `BlockchainAdapter`
 * already made in `packages/blockchain`.
 */

export interface PutObjectInput {
  /** Storage key/path — callers choose this, typically including a UUID to avoid collisions. */
  key: string;
  /** Raw bytes to store. Adapters are responsible for encrypting at rest. */
  data: Buffer;
  contentType: string;
}

export interface PutObjectResult {
  key: string;
  sizeBytes: number;
}

export interface HealthCheckResult {
  healthy: boolean;
  adapter: string;
  details?: Record<string, unknown>;
}

export interface ObjectStorageAdapter {
  putObject(input: PutObjectInput): Promise<PutObjectResult>;
  /** Returns the original (decrypted) bytes as they were passed to putObject(). */
  getObject(key: string): Promise<Buffer>;
  deleteObject(key: string): Promise<void>;
  healthCheck(): Promise<HealthCheckResult>;
}
