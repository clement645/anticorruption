import { defineStore } from 'pinia'
import { apiGet, ApiError } from '../api/client'

interface LivenessResponse {
  status: 'ok'
  timestamp: string
  uptimeSeconds: number
}

interface ReadinessResponse {
  status: 'ok' | 'error'
  checks: {
    database: 'ok' | 'error'
  }
}

interface HealthState {
  liveness: LivenessResponse | null
  readiness: ReadinessResponse | null
  loading: boolean
  error: string | null
  lastCheckedAt: string | null
}

export const useHealthStore = defineStore('health', {
  state: (): HealthState => ({
    liveness: null,
    readiness: null,
    loading: false,
    error: null,
    lastCheckedAt: null,
  }),
  actions: {
    async checkHealth() {
      this.loading = true
      this.error = null
      try {
        const [liveness, readiness] = await Promise.all([
          apiGet<LivenessResponse>('/health'),
          apiGet<ReadinessResponse>('/health/ready'),
        ])
        this.liveness = liveness
        this.readiness = readiness
        this.lastCheckedAt = new Date().toISOString()
      } catch (err) {
        this.error =
          err instanceof ApiError
            ? `${err.message} (status ${err.statusCode})`
            : 'Unable to reach the B-PFMPS API'
      } finally {
        this.loading = false
      }
    },
  },
})
