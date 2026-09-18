import { defineStore } from 'pinia'
import { apiGet } from '../api/client'

interface AuditEvent {
  id: string
  sequence: string
  eventType: string
  actorEmail: string | null
  resourceType: string | null
  resourceId: string | null
  action: string
  blockchainTxRef: string | null
  createdAt: string
}

interface AuditEventList {
  items: AuditEvent[]
  total: number
}

interface ChainVerificationResult {
  valid: boolean
  totalChecked: number
  brokenAtSequence?: string
  reason?: string
}

export interface EventVerification {
  event: AuditEvent
  checks: {
    payloadHashValid: boolean
    chainLinkValid: boolean
    currentHashValid: boolean
    signatureValid: boolean
  }
  verified: boolean
  blockchainAnchor: {
    anchored: boolean
    found?: boolean
    chainLinkValid?: boolean
  }
}

export interface ReconstructionResult {
  resourceType: string
  resourceId: string
  totalEvents: number
  fullyVerified: boolean
  events: EventVerification[]
}

interface AuditState {
  events: AuditEvent[]
  total: number
  loading: boolean
  error: string | null
  verification: ChainVerificationResult | null
  verifyError: string | null
  verifying: boolean
  reconstruction: ReconstructionResult | null
  reconstructing: boolean
  reconstructError: string | null
}

export const useAuditStore = defineStore('audit', {
  state: (): AuditState => ({
    events: [],
    total: 0,
    loading: false,
    error: null,
    verification: null,
    verifyError: null,
    verifying: false,
    reconstruction: null,
    reconstructing: false,
    reconstructError: null,
  }),
  actions: {
    async fetchEvents() {
      this.loading = true
      this.error = null
      try {
        const result = await apiGet<AuditEventList>('/audit/events?take=25')
        this.events = result.items
        this.total = result.total
      } catch {
        this.error = 'Unable to load the audit trail'
      } finally {
        this.loading = false
      }
    },

    async verifyChain() {
      this.verifying = true
      this.verifyError = null
      try {
        this.verification = await apiGet<ChainVerificationResult>('/audit/verify')
      } catch {
        this.verification = null
        this.verifyError = 'Unable to reach the verification endpoint'
      } finally {
        this.verifying = false
      }
    },

    async reconstruct(resourceType: string, resourceId: string) {
      this.reconstructing = true
      this.reconstructError = null
      try {
        const query = `resourceType=${encodeURIComponent(resourceType)}&resourceId=${encodeURIComponent(resourceId)}`
        this.reconstruction = await apiGet<ReconstructionResult>(`/audit/reconstruct?${query}`)
      } catch {
        this.reconstruction = null
        this.reconstructError = 'Unable to reconstruct — check the resource type and ID'
      } finally {
        this.reconstructing = false
      }
    },
  },
})
