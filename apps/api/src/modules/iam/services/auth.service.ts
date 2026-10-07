import {
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { JwtService } from '@nestjs/jwt';
import * as argon2 from 'argon2';
import { ConfigService } from '@nestjs/config';
import { UsersService } from './users.service';
import { TokenService, type IssuedTokens } from './token.service';
import { MfaService } from './mfa.service';
import { SecurityEventsService } from './security-events.service';
import type { EnvConfig } from '../../../config/env.validation';

interface RequestMeta {
  ipAddress?: string;
  userAgent?: string;
}

export type LoginResult =
  | { status: 'authenticated'; tokens: IssuedTokens }
  | { status: 'mfa_required'; mfaToken: string }
  | { status: 'password_change_required'; changeToken: string };

const MFA_TOKEN_PURPOSE = 'mfa_pending';
const MFA_TOKEN_TTL_SECONDS = 300;
const PASSWORD_CHANGE_PURPOSE = 'password_change';
const PASSWORD_CHANGE_TTL_SECONDS = 600;

@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);

  constructor(
    private readonly users: UsersService,
    private readonly tokens: TokenService,
    private readonly mfa: MfaService,
    private readonly securityEvents: SecurityEventsService,
    private readonly jwt: JwtService,
    private readonly config: ConfigService<EnvConfig, true>,
  ) {}

  async login(
    email: string,
    password: string,
    meta: RequestMeta,
  ): Promise<LoginResult> {
    const user = await this.users.findByEmailWithRoles(email);

    // Constant-shape response whether the account exists or not, to avoid
    // leaking account existence via response content (timing is not fully
    // equalized in this prototype — see THREAT_MODEL.md residual risk notes).
    if (!user) {
      await this.securityEvents.record({
        type: 'LOGIN_FAILURE',
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
        metadata: { email, reason: 'no_such_account' },
      });
      throw new UnauthorizedException('Invalid email or password');
    }

    if (
      user.status === 'LOCKED' &&
      user.lockedUntil &&
      user.lockedUntil > new Date()
    ) {
      await this.securityEvents.record({
        type: 'LOGIN_LOCKED_OUT',
        userId: user.id,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
      throw new ForbiddenException(
        'This account is temporarily locked due to repeated failed login attempts',
      );
    }

    if (user.status === 'SUSPENDED') {
      throw new ForbiddenException('This account has been suspended');
    }

    const passwordValid = await argon2
      .verify(user.passwordHash, password)
      .catch(() => false);
    if (!passwordValid) {
      const lockedOut = await this.users.recordFailedLogin(
        user.id,
        this.config.get('ACCOUNT_LOCKOUT_THRESHOLD', { infer: true }),
        this.config.get('ACCOUNT_LOCKOUT_DURATION_MINUTES', { infer: true }),
      );
      await this.securityEvents.record({
        type: lockedOut ? 'LOGIN_LOCKED_OUT' : 'LOGIN_FAILURE',
        userId: user.id,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
      throw new UnauthorizedException('Invalid email or password');
    }

    if (user.mustChangePassword) {
      const changeToken = this.jwt.sign(
        { sub: user.id, purpose: PASSWORD_CHANGE_PURPOSE },
        { expiresIn: PASSWORD_CHANGE_TTL_SECONDS },
      );
      return { status: 'password_change_required', changeToken };
    }

    const mfaEnabled = await this.mfa.isMfaEnabled(user.id);
    if (mfaEnabled) {
      const mfaToken = this.jwt.sign(
        { sub: user.id, purpose: MFA_TOKEN_PURPOSE },
        { expiresIn: MFA_TOKEN_TTL_SECONDS },
      );
      await this.securityEvents.record({
        type: 'MFA_CHALLENGE_ISSUED',
        userId: user.id,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
      return { status: 'mfa_required', mfaToken };
    }

    return {
      status: 'authenticated',
      tokens: await this.completeLogin(user.id, meta),
    };
  }

  async verifyMfaAndLogin(
    mfaToken: string,
    code: string,
    meta: RequestMeta,
  ): Promise<IssuedTokens> {
    const userId = this.verifyMfaToken(mfaToken);

    const valid = await this.mfa.verifyCode(userId, code);
    if (!valid) {
      await this.securityEvents.record({
        type: 'MFA_FAILED',
        userId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
      throw new UnauthorizedException('Invalid MFA code');
    }

    await this.securityEvents.record({
      type: 'MFA_VERIFIED',
      userId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return this.completeLogin(userId, meta);
  }

  async refresh(
    refreshToken: string,
    meta: RequestMeta,
  ): Promise<IssuedTokens> {
    const result = await this.tokens.rotate(
      refreshToken,
      async (userId) => {
        const user = await this.users.findByIdWithRoles(userId);
        if (!user) {
          throw new UnauthorizedException('Session is no longer valid');
        }
        return this.users.toJwtPayload(user);
      },
      meta,
    );

    if (result.outcome === 'invalid') {
      throw new UnauthorizedException('Invalid or expired refresh token');
    }

    if (result.outcome === 'reused') {
      await this.securityEvents.record({
        type: 'TOKEN_REUSE_DETECTED',
        userId: result.userId,
        ipAddress: meta.ipAddress,
        userAgent: meta.userAgent,
      });
      throw new UnauthorizedException('Session revoked — please sign in again');
    }

    await this.securityEvents.record({
      type: 'TOKEN_REFRESHED',
      userId: result.userId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });

    return result.tokens;
  }

  async logout(
    refreshToken: string | undefined,
    userId?: string,
  ): Promise<void> {
    if (refreshToken) {
      await this.tokens.revoke(refreshToken);
    }
    await this.securityEvents.record({ type: 'LOGOUT', userId });
  }

  private async completeLogin(
    userId: string,
    meta: RequestMeta,
  ): Promise<IssuedTokens> {
    const user = await this.users.findByIdWithRoles(userId);
    if (!user) {
      throw new UnauthorizedException('Account no longer exists');
    }
    await this.users.recordSuccessfulLogin(userId);
    await this.securityEvents.record({
      type: 'LOGIN_SUCCESS',
      userId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
    return this.tokens.issueSession(this.users.toJwtPayload(user), meta);
  }

  /**
   * Completes a forced password change. The change token is single-purpose and
   * short-lived; it grants nothing except this one operation. On success every
   * existing session is revoked, so the user signs in again with the new password.
   */
  async changeForcedPassword(
    changeToken: string,
    newPassword: string,
    meta: RequestMeta,
  ): Promise<void> {
    const userId = this.verifyPasswordChangeToken(changeToken);
    const user = await this.users.findByIdWithRoles(userId);
    if (!user || !user.mustChangePassword) {
      throw new UnauthorizedException('This password change is no longer required');
    }
    if (user.status === 'SUSPENDED') {
      throw new ForbiddenException('This account has been suspended');
    }

    await this.users.setPassword(userId, newPassword, { mustChangePassword: false });
    await this.tokens.revokeAllSessionsForUser(userId, 'password_changed');
    await this.securityEvents.record({
      type: 'PASSWORD_CHANGED',
      userId,
      ipAddress: meta.ipAddress,
      userAgent: meta.userAgent,
    });
  }

  private verifyPasswordChangeToken(changeToken: string): string {
    try {
      const payload = this.jwt.verify<{ sub: string; purpose: string }>(changeToken);
      if (payload.purpose !== PASSWORD_CHANGE_PURPOSE) {
        throw new Error('wrong purpose');
      }
      return payload.sub;
    } catch (error) {
      this.logger.warn('Rejected invalid or expired password change token', error);
      throw new UnauthorizedException('Your password change has expired — please sign in again');
    }
  }

  private verifyMfaToken(mfaToken: string): string {
    try {
      const payload = this.jwt.verify<{ sub: string; purpose: string }>(
        mfaToken,
      );
      if (payload.purpose !== MFA_TOKEN_PURPOSE) {
        throw new Error('wrong purpose');
      }
      return payload.sub;
    } catch (error) {
      this.logger.warn(
        'Rejected invalid or expired MFA challenge token',
        error,
      );
      throw new UnauthorizedException(
        'MFA challenge has expired — please sign in again',
      );
    }
  }
}
