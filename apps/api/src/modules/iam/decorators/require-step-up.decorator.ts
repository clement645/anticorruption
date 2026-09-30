import { SetMetadata } from '@nestjs/common';

export const REQUIRE_STEP_UP_KEY = 'requireStepUp';

/**
 * Declares that this route requires a fresh step-up MFA assertion, in
 * addition to the ordinary @RequirePermissions() check. The caller must
 * send a valid `X-Step-Up-Token` header, obtained from `POST /auth/step-up`
 * (fresh TOTP/backup code) within the last `STEP_UP_TOKEN_TTL_SECONDS`
 * (default 10 minutes). See StepUpGuard for the exact verification.
 */
export const RequireStepUp = () => SetMetadata(REQUIRE_STEP_UP_KEY, true);
