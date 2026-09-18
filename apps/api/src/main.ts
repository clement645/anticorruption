import helmet from 'helmet';
import cookieParser from 'cookie-parser';
import { json } from 'express';
import { ValidationPipe } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger, LoggerErrorInterceptor } from 'nestjs-pino';
import { AppModule } from './app.module';
import type { EnvConfig } from './config/env.validation';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, { bufferLogs: true });

  const config = app.get(ConfigService<EnvConfig, true>);

  app.useLogger(app.get(Logger));
  app.useGlobalInterceptors(new LoggerErrorInterceptor());

  app.use(helmet());
  app.use(cookieParser());
  // Express/body-parser's own default JSON limit (100kb) is fine for this
  // API's ordinary DTOs but would silently break every base64-file-upload
  // endpoint (Phases 7/10/13's evidence/document uploads) — a real photo or
  // PDF, base64-encoded, routinely exceeds 100kb. Found via Phase 14's own
  // hardening pass: an oversized upload wasn't just rejected, it fell
  // through to a raw 500 (see AllExceptionsFilter's fix for the other half
  // of this). 15mb is a considered ceiling, not the framework default —
  // generous enough for a real compliance document or inspection photo,
  // still bounded against abuse.
  app.use(json({ limit: '15mb' }));

  app.enableCors({
    origin: config
      .get('CORS_ORIGIN', { infer: true })
      .split(',')
      .map((o) => o.trim()),
    credentials: true,
  });

  // Versioned via a literal prefix (e.g. "api/v1") rather than Nest's per-route
  // @Version() mechanism — simpler for a modular monolith where the whole API
  // moves to v2 together rather than route-by-route. See API.md § Versioning.
  app.setGlobalPrefix(config.get('API_PREFIX', { infer: true }));

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  if (config.get('NODE_ENV', { infer: true }) !== 'production') {
    const swaggerConfig = new DocumentBuilder()
      .setTitle('B-PFMPS API')
      .setDescription(
        'Blockchain-Based Integrated Public Financial Management & Procurement System',
      )
      .setVersion('1.0')
      .build();
    const document = SwaggerModule.createDocument(app, swaggerConfig);
    SwaggerModule.setup('api/docs', app, document);
  }

  const port = config.get('PORT', { infer: true });
  await app.listen(port);
}

void bootstrap();
