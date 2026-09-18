import {
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { PrismaClient } from '@bpfmps/database';

/**
 * Thin NestJS lifecycle wrapper around the shared Prisma client from
 * `@bpfmps/database`. Business modules inject this service rather than
 * instantiating PrismaClient themselves, keeping database access behind one
 * injectable boundary (see ARCHITECTURE.md § Layered Architecture).
 */
@Injectable()
export class PrismaService
  extends PrismaClient
  implements OnModuleInit, OnModuleDestroy
{
  private readonly logger = new Logger(PrismaService.name);

  async onModuleInit(): Promise<void> {
    await this.$connect();
    this.logger.log('Database connection established');
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
