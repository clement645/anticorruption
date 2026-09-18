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

interface RiskState {
  alerts: RiskAlert[]
  error: string | null
}

export const useRiskStore = defineStore('risk', {
  state: (): RiskState => ({
    alerts: [],
    error: null,
  }),
  actions: {
    async fetchAlerts(filters: { status?: string; severity?: string; detectorType?: string } = {}) {
      this.error = null
      try {
        const params = new URLSearchParams()
        if (filters.status) params.set('status', filters.status)
        if (filters.severity) params.set('severity', filters.severity)
        if (filters.detectorType) params.set('detectorType', filters.detectorType)
        const query = params.toString() ? `?${params.toString()}` : ''
        this.alerts = await apiGet<RiskAlert[]>(`/risk-alerts${query}`)
      } catch {
        this.error = 'Unable to load risk alerts'
      }
    },

    async review(alertId: string, status: 'UNDER_REVIEW' | 'CONFIRMED' | 'DISMISSED', notes?: string) {
      try {
        await apiPost(`/risk-alerts/${alertId}/review`, { status, notes })
        await this.fetchAlerts()
      } catch {
        this.error = 'Unable to update this alert — it may already be resolved'
      }
    },

    async scanTender(tenderId: string) {
      await apiPost(`/risk-scans/tenders/${tenderId}`)
      await this.fetchAlerts()
    },
    async scanOrganization(organizationId: string) {
      await apiPost(`/risk-scans/organizations/${organizationId}`)
      await this.fetchAlerts()
    },
    async scanSupplier(supplierId: string) {
      await apiPost(`/risk-scans/suppliers/${supplierId}`)
      await this.fetchAlerts()
    },
  },
})
