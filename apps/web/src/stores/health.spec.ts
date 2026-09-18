import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'
import { useHealthStore } from './health'

describe('useHealthStore', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('populates liveness and readiness on a successful check', async () => {
    const liveness = { status: 'ok', timestamp: '2026-09-15T00:00:00.000Z', uptimeSeconds: 10 }
    const readiness = { status: 'ok', checks: { database: 'ok' } }

    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        const body = url.endsWith('/health/ready') ? readiness : liveness
        return Promise.resolve(
          new Response(JSON.stringify(body), {
            status: 200,
            headers: { 'Content-Type': 'application/json' },
          }),
        )
      }),
    )

    const store = useHealthStore()
    await store.checkHealth()

    expect(store.liveness).toEqual(liveness)
    expect(store.readiness).toEqual(readiness)
    expect(store.error).toBeNull()
  })

  it('records an error when the API is unreachable', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() => Promise.reject(new TypeError('fetch failed'))),
    )

    const store = useHealthStore()
    await store.checkHealth()

    expect(store.error).toBe('Unable to reach the B-PFMPS API')
    expect(store.liveness).toBeNull()
  })
})
