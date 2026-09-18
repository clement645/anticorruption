import { validateEnv } from './env.validation';

/**
 * Registered as the `@nestjs/config` load function + validate hook. Centralizes
 * all environment access behind one typed object instead of scattering
 * `process.env.X` reads through the codebase.
 */
export function loadConfig() {
  return validateEnv(process.env);
}
