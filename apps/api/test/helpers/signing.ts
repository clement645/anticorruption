import { randomUUID } from 'node:crypto';
import { signEd25519 } from '@bpfmps/crypto';

/**
 * Builds the three body fields a @RequireSignature() route expects, signed
 * exactly the way SignatureGuard verifies them:
 * `${METHOD} ${path} ${timestamp} ${nonce}` — see
 * apps/api/src/modules/iam/guards/signature.guard.ts. Used by every e2e spec
 * that needs to call a signature-required endpoint (currently
 * `POST /budgets/:id/approve`) as a fixture-setup step, not just the spec
 * that tests the signing feature itself.
 */
export function signRequest(
  method: string,
  path: string,
  privateKeyPem: string,
) {
  const signatureTimestamp = new Date().toISOString();
  const signatureNonce = randomUUID();
  const canonicalPayload = `${method} ${path} ${signatureTimestamp} ${signatureNonce}`;
  const signature = signEd25519(canonicalPayload, privateKeyPem);
  return { signature, signatureTimestamp, signatureNonce };
}
