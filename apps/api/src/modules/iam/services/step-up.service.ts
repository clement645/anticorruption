import { ForbiddenException, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtService } from '@nestjs/jwt';
import type { EnvConfig } from '../../../config/env.validation';
import { MfaService } from './mfa.service';

export interface StepUpPayload {
  sub: string;
  purpose: 'step_up';
}

/**
 * Step-up MFA (post-launch): a fresh, one-time MFA challenge for a handful of
 * genuinely high-stakes actions (currently: executing a payment, changing
 * another user's role/status), on top of whatever authenticated an
 * already-valid access token. Defends against the scenario the login-time-only
 * MFA of Phase 2 does not: a hijacked/stolen access token being used, within
 * its own short lifetime, to perform the single most consequential actions in
 * the system — those still require the MFA device, even mid-session.
 *
 * Deliberately a short-lived "elevated session" token (10 minutes by
 * default), not a per-request signature like the digital-signature feature
 * (item 1) — the two solve different problems. A signature proves WHO
 * authorized one specific request, non-repudiably, forever. A step-up token
 * proves the holder had the MFA device recently, for a bounded window —
 * requiring a fresh 6-digit code (which cannot be reused within the same
 * 30-second period anyway) on every single request in a batch of several
 * sensitive actions would be unusable, not more secure.
 */
@Injectable()
export class StepUpService {
  constructor(
    private readonly jwt: JwtService,
    private readonly config: ConfigService<EnvConfig, true>,
    private readonly mfaService: MfaService,
  ) {}

  /** Verifies a fresh TOTP/backup code and, on success, issues a short-lived step-up token. */
  async verifyAndIssue(
    userId: string,
    code: string,
  ): Promise<{ stepUpToken: string; expiresIn: number }> {
    const mfaEnabled = await this.mfaService.isMfaEnabled(userId);
    if (!mfaEnabled) {
      // Deliberate: an account without MFA enrolled cannot step up at all,
      // and therefore can never perform a @RequireStepUp() action. This is
      // a forcing function, not an oversight — accounts holding permissions
      // sensitive enough to need step-up should have MFA enrolled anyway.
      throw new ForbiddenException(
        'MFA must be enabled on this account before it can perform this action — see POST /users/me/mfa/totp/setup',
      );
    }

    const valid = await this.mfaService.verifyCode(userId, code);
    if (!valid) {
      throw new ForbiddenException('Invalid MFA code');
    }

    const expiresIn = this.config.get('STEP_UP_TOKEN_TTL_SECONDS', {
      infer: true,
    });
    const payload: StepUpPayload = { sub: userId, purpose: 'step_up' };
    const stepUpToken = this.jwt.sign(payload, {
      secret: this.config.get('STEP_UP_TOKEN_SECRET', { infer: true }),
      expiresIn,
    });
    return { stepUpToken, expiresIn };
  }

  /** Returns the verified user id if `token` is a valid, unexpired step-up assertion for them, else null. */
  verify(token: string, expectedUserId: string): boolean {
    try {
      const payload = this.jwt.verify<StepUpPayload>(token, {
        secret: this.config.get('STEP_UP_TOKEN_SECRET', { infer: true }),
      });
      return payload.purpose === 'step_up' && payload.sub === expectedUserId;
    } catch {
      return false;
    }
  }
}
