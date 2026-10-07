import { defineStore } from 'pinia'
import { apiGet, apiPost } from '../api/client'

export interface RiskAlert {
  id: string
  detectorType: string
  severity: string
  resourceType: string
  resourceId: string
  title: string
  description: string
  evidence: unknown
  status: string
  reviewedById: string | null
  reviewedAt: string | null
  reviewNotes: string | null
  createdAt: string
}

export interface RiskAlertQuery {
  status?: string
  severity?: string
  detectorType?: string
  skip?: number
  take?: number
}

interface RiskState {
  alerts: RiskAlert[]
  total: number
  lastQuery: RiskAlertQuery
  loading: boolean
  error: string | null
}

export const useRiskStore = defineStore('risk', {
  state: (): RiskState => ({
    alerts: [],
    total: 0,
    lastQuery: {},
    loading: false,
    error: null,
  }),
  actions: {
    // The list is written by background detectors, not people — unbounded,
    // it can run to thousands of rows (found during Phase 10 QA, where an
    // earlier unpaginated version of this call made the screen take 30s+ to
    // load). Paginated the same way the admin users list is.
    async fetchAlerts(query: RiskAlertQuery = {}) {
      this.loading = true
      this.error = null
      this.lastQuery = query
      try {
        const params = new URLSearchParams()
        if (query.status) params.set('status', query.status)
        if (query.severity) params.set('severity', query.severity)
        if (query.detectorType) params.set('detectorType', query.detectorType)
        params.set('skip', String(query.skip ?? 0))
        params.set('take', String(query.take ?? 25))
        const result = await apiGet<{ items: RiskAlert[]; total: number }>(`/risk-alerts?${params.toString()}`)
        this.alerts = result.items
        this.total = result.total
      } catch {
        this.error = 'Unable to load risk alerts'
      } finally {
        this.loading = false
      }
    },

    async review(alertId: string, status: 'UNDER_REVIEW' | 'CONFIRMED' | 'DISMISSED', notes?: string) {
      try {
        await apiPost(`/risk-alerts/${alertId}/review`, { status, notes })
        await this.fetchAlerts(this.lastQuery)
      } catch {
        this.error = 'Unable to update this alert — it may already be resolved'
      }
    },

    async scanTender(tenderId: string) {
      await apiPost(`/risk-scans/tenders/${tenderId}`)
      await this.fetchAlerts(this.lastQuery)
    },
    async scanOrganization(organizationId: string) {
      await apiPost(`/risk-scans/organizations/${organizationId}`)
      await this.fetchAlerts(this.lastQuery)
    },
    async scanSupplier(supplierId: string) {
      await apiPost(`/risk-scans/suppliers/${supplierId}`)
      await this.fetchAlerts(this.lastQuery)
    },
  },
})
