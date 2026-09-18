/**
 * Access token payload. Roles/permissions are embedded so most authorization
 * checks are stateless within the token's short lifetime (default 15m). Role
 * changes take effect on the next token refresh, not instantly — an accepted
 * trade-off documented in SECURITY.md § Authorization.
 */
export interface JwtPayload {
  sub: string; // user id
  email: string;
  roles: string[];
  permissions: string[]; // "resource:action" strings
  organizationId: string | null;
  departmentId: string | null;
}

export type AuthenticatedUser = JwtPayload;
