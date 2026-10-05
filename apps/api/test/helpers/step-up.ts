import { authenticator } from 'otplib';
import request from 'supertest';
import { App } from 'supertest/types';

const TOTP_STEP_SECONDS = 30;

function currentTotpStep(): number {
  return Math.floor(Date.now() / 1000 / TOTP_STEP_SECONDS);
}

// Gap-audit fix: MfaService.verifyCode() now rejects a TOTP code whose
// 30-second step was already consumed for that user (closes a real replay
// window — see mfa.service.ts's own comment). Several e2e specs call this
// helper (or generate a code directly) more than once for the SAME secret
// in quick succession as fixture setup, which — now that a step can only
// ever be consumed once — can otherwise collide and get a correct, but
// test-breaking, 403. Tracked per secret (not per user id, which these
// helpers don't always have handy) since each test fixture's secret is
// effectively unique to one user/method already.
const lastUsedStepBySecret = new Map<string, number>();

export async function freshTotpCode(secret: string): Promise<string> {
  let step = currentTotpStep();
  while (lastUsedStepBySecret.get(secret) === step) {
    const msIntoStep = Date.now() % (TOTP_STEP_SECONDS * 1000);
    const msUntilNextStep = TOTP_STEP_SECONDS * 1000 - msIntoStep + 50;
    await new Promise((resolve) => setTimeout(resolve, msUntilNextStep));
    step = currentTotpStep();
  }
  lastUsedStepBySecret.set(secret, step);
  return authenticator.generate(secret);
}

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
    .send({ code: await freshTotpCode(secret) })
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
    .send({ code: await freshTotpCode(totpSecret) })
    .expect(200);
  return (res.body as { stepUpToken: string }).stepUpToken;
}
