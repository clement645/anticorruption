import { defineStore } from 'pinia'
import { apiGet, apiPost, setAccessToken, setUnauthorizedHandler, ApiError } from '../api/client'

interface AuthenticatedUser {
  sub: string
  email: string
  roles: string[]
  permissions: string[]
  organizationId: string | null
  departmentId: string | null
}

interface LoginResponse {
  accessToken: string
  expiresIn: number
}

interface MfaRequiredResponse {
  mfaRequired: true
  mfaToken: string
}

interface PasswordChangeRequiredResponse {
  passwordChangeRequired: true
  changeToken: string
}

type LoginApiResponse = LoginResponse | MfaRequiredResponse | PasswordChangeRequiredResponse

function isMfaRequired(body: LoginApiResponse): body is MfaRequiredResponse {
  return 'mfaRequired' in body && body.mfaRequired === true
}

function isPasswordChangeRequired(body: LoginApiResponse): body is PasswordChangeRequiredResponse {
  return 'passwordChangeRequired' in body && body.passwordChangeRequired === true
}

interface AuthState {
  user: AuthenticatedUser | null
  status: 'unknown' | 'authenticated' | 'unauthenticated'
  pendingMfaToken: string | null
  pendingChangeToken: string | null
  error: string | null
  loading: boolean
}

export const useAuthStore = defineStore('auth', {
  state: (): AuthState => ({
    user: null,
    status: 'unknown',
    pendingMfaToken: null,
    pendingChangeToken: null,
    error: null,
    loading: false,
  }),
  getters: {
    isAuthenticated: (state) => state.status === 'authenticated',
    hasPermission: (state) => (permission: string) =>
      state.user?.permissions.includes(permission) ?? false,
  },
  actions: {
    /** Called once at app startup: tries to restore a session from the httpOnly refresh cookie. */
    async restoreSession() {
      try {
        const response = await apiPost<{ accessToken: string | null }>('/auth/refresh')
        if (!response.accessToken) {
          this.status = 'unauthenticated'
          return
        }
        setAccessToken(response.accessToken)
        await this.fetchMe()
        this.status = 'authenticated'
      } catch {
        this.status = 'unauthenticated'
      }
    },

    async login(
      email: string,
      password: string,
    ): Promise<'authenticated' | 'mfa_required' | 'password_change_required'> {
      this.loading = true
      this.error = null
      try {
        const body = await apiPost<LoginApiResponse>('/auth/login', { email, password })
        if (isMfaRequired(body)) {
          this.pendingMfaToken = body.mfaToken
          return 'mfa_required'
        }
        if (isPasswordChangeRequired(body)) {
          this.pendingChangeToken = body.changeToken
          return 'password_change_required'
        }
        setAccessToken(body.accessToken)
        await this.fetchMe()
        this.status = 'authenticated'
        return 'authenticated'
      } catch (err) {
        this.error = err instanceof ApiError ? err.message : 'Unable to sign in'
        throw err
      } finally {
        this.loading = false
      }
    },

    /** Completes a forced password change. The user signs in again afterwards. */
    async changePassword(newPassword: string) {
      if (!this.pendingChangeToken) {
        throw new Error('No pending password change')
      }
      this.loading = true
      this.error = null
      try {
        await apiPost<void>('/auth/password/change', {
          changeToken: this.pendingChangeToken,
          newPassword,
        })
        this.pendingChangeToken = null
      } catch (err) {
        this.error = err instanceof ApiError ? err.message : 'Unable to change password'
        throw err
      } finally {
        this.loading = false
      }
    },

    async verifyMfa(code: string) {
      if (!this.pendingMfaToken) {
        throw new Error('No pending MFA challenge')
      }
      this.loading = true
      this.error = null
      try {
        const body = await apiPost<LoginResponse>('/auth/mfa/verify', {
          mfaToken: this.pendingMfaToken,
          code,
        })
        setAccessToken(body.accessToken)
        this.pendingMfaToken = null
        await this.fetchMe()
        this.status = 'authenticated'
      } catch (err) {
        this.error = err instanceof ApiError ? err.message : 'Invalid MFA code'
        throw err
      } finally {
        this.loading = false
      }
    },

    async fetchMe() {
      this.user = await apiGet<AuthenticatedUser>('/users/me')
    },

    async logout() {
      await apiPost('/auth/logout').catch(() => undefined)
      setAccessToken(null)
      this.user = null
      this.status = 'unauthenticated'
    },
  },
})

/**
 * Wires the API client's 401 handler to this store's refresh flow, without
 * the client module importing the store directly (avoids a circular import).
 * Called once from main.ts after Pinia is installed.
 */
export function registerAuthRefreshHandler() {
  setUnauthorizedHandler(async () => {
    try {
      const response = await apiPost<{ accessToken: string | null }>('/auth/refresh')
      setAccessToken(response.accessToken)
      return response.accessToken
    } catch {
      setAccessToken(null)
      return null
    }
  })
}
