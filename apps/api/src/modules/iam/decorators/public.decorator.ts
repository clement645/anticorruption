import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'isPublic';

/**
 * Marks a route as not requiring authentication. The JWT guard is registered
 * globally (fail closed — everything requires auth unless explicitly opted
 * out here), per Zero Trust (ARCHITECTURE.md § Guiding Principles).
 */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
