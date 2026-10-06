import { BadRequestException, ConflictException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { authenticator } from 'otplib';
import {
  encrypt,
  decrypt,
  generateBackupCode,
  sha256Hex,
} from '@bpfmps/crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import type { EnvConfig } from '../../../config/env.validation';

const ISSUER = 'B-PFMPS';
const BACKUP_CODE_COUNT = 10;
// otplib's default TOTP step — matches authenticator.allOptions().step,
// not re-read from the library at runtime since it's a stable RFC 6238
// default this project never overrides.
const TOTP_STEP_SECONDS = 30;

function currentTotpStep(): number {
  return Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS);
}

@Injectable()
export class MfaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<EnvConfig, true>,
  ) {}

  /** Generates a new TOTP secret and stores it encrypted, not yet enabled. */
  async beginTotpSetup(userId: string, email: string) {
    // Re-running setup on an enabled account would flip enabled=false and replace
    // the secret without any code check, silently switching MFA off for anyone
    // holding a valid access token. Replacing an active authenticator needs a
    // deliberate disable/replace flow, not this endpoint.
    const existing = await this.prisma.mfaMethod.findUnique({
      where: { userId_type: { userId, type: 'TOTP' } },
    });
    if (existing?.enabled) {
      throw new ConflictException(
        'An authenticator is already enabled for this account',
      );
    }

    const secret = authenticator.generateSecret();
    const encryptedSecret = encrypt(
      secret,
      this.config.get('MFA_ENCRYPTION_KEY', { infer: true }),
    );

    await this.prisma.mfaMethod.upsert({
      where: { userId_type: { userId, type: 'TOTP' } },
      create: {
        userId,
        type: 'TOTP',
        secretEncrypted: encryptedSecret,
        enabled: false,
      },
      update: { secretEncrypted: encryptedSecret, enabled: false },
    });

    const otpauthUrl = authenticator.keyuri(email, ISSUER, secret);
    return { secret, otpauthUrl };
  }

  /** Verifies the setup code and flips the method to enabled, issuing backup codes. */
  async enableTotp(
    userId: string,
    code: string,
  ): Promise<{ backupCodes: string[] }> {
    const method = await this.prisma.mfaMethod.findUnique({
      where: { userId_type: { userId, type: 'TOTP' } },
    });
    if (!method?.secretEncrypted) {
      throw new BadRequestException(
        'TOTP setup has not been started for this account',
      );
    }

    const secret = decrypt(
      method.secretEncrypted,
      this.config.get('MFA_ENCRYPTION_KEY', { infer: true }),
    );
    const valid = authenticator.check(code, secret);
    if (!valid) {
      throw new BadRequestException('Invalid TOTP code');
    }

    const backupCodes = Array.from({ length: BACKUP_CODE_COUNT }, () =>
      generateBackupCode(),
    );
    const backupCodeHashes = backupCodes.map((c) => sha256Hex(c));

    await this.prisma.$transaction([
      this.prisma.mfaMethod.update({
        where: { userId_type: { userId, type: 'TOTP' } },
        data: { enabled: true },
      }),
      this.prisma.mfaMethod.upsert({
        where: { userId_type: { userId, type: 'BACKUP_CODES' } },
        create: {
          userId,
          type: 'BACKUP_CODES',
          backupCodeHashes,
          enabled: true,
        },
        update: { backupCodeHashes, enabled: true },
      }),
    ]);

    // Backup codes are returned exactly once, at generation time — they are
    // never retrievable again, only re-generatable (invalidating the old set).
    return { backupCodes };
  }

  async isMfaEnabled(userId: string): Promise<boolean> {
    const method = await this.prisma.mfaMethod.findUnique({
      where: { userId_type: { userId, type: 'TOTP' } },
    });
    return method?.enabled ?? false;
  }

  async verifyCode(userId: string, code: string): Promise<boolean> {
    const totp = await this.prisma.mfaMethod.findUnique({
      where: { userId_type: { userId, type: 'TOTP' } },
    });
    if (totp?.enabled && totp.secretEncrypted) {
      const secret = decrypt(
        totp.secretEncrypted,
        this.config.get('MFA_ENCRYPTION_KEY', { infer: true }),
      );
      const step = currentTotpStep();
      // Gap-audit fix: a bare authenticator.check() is stateless — the
      // identical code remains valid for the rest of its ~30s step no
      // matter how many times it's presented. Rejecting a step this
      // method has already consumed closes that replay window with the
      // same one-time-use discipline backup codes already had.
      if (step !== totp.lastConsumedStep && authenticator.check(code, secret)) {
        await this.prisma.mfaMethod.update({
          where: { userId_type: { userId, type: 'TOTP' } },
          data: { lastConsumedStep: step },
        });
        return true;
      }
    }

    return this.verifyAndConsumeBackupCode(userId, code);
  }

  private async verifyAndConsumeBackupCode(
    userId: string,
    code: string,
  ): Promise<boolean> {
    const backupMethod = await this.prisma.mfaMethod.findUnique({
      where: { userId_type: { userId, type: 'BACKUP_CODES' } },
    });
    if (!backupMethod?.enabled) {
      return false;
    }

    const codeHash = sha256Hex(code.toUpperCase());
    const remaining = backupMethod.backupCodeHashes.filter(
      (h) => h !== codeHash,
    );
    if (remaining.length === backupMethod.backupCodeHashes.length) {
      return false; // code not found — not consumed
    }

    // One-time use: the matched code is removed from the pool immediately.
    await this.prisma.mfaMethod.update({
      where: { userId_type: { userId, type: 'BACKUP_CODES' } },
      data: { backupCodeHashes: remaining },
    });
    return true;
  }
}
