import { randomBytes, randomInt } from 'node:crypto';

/**
 * Cryptographically random opaque token (refresh tokens, MFA backup codes'
 * source material). URL-safe, no padding.
 */
export function generateOpaqueToken(bytes = 48): string {
  return randomBytes(bytes).toString('base64url');
}

/**
 * Human-typeable backup/recovery code, e.g. "7K3F-9QXZ-2MRT". Grouped for
 * readability; drawn from crypto.randomInt (not Math.random).
 */
export function generateBackupCode(): string {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I ambiguity
  const groups: string[] = [];
  for (let g = 0; g < 3; g++) {
    let group = '';
    for (let i = 0; i < 4; i++) {
      group += alphabet[randomInt(alphabet.length)];
    }
    groups.push(group);
  }
  return groups.join('-');
}
