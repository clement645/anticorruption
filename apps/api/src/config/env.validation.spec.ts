import { validateEnv } from './env.validation';

describe('validateEnv', () => {
  const validBaseEnv = {
    DATABASE_URL: 'postgresql://user:pass@localhost:5432/db',
    JWT_SECRET: 'a'.repeat(32),
    MFA_ENCRYPTION_KEY: 'b'.repeat(32),
    AUDIT_SIGNING_PRIVATE_KEY: 'c'.repeat(32),
    AUDIT_SIGNING_PUBLIC_KEY: 'd'.repeat(32),
  };

  it('accepts a minimal valid configuration and applies defaults', () => {
    const result = validateEnv(validBaseEnv);
    expect(result.NODE_ENV).toBe('development');
    expect(result.PORT).toBe(3000);
    expect(result.API_PREFIX).toBe('api/v1');
  });

  it('fails closed when DATABASE_URL is missing', () => {
    expect(() => validateEnv({})).toThrow(/DATABASE_URL/);
  });

  it('fails closed on an invalid NODE_ENV value', () => {
    expect(() =>
      validateEnv({ ...validBaseEnv, NODE_ENV: 'production-ish' }),
    ).toThrow();
  });

  it('coerces numeric string env vars to numbers', () => {
    const result = validateEnv({ ...validBaseEnv, PORT: '4000' });
    expect(result.PORT).toBe(4000);
  });

  it('fails closed when JWT_SECRET is too short', () => {
    expect(() =>
      validateEnv({ ...validBaseEnv, JWT_SECRET: 'too-short' }),
    ).toThrow(/JWT_SECRET/);
  });
});
