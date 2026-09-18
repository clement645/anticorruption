import { SetMetadata } from '@nestjs/common';

export const PERMISSIONS_KEY = 'permissions';

/**
 * Declares the permission(s) required to call this route, as "resource:action"
 * strings (e.g. "users:create"). All listed permissions are required (AND).
 * Every protected endpoint must declare what it needs explicitly — there is no
 * implicit "authenticated users can access everything" (section 4/29).
 */
export const RequirePermissions = (...permissions: string[]) =>
  SetMetadata(PERMISSIONS_KEY, permissions);
