import { Injectable, Logger } from '@nestjs/common';
import type { Prisma } from '@bpfmps/database';
import { PrismaService } from '../../../prisma/prisma.service';

export type SecurityEventType =
  | 'LOGIN_SUCCESS'
  | 'LOGIN_FAILURE'
  | 'LOGIN_LOCKED_OUT'
  | 'MFA_CHALLENGE_ISSUED'
  | 'MFA_VERIFIED'
  | 'MFA_FAILED'
  | 'MFA_ENABLED'
  | 'TOKEN_REFRESHED'
  | 'TOKEN_REUSE_DETECTED'
  | 'LOGOUT'
  | 'USER_CREATED'
  | 'AUTHORIZATION_DENIED';

interface RecordEventInput {
  type: SecurityEventType;
  userId?: string;
  ipAddress?: string;
  userAgent?: string;
  metadata?: Prisma.InputJsonValue;
}

/**
 * Writes to the append-only security_events table. Nothing in this codebase
 * issues UPDATE/DELETE against this table (see DATABASE.md § Conventions) —
 * this service only ever inserts. Failures to log are swallowed (logged
 * locally) rather than allowed to break the calling auth flow, since a
 * logging outage must not become an authentication outage.
 */
@Injectable()
export class SecurityEventsService {
  private readonly logger = new Logger(SecurityEventsService.name);

  constructor(private readonly prisma: PrismaService) {}

  async record(input: RecordEventInput): Promise<void> {
    try {
      await this.prisma.securityEvent.create({
        data: {
          type: input.type,
          userId: input.userId,
          ipAddress: input.ipAddress,
          userAgent: input.userAgent,
          metadata: input.metadata ?? undefined,
        },
      });
    } catch (error) {
      this.logger.error(`Failed to record security event ${input.type}`, error);
    }
  }
}
