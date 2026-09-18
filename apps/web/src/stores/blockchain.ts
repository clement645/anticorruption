import { defineStore } from 'pinia'
import { apiGet, apiPost } from '../api/client'

interface HealthCheckResult {
  healthy: boolean
  adapter: string
  details?: { totalBlocks: number; totalTransactions: number }
}

interface AnchorRunResult {
  anchoredCount: number
  transactionId?: string
  blockId?: string
}

interface BlockchainState {
  health: HealthCheckResult | null
  loading: boolean
  error: string | null
  anchoring: boolean
  lastRun: AnchorRunResult | null
}

export const useBlockchainStore = defineStore('blockchain', {
  state: (): BlockchainState => ({
    health: null,
    loading: false,
    error: null,
    anchoring: false,
    lastRun: null,
  }),
  actions: {
    async fetchHealth() {
      this.loading = true
      this.error = null
      try {
        this.health = await apiGet<HealthCheckResult>('/blockchain/health')
      } catch {
        this.error = 'Unable to reach the blockchain integrity layer'
      } finally {
        this.loading = false
      }
    },

    async triggerAnchor() {
      this.anchoring = true
      try {
        this.lastRun = await apiPost<AnchorRunResult>('/blockchain/anchor')
        await this.fetchHealth()
      } catch {
        this.error = 'Unable to trigger anchoring'
      } finally {
        this.anchoring = false
      }
    },
  },
})
