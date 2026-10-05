import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import { generateOpaqueToken, sha256Hex } from '@bpfmps/crypto';
import { PrismaService } from '../../../prisma/prisma.service';
import type { EnvConfig } from '../../../config/env.validation';
import type { JwtPayload } from '../types/jwt-payload.type';

export interface IssuedTokens {
  accessToken: string;
  refreshToken: string;
  refreshTokenExpiresAt: Date;
  sessionId: string;
}

export type RefreshOutcome =
  | { outcome: 'rotated'; tokens: IssuedTokens; userId: string }
  | { outcome: 'invalid' }
  | { outcome: 'reused'; userId: string };

@Injectable()
export class TokenService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<EnvConfig, true>,
    private readonly prisma: PrismaService,
  ) {}

  signAccessToken(payload: JwtPayload): string {
    return this.jwt.sign(payload, {
      expiresIn: this.config.get('JWT_ACCESS_TOKEN_TTL_SECONDS', {
        infer: true,
      }),
    });
  }

  /** Creates a brand-new session (first login, not a rotation). */
  async issueSession(
    payload: JwtPayload,
    meta: { ipAddress?: string; userAgent?: string; deviceId?: string },
  ): Promise<IssuedTokens> {
    const refreshToken = generateOpaqueToken();
    const refreshTokenExpiresAt = this.refreshExpiry();

    const session = await this.prisma.session.create({
      data: {
        userId: payload.sub,
        refreshTokenHash: sha256Hex(refreshToken),
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        deviceId: meta.deviceId,
        expiresAt: refreshTokenExpiresAt,
      },
    });

    return {
      accessToken: this.signAccessToken(payload),
      refreshToken,
      refreshTokenExpiresAt,
      sessionId: session.id,
    };
  }

  /**
   * Rotates a refresh token. Reuse detection: if the presented token maps to a
   * session that has *already* been rotated (rotatedToId is set) or revoked,
   * this is treated as a stolen/replayed token — the whole chain is revoked
   * and the caller must re-authenticate (see SECURITY.md § Identity &
   * Authentication).
   */
  async rotate(
    presentedRefreshToken: string,
    payloadForUser: (userId: string) => Promise<JwtPayload>,
    meta: { ipAddress?: string; userAgent?: string },
  ): Promise<RefreshOutcome> {
    const presentedHash = sha256Hex(presentedRefreshToken);
    const session = await this.prisma.session.findUnique({
      where: { refreshTokenHash: presentedHash },
    });

    if (!session) {
      return { outcome: 'invalid' };
    }

    if (
      session.revokedAt ||
      session.rotatedToId ||
      session.expiresAt <= new Date()
    ) {
      // Reused or expired token. If it was already rotated/revoked, this is a
      // replay — nuke every session for the user as a precaution.
      if (session.rotatedToId || session.revokedAt) {
        await this.revokeAllSessionsForUser(
          session.userId,
          'token_reuse_detected',
        );
        return { outcome: 'reused', userId: session.userId };
      }
      return { outcome: 'invalid' };
    }

    const payload = await payloadForUser(session.userId);
    const refreshToken = generateOpaqueToken();
    const refreshTokenExpiresAt = this.refreshExpiry();

    const newSession = await this.prisma.session.create({
      data: {
        userId: session.userId,
        refreshTokenHash: sha256Hex(refreshToken),
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        deviceId: session.deviceId,
        expiresAt: refreshTokenExpiresAt,
      },
    });

    // F-004: the read at the top of this method is not, by itself, enough
    // to stop a genuine concurrent replay of the same still-valid token
    // from rotating twice — two racing calls can both observe
    // `rotatedToId: null` before either write below lands, mint two
    // distinct child sessions, and both successfully overwrite the same
    // parent row (each setting its own, individually-valid `rotatedToId`
    // — no unique-constraint conflict occurs, so the naive `update()` this
    // replaced never caught it). The actual arbitration is this
    // conditional `updateMany`: its WHERE clause re-checks
    // `rotatedToId`/`revokedAt` against the row's CURRENT state at write
    // time, not the possibly-stale state read above, and Postgres's own
    // row-level locking guarantees only one of two concurrent such updates
    // can ever match. The loser's `count` comes back 0 below.
    const { count } = await this.prisma.session.updateMany({
      where: { id: session.id, rotatedToId: null, revokedAt: null },
      data: {
        revokedAt: new Date(),
        revokedReason: 'rotated',
        rotatedToId: newSession.id,
      },
    });

    if (count === 0) {
      // Lost the race: some other call already rotated this exact token
      // between our read above and this write. The child session just
      // created must not be left live, and this is treated exactly like
      // any other reuse — the whole chain is revoked as a precaution,
      // same as the `rotatedToId`/`revokedAt` branch earlier in this
      // method.
      await this.prisma.session.delete({ where: { id: newSession.id } });
      await this.revokeAllSessionsForUser(
        session.userId,
        'token_reuse_detected',
      );
      return { outcome: 'reused', userId: session.userId };
    }

    return {
      outcome: 'rotated',
      userId: session.userId,
      tokens: {
        accessToken: this.signAccessToken(payload),
        refreshToken,
        refreshTokenExpiresAt,
        sessionId: newSession.id,
      },
    };
  }

  async revoke(presentedRefreshToken: string): Promise<void> {
    const hash = sha256Hex(presentedRefreshToken);
    await this.prisma.session.updateMany({
      where: { refreshTokenHash: hash, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: 'logout' },
    });
  }

  async revokeAllSessionsForUser(
    userId: string,
    reason: string,
  ): Promise<void> {
    await this.prisma.session.updateMany({
      where: { userId, revokedAt: null },
      data: { revokedAt: new Date(), revokedReason: reason },
    });
  }

  private refreshExpiry(): Date {
    const days = this.config.get('REFRESH_TOKEN_TTL_DAYS', { infer: true });
    return new Date(Date.now() + days * 24 * 60 * 60 * 1000);
  }
}
