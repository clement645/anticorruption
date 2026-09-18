/**
 * Minimal typed fetch wrapper for talking to the B-PFMPS backend API.
 *
 * The base URL is a build-time public variable (VITE_API_BASE_URL) — never a
 * secret. Backend authorization is authoritative regardless of what this
 * client sends; nothing here should ever be treated as a trust boundary
 * (see SECURITY.md § Authorization / API.md).
 *
 * The access token lives only in memory (this module's closure) — never in
 * localStorage/sessionStorage — per section 28 (no sensitive secrets in
 * browser storage). It is lost on a full page reload, which is why the auth
 * store calls /auth/refresh (backed by the httpOnly refresh cookie) once on
 * app startup to silently restore a session.
 */
const API_BASE_URL: string = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:3000/api/v1'

export class ApiError extends Error {
  readonly statusCode: number
  readonly requestId?: string

  constructor(message: string, statusCode: number, requestId?: string) {
    super(message)
    this.name = 'ApiError'
    this.statusCode = statusCode
    this.requestId = requestId
  }
}

let accessToken: string | null = null
/** Set by the auth store on login/refresh/logout; read by every request below. */
export function setAccessToken(token: string | null) {
  accessToken = token
}

/**
 * Called on a 401 to attempt a silent token refresh via the httpOnly cookie.
 * Wired up by the auth store to avoid a circular import between the store
 * and this client module.
 */
let unauthorizedHandler: (() => Promise<string | null>) | null = null
export function setUnauthorizedHandler(handler: () => Promise<string | null>) {
  unauthorizedHandler = handler
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  body?: unknown
  /** Extra headers merged in on top of Accept/Authorization/Content-Type — e.g. Idempotency-Key. */
  headers?: Record<string, string>
  /** Internal: prevents infinite retry loops after a refresh attempt. */
  _isRetry?: boolean
}

async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  const headers: Record<string, string> = { Accept: 'application/json' }
  if (accessToken) {
    headers.Authorization = `Bearer ${accessToken}`
  }
  if (options.body !== undefined) {
    headers['Content-Type'] = 'application/json'
  }
  Object.assign(headers, options.headers)

  const response = await fetch(`${API_BASE_URL}${path}`, {
    method: options.method ?? 'GET',
    headers,
    credentials: 'include',
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  })

  if (response.status === 401 && !options._isRetry && unauthorizedHandler && !path.startsWith('/auth/')) {
    const newToken = await unauthorizedHandler()
    if (newToken) {
      return request<T>(path, { ...options, _isRetry: true })
    }
  }

  if (!response.ok) {
    const body: unknown = await response.json().catch(() => null)
    const message =
      body && typeof body === 'object' && 'message' in body
        ? String((body as { message: unknown }).message)
        : `Request to ${path} failed with status ${response.status}`
    const requestId =
      body && typeof body === 'object' && 'requestId' in body
        ? String((body as { requestId: unknown }).requestId)
        : undefined
    throw new ApiError(message, response.status, requestId)
  }

  if (response.status === 204) {
    return undefined as T
  }
  return response.json() as Promise<T>
}

export function apiGet<T>(path: string): Promise<T> {
  return request<T>(path, { method: 'GET' })
}

export function apiPost<T>(path: string, body?: unknown, headers?: Record<string, string>): Promise<T> {
  return request<T>(path, { method: 'POST', body, headers })
}

export function apiPatch<T>(path: string, body?: unknown): Promise<T> {
  return request<T>(path, { method: 'PATCH', body })
}
