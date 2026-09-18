import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { LoggerModule } from 'nestjs-pino';
import { stdSerializers } from 'pino-http';
import { loadConfig } from './config/configuration';
import type { EnvConfig } from './config/env.validation';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';
import { PrismaModule } from './prisma/prisma.module';
import { HealthModule } from './modules/health/health.module';
import { IamModule } from './modules/iam/iam.module';
import { AuditModule } from './modules/audit/audit.module';
import { BlockchainModule } from './modules/blockchain/blockchain.module';
import { StorageModule } from './modules/storage/storage.module';
import { BudgetModule } from './modules/budget/budget.module';
import { ProcurementModule } from './modules/procurement/procurement.module';
import { SupplierModule } from './modules/supplier/supplier.module';
import { RiskModule } from './modules/risk/risk.module';
import { ContractsModule } from './modules/contracts/contracts.module';
import { ProjectsModule } from './modules/projects/projects.module';
import { TransparencyModule } from './modules/transparency/transparency.module';
import { WhistleblowerModule } from './modules/whistleblower/whistleblower.module';

@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [loadConfig],
      // Validation already happened inside loadConfig (fail closed on boot);
      // this cache avoids re-reading process.env on every ConfigService.get().
      cache: true,
    }),
    LoggerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvConfig, true>) => ({
        pinoHttp: {
          level: config.get('LOG_LEVEL', { infer: true }),
          transport:
            config.get('NODE_ENV', { infer: true }) === 'development'
              ? { target: 'pino-pretty', options: { singleLine: true } }
              : undefined,
          genReqId: (req: { headers: Record<string, unknown> }) =>
            (req.headers['x-request-id'] as string | undefined) ??
            crypto.randomUUID(),
          redact: ['req.headers.authorization', 'req.headers.cookie'],
          serializers: {
            // The Whistleblower Portal's public routes (Phase 13) exist
            // specifically to protect the caller's identity — the source IP
            // must not survive into ops-level request logs for these routes,
            // even though logging it is normal and expected everywhere else.
            //
            // pino-http always serializes the request once internally to
            // build the per-request child logger's `req` binding, BEFORE
            // this function ever runs — pino itself invokes this serializer
            // at log-write time against that already-serialized value, not
            // the raw request. So this reads/strips the standard serialized
            // shape (method/url/query/params/headers/remoteAddress/
            // remotePort) directly rather than calling pino-http's
            // `stdSerializers.req` a second time, which would receive an
            // object with no `.socket`/`.info` and silently produce nothing.
            req: (
              req: ReturnType<typeof stdSerializers.req>,
            ): ReturnType<typeof stdSerializers.req> => {
              if (!req.url?.startsWith('/api/v1/public/whistleblower')) {
                return req;
              }
              const rest: Record<string, unknown> = { ...req };
              delete rest.remoteAddress;
              delete rest.remotePort;
              return rest as unknown as ReturnType<typeof stdSerializers.req>;
            },
          },
        },
      }),
    }),
    ThrottlerModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (config: ConfigService<EnvConfig, true>) => ({
        throttlers: [
          {
            ttl: config.get('RATE_LIMIT_TTL', { infer: true }) * 1000,
            limit: config.get('RATE_LIMIT_MAX', { infer: true }),
          },
        ],
      }),
    }),
    PrismaModule,
    HealthModule,
    AuditModule,
    BlockchainModule,
    StorageModule,
    IamModule,
    BudgetModule,
    ProcurementModule,
    SupplierModule,
    RiskModule,
    ContractsModule,
    ProjectsModule,
    TransparencyModule,
    WhistleblowerModule,
  ],
  providers: [
    { provide: APP_FILTER, useClass: AllExceptionsFilter },
    { provide: APP_GUARD, useClass: ThrottlerGuard },
  ],
})
export class AppModule {}
