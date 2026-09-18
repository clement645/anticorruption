import { BadRequestException, Injectable } from '@nestjs/common';
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

@Injectable()
export class MfaService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly config: ConfigService<EnvConfig, true>,
  ) {}

  /** Generates a new TOTP secret and stores it encrypted, not yet enabled. */
  async beginTotpSetup(userId: string, email: string) {
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
      if (authenticator.check(code, secret)) {
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
