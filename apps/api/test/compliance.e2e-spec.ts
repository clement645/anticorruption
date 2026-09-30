import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';

interface ComplianceRuleBody {
  id: string;
  title: string;
  citation: string;
  enforcement: string;
  enforcedBy: string;
}

/**
 * The legal & policy integration layer's citable rule registry (post-launch
 * feature) — public and unauthenticated by design, since the entire point is
 * that anyone (citizen, journalist, oversight body) can see which specific
 * legal provisions this system's controls implement without needing an
 * account. See apps/api/src/modules/compliance/compliance-rules.ts for the
 * rules themselves and SECURITY.md § Legal & Policy Integration for why each
 * citation is either a real, verified reference or explicitly marked as not
 * hard-enforced.
 */
describe('Compliance Rule Registry (e2e)', () => {
  let app: INestApplication<App>;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();
  });

  afterAll(async () => {
    await app.close();
  });

  it('returns the rule registry without requiring authentication', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/compliance/rules')
      .expect(200);

    const rules = response.body as ComplianceRuleBody[];
    expect(Array.isArray(rules)).toBe(true);
    expect(rules.length).toBeGreaterThan(0);
  });

  it('every rule carries a citation, a stated enforcement type, and an enforcedBy pointer', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/compliance/rules')
      .expect(200);

    const rules = response.body as ComplianceRuleBody[];
    for (const rule of rules) {
      expect(rule.id).toEqual(expect.any(String));
      expect(rule.citation.length).toBeGreaterThan(0);
      expect([
        'preventive',
        'detective',
        'design-principle',
        'transparency',
      ]).toContain(rule.enforcement);
      expect(rule.enforcedBy.length).toBeGreaterThan(0);
    }
  });

  it('includes the no-contract-splitting rule with a real preventive enforcement pointer', async () => {
    const response = await request(app.getHttpServer())
      .get('/api/v1/compliance/rules')
      .expect(200);

    const rules = response.body as ComplianceRuleBody[];
    const splitRule = rules.find((r) => r.id === 'no-contract-splitting');
    expect(splitRule).toBeDefined();
    expect(splitRule!.enforcement).toBe('preventive');
    expect(splitRule!.citation).toContain('Regulation 43');
  });
});
