import { createHash } from 'node:crypto';

/**
 * Deterministic SHA-256 hex digest. Used for content hashes (audit payload
 * hashing, evidence hashing — later phases) and for storing lookup-able
 * secrets (refresh tokens, API keys) without ever persisting the secret
 * itself. Never used for passwords — see argon2id in the IAM auth service.
 */
export function sha256Hex(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

/**
 * SHA-256 hex digest of raw binary content (a file's actual bytes, not a
 * UTF-8 string of them) — used for content integrity hashing where the
 * result must match what a standard tool (e.g. `sha256sum`) would compute
 * over the same bytes, such as supplier compliance documents (Phase 7) and,
 * later, project evidence (Phase 10).
 */
export function sha256HexBuffer(input: Buffer): string {
  return createHash('sha256').update(input).digest('hex');
}
