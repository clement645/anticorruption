import { Injectable, Logger } from '@nestjs/common';
import { PrismaService } from '../../prisma/prisma.service';

export interface LivenessResult {
  status: 'ok';
  timestamp: string;
  uptimeSeconds: number;
}

export interface ReadinessResult {
  status: 'ok' | 'error';
  checks: {
    database: 'ok' | 'error';
  };
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(private readonly prisma: PrismaService) {}

  getLiveness(): LivenessResult {
    return {
      status: 'ok',
      timestamp: new Date().toISOString(),
      uptimeSeconds: Math.round(process.uptime()),
    };
  }

  async getReadiness(): Promise<ReadinessResult> {
    try {
      await this.prisma.$queryRaw`SELECT 1`;
      return { status: 'ok', checks: { database: 'ok' } };
    } catch (error) {
      // Log full detail internally; never surface connection strings or
      // internal error detail to the caller (section 30).
      this.logger.error('Readiness check failed: database unreachable', error);
      return { status: 'error', checks: { database: 'error' } };
    }
  }
}
