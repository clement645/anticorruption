import { BadRequestException, Injectable } from '@nestjs/common';
import { createPublicKey, randomUUID } from 'node:crypto';
import { Prisma } from '@bpfmps/database';
import { verifyEd25519 } from '@bpfmps/crypto';
import { PrismaService } from '../../../prisma/prisma.service';

interface VerifyResult {
  valid: boolean;
  reason?: string;
  keyId?: string;
}

/**
 * Per-official digital signatures (section 6) — see the schema.prisma
 * comment on DigitalIdentity for why the private key is never handled here.
 * This service only ever sees public keys and signatures, never a secret.
 */
@Injectable()
export class IdentityService {
  constructor(private readonly prisma: PrismaService) {}

  async uploadPublicKey(userId: string, publicKeyPem: string) {
    try {
      const keyObject = createPublicKey(publicKeyPem);
      if (keyObject.asymmetricKeyType !== 'ed25519') {
        throw new BadRequestException('Only Ed25519 public keys are supported');
      }
    } catch (error) {
      if (error instanceof BadRequestException) {
        throw error;
      }
      throw new BadRequestException(
        'publicKeyPem is not a valid SPKI/PEM-encoded public key',
      );
    }

    const keyId = randomUUID();
    await this.prisma.$transaction([
      // A user has at most one ACTIVE key at a time — older keys are kept
      // (never deleted) so signatures made before a rotation still verify,
      // but are marked revoked so they can no longer be used to sign
      // anything new.
      this.prisma.digitalIdentity.updateMany({
        where: { userId, revokedAt: null },
        data: { revokedAt: new Date() },
      }),
      this.prisma.digitalIdentity.create({
        data: { userId, keyId, publicKey: publicKeyPem, algorithm: 'Ed25519' },
      }),
    ]);

    return { keyId, algorithm: 'Ed25519' as const };
  }

  async getStatus(userId: string) {
    const active = await this.prisma.digitalIdentity.findFirst({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!active) {
      return { enrolled: false as const };
    }
    return {
      enrolled: true as const,
      keyId: active.keyId,
      algorithm: active.algorithm,
      createdAt: active.createdAt.toISOString(),
    };
  }

  /**
   * Verifies `signatureBase64` over `canonicalPayload` against the user's
   * currently active key, then atomically consumes `nonce` — the unique
   * constraint on SignatureNonce.nonce is the actual replay defense, not a
   * pre-check, so two concurrent requests with the same nonce cannot both
   * pass even under a race.
   */
  async verifyAndConsumeNonce(
    userId: string,
    canonicalPayload: string,
    signatureBase64: string,
    nonce: string,
  ): Promise<VerifyResult> {
    const active = await this.prisma.digitalIdentity.findFirst({
      where: { userId, revokedAt: null },
      orderBy: { createdAt: 'desc' },
    });
    if (!active) {
      return {
        valid: false,
        reason:
          'No active signing key enrolled for this account — enroll one first',
      };
    }

    if (!verifyEd25519(canonicalPayload, signatureBase64, active.publicKey)) {
      return {
        valid: false,
        reason: 'Signature does not match the enrolled public key',
      };
    }

    try {
      await this.prisma.signatureNonce.create({ data: { userId, nonce } });
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        return {
          valid: false,
          reason: 'This signature has already been used (replay detected)',
        };
      }
      throw error;
    }

    return { valid: true, keyId: active.keyId };
  }
}
