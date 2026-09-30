import {
  BadRequestException,
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { REQUIRE_SIGNATURE_KEY } from '../decorators/require-signature.decorator';
import { IdentityService } from '../services/identity.service';
import { AuditService } from '../../audit/audit.service';
import type { AuthenticatedUser } from '../types/jwt-payload.type';

// Signatures older than this can no longer be used — bounds how long a
// captured (signature, timestamp, nonce) triple remains replayable if an
// attacker somehow obtained one before the nonce was consumed.
const SIGNATURE_WINDOW_MS = 5 * 60_000;

interface SignatureFields {
  signature?: unknown;
  signatureTimestamp?: unknown;
  signatureNonce?: unknown;
}

/**
 * Enforces @RequireSignature() routes: the caller must prove, with a
 * signature only THEY could produce (their own Ed25519 private key, never
 * seen by this server — see DigitalIdentity), that they specifically
 * authorized this exact request. What gets signed is deliberately narrow and
 * deterministic — `${METHOD} ${path} ${timestamp} ${nonce}` — so the client
 * can compute it without needing to canonicalize a request body.
 *
 * Runs after JwtAuthGuard/PermissionsGuard (request.user is already set).
 * On success, stashes `{ signature, keyId }` on the request as
 * `verifiedSignature` so the controller can pass it through to
 * AuditService.append() as actorSignature/actorKeyId.
 */
@Injectable()
export class SignatureGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly identityService: IdentityService,
    private readonly auditService: AuditService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const required = this.reflector.getAllAndOverride<boolean>(
      REQUIRE_SIGNATURE_KEY,
      [context.getHandler(), context.getClass()],
    );
    if (!required) {
      return true;
    }

    const request = context.switchToHttp().getRequest<
      Request & {
        user?: AuthenticatedUser;
        verifiedSignature?: {
          signature: string;
          keyId: string;
          signedPayload: string;
        };
      }
    >();
    const user = request.user;
    if (!user) {
      throw new ForbiddenException('Authentication required');
    }

    const { signature, signatureTimestamp, signatureNonce }: SignatureFields =
      (request.body as SignatureFields | undefined) ?? {};
    if (
      typeof signature !== 'string' ||
      typeof signatureTimestamp !== 'string' ||
      typeof signatureNonce !== 'string' ||
      !signature ||
      !signatureTimestamp ||
      !signatureNonce
    ) {
      throw new BadRequestException(
        'This action requires a digital signature: signature, signatureTimestamp, signatureNonce',
      );
    }

    const signedAt = Date.parse(signatureTimestamp);
    if (
      !Number.isFinite(signedAt) ||
      Math.abs(Date.now() - signedAt) > SIGNATURE_WINDOW_MS
    ) {
      throw new BadRequestException(
        'signatureTimestamp is missing, malformed, or outside the 5-minute signing window',
      );
    }

    const path = request.originalUrl.split('?')[0];
    const canonicalPayload = `${request.method} ${path} ${signatureTimestamp} ${signatureNonce}`;

    const result = await this.identityService.verifyAndConsumeNonce(
      user.sub,
      canonicalPayload,
      signature,
      signatureNonce,
    );

    if (!result.valid) {
      await this.auditService
        .append({
          eventType: 'SIGNATURE_VERIFICATION_FAILED',
          actorId: user.sub,
          actorEmail: user.email,
          organizationId: user.organizationId ?? undefined,
          resourceType: context.getClass().name,
          action: context.getHandler().name,
          payload: { path, reason: result.reason },
          ipAddress: request.ip,
          userAgent: request.headers['user-agent'],
        })
        .catch(() => undefined);
      throw new ForbiddenException(
        result.reason ?? 'Invalid digital signature',
      );
    }

    request.verifiedSignature = {
      signature,
      keyId: result.keyId!,
      signedPayload: canonicalPayload,
    };
    return true;
  }
}
