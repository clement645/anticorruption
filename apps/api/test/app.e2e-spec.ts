import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication } from '@nestjs/common';
import { json } from 'express';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import type {
  LivenessResult,
  ReadinessResult,
} from '../src/modules/health/health.service';

describe('Health (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    // A deliberately small limit (not main.ts's real 15mb) so this test can
    // reproduce "payload too large" fast and deterministically without
    // sending megabytes of data.
    app.use(json({ limit: '10kb' }));
    await app.init();
  });

  it('GET /api/v1/health returns liveness status', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/health')
      .expect(200);
    const body = response.body as LivenessResult;
    expect(body).toMatchObject({ status: 'ok' });
    expect(typeof body.timestamp).toBe('string');
    expect(typeof body.uptimeSeconds).toBe('number');
  });

  it('GET /api/v1/health/ready returns readiness with a working database', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/health/ready')
      .expect(200);
    const body = response.body as ReadinessResult;
    expect(body).toMatchObject({
      status: 'ok',
      checks: { database: 'ok' },
    });
  });

  /**
   * Regression test for a real Phase 14 hardening finding: a request body
   * exceeding the configured JSON size limit is thrown by body-parser/
   * raw-body as a plain `Error` carrying `status: 413` (the `http-errors`
   * package convention every Express middleware uses) — not a NestJS
   * `HttpException`. Before this fix, `AllExceptionsFilter`'s catch-all
   * branch treated it as a fully unknown error and returned a generic,
   * unhelpful `500` instead of the correct `413`. Exercised here against a
   * real `@Public()` route (no auth complexity needed) rather than a unit
   * test of the filter in isolation, since the actual bug was in how the
   * whole pipeline — Express middleware error -> Nest's exception handling
   * -> this filter — behaves together.
   */
  it('returns a proper 413 (not a raw 500) for a request body over the configured limit, and still accepts one within it', async () => {
    const over = await request(app.getHttpServer())
      .post('/api/v1/public/whistleblower/reports')
      .send({
        category: 'OTHER',
        description: 'x'.repeat(20_000),
      })
      .expect(413);
    expect(over.body).toMatchObject({
      statusCode: 413,
      error: 'PAYLOAD_TOO_LARGE',
    });
    const overBody = over.body as { message: unknown };
    expect(typeof overBody.message).toBe('string');

    await request(app.getHttpServer())
      .post('/api/v1/public/whistleblower/reports')
      .send({
        category: 'OTHER',
        description: 'A small, well-within-limit report body.',
      })
      .expect(201);
  });

  afterAll(async () => {
    await app.close();
  });
});
