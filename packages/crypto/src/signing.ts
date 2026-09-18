import { createPrivateKey, createPublicKey, generateKeyPairSync, sign, verify } from 'node:crypto';

/**
 * Application-level Ed25519 digital signatures for the immutable audit chain
 * (section 6/7). Deliberately key-agnostic at the call site — `sign`/`verify`
 * only need PEM text, so a future government PKI/HSM-backed key can replace
 * the application-managed key in .env without any caller changing (see
 * SECURITY.md § Digital Signatures).
 */
export interface Ed25519KeyPairPem {
  privateKeyPem: string;
  publicKeyPem: string;
}

export function generateEd25519KeyPair(): Ed25519KeyPairPem {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

export function signEd25519(data: string, privateKeyPem: string): string {
  const key = createPrivateKey(privateKeyPem);
  // Ed25519 is used with a null digest algorithm — it hashes internally.
  return sign(null, Buffer.from(data, 'utf8'), key).toString('base64');
}

export function verifyEd25519(data: string, signatureBase64: string, publicKeyPem: string): boolean {
  try {
    const key = createPublicKey(publicKeyPem);
    return verify(null, Buffer.from(data, 'utf8'), key, Buffer.from(signatureBase64, 'base64'));
  } catch {
    return false;
  }
}
