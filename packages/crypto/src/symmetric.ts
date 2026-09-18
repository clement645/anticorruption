import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto';

const ALGORITHM = 'aes-256-gcm';
const IV_LENGTH = 12;

/**
 * AES-256-GCM encryption for sensitive-but-needed-in-cleartext-eventually
 * values (MFA TOTP secrets today; evidence metadata in a later phase). The
 * key is application-managed for this prototype; the interface is kept
 * key-agnostic so it can be backed by an HSM/KMS later without callers
 * changing (see SECURITY.md § Digital Signatures for the same principle
 * applied to signing keys).
 *
 * Output format: base64(iv) + "." + base64(authTag) + "." + base64(ciphertext)
 */
export function encrypt(plaintext: string, keyBase64: string): string {
  const key = normalizeKey(keyBase64);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return [iv.toString('base64'), authTag.toString('base64'), ciphertext.toString('base64')].join(
    '.',
  );
}

export function decrypt(payload: string, keyBase64: string): string {
  const key = normalizeKey(keyBase64);
  const [ivB64, authTagB64, ciphertextB64] = payload.split('.');
  if (!ivB64 || !authTagB64 || !ciphertextB64) {
    throw new Error('Malformed encrypted payload');
  }
  const decipher = createDecipheriv(ALGORITHM, key, Buffer.from(ivB64, 'base64'));
  decipher.setAuthTag(Buffer.from(authTagB64, 'base64'));
  const plaintext = Buffer.concat([
    decipher.update(Buffer.from(ciphertextB64, 'base64')),
    decipher.final(),
  ]);
  return plaintext.toString('utf8');
}

function normalizeKey(keyBase64: string): Buffer {
  const key = Buffer.from(keyBase64, 'base64');
  if (key.length !== 32) {
    throw new Error('Encryption key must decode to exactly 32 bytes (AES-256)');
  }
  return key;
}

/**
 * Binary-safe counterpart to encrypt()/decrypt(), for raw file bytes rather
 * than UTF-8 text — `encrypt()` runs plaintext through `cipher.update(text,
 * 'utf8')`, which would corrupt arbitrary binary content (images, PDFs) fed
 * through it as if it were a UTF-8 string. Introduced for Phase 10's
 * evidence vault, the first place this codebase actually stores encrypted
 * file bytes rather than only a hash of them.
 *
 * Output format: iv (12 bytes) + authTag (16 bytes) + ciphertext, concatenated
 * as one Buffer — no base64/string framing, since the caller already has a
 * Buffer and is about to write it to a byte-oriented store.
 */
export function encryptBuffer(plaintext: Buffer, keyBase64: string): Buffer {
  const key = normalizeKey(keyBase64);
  const iv = randomBytes(IV_LENGTH);
  const cipher = createCipheriv(ALGORITHM, key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const authTag = cipher.getAuthTag();
  return Buffer.concat([iv, authTag, ciphertext]);
}

export function decryptBuffer(payload: Buffer, keyBase64: string): Buffer {
  const key = normalizeKey(keyBase64);
  const iv = payload.subarray(0, IV_LENGTH);
  const authTag = payload.subarray(IV_LENGTH, IV_LENGTH + 16);
  const ciphertext = payload.subarray(IV_LENGTH + 16);
  const decipher = createDecipheriv(ALGORITHM, key, iv);
  decipher.setAuthTag(authTag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]);
}
