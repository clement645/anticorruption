import { authenticator } from 'otplib';
import request from 'supertest';
import { App } from 'supertest/types';

/**
 * Enrolls TOTP MFA for the given (already-authenticated) user and returns
 * the raw secret, so callers can generate fresh codes afterwards. Used by
 * every e2e spec that needs to call a @RequireStepUp() endpoint
 * (`payment-requests/:id/execute`, `PATCH users/:id`) as a fixture-setup
 * step, not just the spec that tests step-up itself — same reason
 * `helpers/signing.ts` exists for @RequireSignature().
 */
export async function enrollTotp(
  app: App,
  accessToken: string,
): Promise<string> {
  const setup = await request(app)
    .post('/api/v1/users/me/mfa/totp/setup')
    .set('Authorization', `Bearer ${accessToken}`)
    .expect(201);
  const secret = (setup.body as { secret: string }).secret;

  await request(app)
    .post('/api/v1/users/me/mfa/totp/enable')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ code: authenticator.generate(secret) })
    .expect(201);

  return secret;
}

/** Exchanges a fresh TOTP code for a step-up token via `POST /auth/step-up`. */
export async function issueStepUpToken(
  app: App,
  accessToken: string,
  totpSecret: string,
): Promise<string> {
  const res = await request(app)
    .post('/api/v1/auth/step-up')
    .set('Authorization', `Bearer ${accessToken}`)
    .send({ code: authenticator.generate(totpSecret) })
    .expect(200);
  return (res.body as { stepUpToken: string }).stepUpToken;
}
