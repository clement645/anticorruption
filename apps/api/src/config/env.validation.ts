import { z } from 'zod';

/**
 * Strict environment schema. The application fails to boot (fail closed) if a
 * required variable is missing or malformed, rather than starting with an unsafe
 * default. See SECURITY.md and THREAT_MODEL.md (Phase 1).
 */
export const envSchema = z.object({
  NODE_ENV: z
    .enum(['development', 'test', 'staging', 'production'])
    .default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  API_PREFIX: z.string().min(1).default('api/v1'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DIRECT_DATABASE_URL: z.string().optional(),

  CORS_ORIGIN: z.string().min(1).default('http://localhost:5173'),

  RATE_LIMIT_TTL: z.coerce.number().int().positive().default(60),
  RATE_LIMIT_MAX: z.coerce.number().int().positive().default(100),

  LOG_LEVEL: z
    .enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace'])
    .default('info'),

  // IAM / authentication (Phase 2)
  JWT_SECRET: z
    .string()
    .min(
      32,
      'JWT_SECRET must be at least 32 characters — generate with: openssl rand -base64 64',
    ),
  JWT_ACCESS_TOKEN_TTL_SECONDS: z.coerce.number().int().positive().default(900),
  REFRESH_TOKEN_TTL_DAYS: z.coerce.number().int().positive().default(7),
  ACCOUNT_LOCKOUT_THRESHOLD: z.coerce.number().int().positive().default(5),
  ACCOUNT_LOCKOUT_DURATION_MINUTES: z.coerce
    .number()
    .int()
    .positive()
    .default(15),
  MFA_ENCRYPTION_KEY: z
    .string()
    .min(
      32,
      'MFA_ENCRYPTION_KEY must be at least 32 characters — generate with: openssl rand -base64 32',
    ),

  // Immutable audit chain signing (Phase 3) — base64-encoded PEM. See
  // DEPLOYMENT.md for how to generate a keypair.
  AUDIT_SIGNING_PRIVATE_KEY: z
    .string()
    .min(1, 'AUDIT_SIGNING_PRIVATE_KEY is required (base64-encoded PKCS8 PEM)'),
  AUDIT_SIGNING_PUBLIC_KEY: z
    .string()
    .min(1, 'AUDIT_SIGNING_PUBLIC_KEY is required (base64-encoded SPKI PEM)'),
  AUDIT_SIGNING_KEY_ID: z.string().min(1).default('audit-key-1'),

  // Blockchain integrity layer (Phase 4)
  BLOCKCHAIN_ADAPTER: z.enum(['development']).default('development'),
  BLOCKCHAIN_ANCHOR_INTERVAL_SECONDS: z.coerce
    .number()
    .int()
    .positive()
    .default(60),
  BLOCKCHAIN_ANCHOR_BATCH_SIZE: z.coerce.number().int().positive().default(100),

  // AI Risk Engine (Phase 8) — split-procurement detector thresholds.
  // Deliberately configurable (not a hardcoded algorithm constant): what
  // counts as "high value enough to warrant scrutiny" is a jurisdiction/
  // deployment policy decision, not a statistical parameter.
  RISK_SPLIT_PROCUREMENT_THRESHOLD: z.coerce
    .number()
    .positive()
    .default(1_000_000),
  RISK_SPLIT_PROCUREMENT_WINDOW_DAYS: z.coerce
    .number()
    .int()
    .positive()
    .default(30),
  RISK_SPLIT_PROCUREMENT_MIN_COUNT: z.coerce
    .number()
    .int()
    .positive()
    .default(3),

  // Evidence vault / object storage (Phase 10). ARCHITECTURE.md § 7 always
  // described "large documents live in encrypted object storage, only their
  // hash is anchored on-chain" — this is the first phase that actually
  // stores bytes rather than only a hash of them (see schema.prisma comment
  // on ProjectEvidence). OBJECT_STORAGE_ADAPTER mirrors BLOCKCHAIN_ADAPTER's
  // shape: one real local implementation today, reserved for a future
  // 's3' value without any caller changing (see packages/storage).
  OBJECT_STORAGE_ADAPTER: z.enum(['filesystem']).default('filesystem'),
  EVIDENCE_STORAGE_PATH: z.string().min(1).default('./storage/evidence'),
  EVIDENCE_ENCRYPTION_KEY: z
    .string()
    .min(
      32,
      'EVIDENCE_ENCRYPTION_KEY must be at least 32 characters — generate with: openssl rand -base64 32',
    ),
  // A dedicated key for the one genuinely identifying field the Whistleblower
  // Portal (Phase 13) can ever hold — an optional reporter contact — kept
  // deliberately separate from EVIDENCE_ENCRYPTION_KEY/MFA_ENCRYPTION_KEY
  // (key separation per purpose, not reuse for convenience).
  WHISTLEBLOWER_CONTACT_ENCRYPTION_KEY: z
    .string()
    .min(
      32,
      'WHISTLEBLOWER_CONTACT_ENCRYPTION_KEY must be at least 32 characters — generate with: openssl rand -base64 32',
    ),
});

export type EnvConfig = z.infer<typeof envSchema>;

export function validateEnv(config: Record<string, unknown>): EnvConfig {
  const result = envSchema.safeParse(config);
  if (!result.success) {
    const issues = result.error.issues
      .map((issue) => `  - ${issue.path.join('.')}: ${issue.message}`)
      .join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return result.data;
}
