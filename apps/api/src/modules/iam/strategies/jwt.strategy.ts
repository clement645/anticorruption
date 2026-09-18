import { Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PassportStrategy } from '@nestjs/passport';
import { ExtractJwt, Strategy } from 'passport-jwt';
import type { EnvConfig } from '../../../config/env.validation';
import type { JwtPayload, AuthenticatedUser } from '../types/jwt-payload.type';

@Injectable()
export class JwtStrategy extends PassportStrategy(Strategy) {
  constructor(config: ConfigService<EnvConfig, true>) {
    super({
      jwtFromRequest: ExtractJwt.fromAuthHeaderAsBearerToken(),
      ignoreExpiration: false,
      secretOrKey: config.get('JWT_SECRET', { infer: true }),
    });
  }

  // Whatever is returned here becomes `request.user`. Nothing here queries the
  // database — the access token is trusted as-is for its short lifetime (see
  // types/jwt-payload.type.ts). Revocation is enforced via the refresh flow,
  // not per-request.
  validate(payload: JwtPayload): AuthenticatedUser {
    return payload;
  }
}
