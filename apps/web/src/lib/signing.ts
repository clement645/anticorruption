/**
 * Client-side Ed25519 key generation and request signing (section 6 — see
 * SECURITY.md § Digital Signatures for the full design). The private key is
 * generated in the browser and NEVER sent anywhere — only the public key is
 * uploaded (POST /users/me/signing-key). This is what makes a resulting
 * signature genuine non-repudiation: nobody on the server side, including an
 * administrator, ever has the means to forge it.
 *
 * Known limitation, documented rather than hidden: the private key is kept
 * in this browser's localStorage so it survives a page reload without
 * re-entering anything. In a production deployment this should be replaced
 * by a hardware token, the OS keystore, or a non-extractable WebAuthn/Web
 * Crypto key — see SECURITY.md for the full caveat. This is acceptable for
 * a prototype demonstrating the mechanism, not for a real deployment.
 */
import { keygen, sign, hashes } from '@noble/ed25519'
import { sha512 } from '@noble/hashes/sha2.js'

// @noble/hashes' sha512 and @noble/ed25519's expected hash type disagree on
// ArrayBuffer vs. ArrayBufferLike generics under strict TS lib.dom — a type
// system nuisance, not a real incompatibility (this is the library's own
// documented wiring pattern).
if (!hashes.sha512) {
  hashes.sha512 = sha512 as unknown as typeof hashes.sha512
}

const STORAGE_PREFIX = 'bpfmps_signing_key_'

// Fixed 12-byte ASN.1 DER prefix for an Ed25519 SubjectPublicKeyInfo (RFC
// 8410) — constant for every Ed25519 public key, never computed.
const SPKI_PREFIX = new Uint8Array([
  0x30, 0x2a, 0x30, 0x05, 0x06, 0x03, 0x2b, 0x65, 0x70, 0x03, 0x21, 0x00,
])

function bytesToBase64(bytes: Uint8Array): string {
  let binary = ''
  for (const byte of bytes) binary += String.fromCharCode(byte)
  return btoa(binary)
}

function base64ToBytes(base64: string): Uint8Array {
  const binary = atob(base64)
  const bytes = new Uint8Array(binary.length)
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i)
  return bytes
}

function publicKeyToSpkiPem(publicKey: Uint8Array): string {
  const der = new Uint8Array(SPKI_PREFIX.length + publicKey.length)
  der.set(SPKI_PREFIX, 0)
  der.set(publicKey, SPKI_PREFIX.length)
  const b64 = bytesToBase64(der)
  const lines = b64.match(/.{1,64}/g) ?? [b64]
  return `-----BEGIN PUBLIC KEY-----\n${lines.join('\n')}\n-----END PUBLIC KEY-----\n`
}

export interface GeneratedSigningKey {
  secretKey: Uint8Array
  publicKeyPem: string
}

export function generateSigningKeyPair(): GeneratedSigningKey {
  const { secretKey, publicKey } = keygen()
  return { secretKey, publicKeyPem: publicKeyToSpkiPem(publicKey) }
}

export function signPayload(secretKey: Uint8Array, payload: string): string {
  const message = new TextEncoder().encode(payload)
  const signature = sign(message, secretKey)
  return bytesToBase64(signature)
}

/** Per-user so switching accounts on the same device never signs with the wrong key. */
function storageKey(userId: string): string {
  return `${STORAGE_PREFIX}${userId}`
}

export function saveSigningKey(userId: string, secretKey: Uint8Array): void {
  try {
    localStorage.setItem(storageKey(userId), bytesToBase64(secretKey))
  } catch {
    // localStorage can be unavailable (private browsing, blocked site data);
    // the key generation/enrollment itself already succeeded server-side,
    // so this only means the user will need to re-enroll on this device.
  }
}

export function loadSigningKey(userId: string): Uint8Array | null {
  try {
    const stored = localStorage.getItem(storageKey(userId))
    return stored ? base64ToBytes(stored) : null
  } catch {
    return null
  }
}

export function clearSigningKey(userId: string): void {
  try {
    localStorage.removeItem(storageKey(userId))
  } catch {
    // Nothing to do if storage is unavailable.
  }
}

/** Builds the three fields a @RequireSignature() endpoint expects, signed exactly how SignatureGuard verifies them. */
export function buildSignedFields(
  secretKey: Uint8Array,
  method: string,
  path: string,
) {
  const signatureTimestamp = new Date().toISOString()
  const signatureNonce = crypto.randomUUID()
  const canonicalPayload = `${method} ${path} ${signatureTimestamp} ${signatureNonce}`
  const signature = signPayload(secretKey, canonicalPayload)
  return { signature, signatureTimestamp, signatureNonce }
}
