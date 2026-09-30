import { SetMetadata } from '@nestjs/common';

export const REQUIRE_SIGNATURE_KEY = 'requireSignature';

/**
 * Declares that this route requires a genuine per-official digital signature
 * (section 6/1: "individual accountability", "no illegal action without a
 * cryptographic trace back to a real person") in addition to the ordinary
 * @RequirePermissions() authorization check. The request body must include
 * `signature`, `signatureTimestamp`, and `signatureNonce` — see
 * SignatureGuard for exactly what gets signed and how it's verified.
 */
export const RequireSignature = () => SetMetadata(REQUIRE_SIGNATURE_KEY, true);
