import { defineStore } from 'pinia'
import { apiGet, apiPost } from '../api/client'

export interface FiscalYear {
  id: string
  name: string
  status: string
}

export interface BudgetLine {
  id: string
  code: string
  voteName: string
  programName: string
  description: string
  authorizedAmount: string
}

export interface Budget {
  id: string
  fiscalYearId: string
  organizationId: string
  name: string
  status: string
  totalAuthorizedAmount: string
  lines: BudgetLine[]
  createdById: string | null
}

export interface Allocation {
  id: string
  budgetLineId: string
  authorizedAmount: string
  committedAmount: string
  spentAmount: string
  availableAmount: string
  status: string
  authorizationReference: string
}

interface NewBudgetLine {
  code: string
  voteCode: string
  voteName: string
  programName: string
  description: string
  authorizedAmount: number
}

interface BudgetQuery {
  fiscalYearId?: string
  skip?: number
  take?: number
}

interface AllocationQuery {
  organizationId?: string
  skip?: number
  take?: number
}

interface BudgetState {
  fiscalYears: FiscalYear[]
  fiscalYearsTotal: number
  fiscalYearsLoading: boolean
  budgets: Budget[]
  budgetsTotal: number
  lastBudgetQuery: BudgetQuery
  loading: boolean
  allocations: Allocation[]
  allocationsTotal: number
  lastAllocationQuery: AllocationQuery
  allocationsLoading: boolean
  error: string | null
}

export const useBudgetStore = defineStore('budget', {
  state: (): BudgetState => ({
    fiscalYears: [],
    fiscalYearsTotal: 0,
    fiscalYearsLoading: false,
    budgets: [],
    budgetsTotal: 0,
    lastBudgetQuery: {},
    loading: false,
    allocations: [],
    allocationsTotal: 0,
    lastAllocationQuery: {},
    allocationsLoading: false,
    error: null,
  }),
  actions: {
    // Realistically bounded (one, maybe a handful, per year of operation) —
    // paginated anyway for consistency with every other list, and because a
    // dev/test database can accumulate far more than production ever would.
    async fetchFiscalYears(query: { skip?: number; take?: number } = {}) {
      this.fiscalYearsLoading = true
      try {
        const params = new URLSearchParams()
        params.set('skip', String(query.skip ?? 0))
        params.set('take', String(query.take ?? 25))
        const result = await apiGet<{ items: FiscalYear[]; total: number }>(`/fiscal-years?${params.toString()}`)
        this.fiscalYears = result.items
        this.fiscalYearsTotal = result.total
      } catch {
        this.error = 'Unable to load fiscal years'
      } finally {
        this.fiscalYearsLoading = false
      }
    },

    async createFiscalYear(name: string, startDate: string, endDate: string) {
      await apiPost('/fiscal-years', { name, startDate, endDate })
      await this.fetchFiscalYears()
    },

    async fetchBudgets(query: BudgetQuery = {}) {
      this.loading = true
      this.error = null
      this.lastBudgetQuery = query
      try {
        const params = new URLSearchParams()
        if (query.fiscalYearId) params.set('fiscalYearId', query.fiscalYearId)
        params.set('skip', String(query.skip ?? 0))
        params.set('take', String(query.take ?? 25))
        const result = await apiGet<{ items: Budget[]; total: number }>(`/budgets?${params.toString()}`)
        this.budgets = result.items
        this.budgetsTotal = result.total
      } catch {
        this.error = 'Unable to load budgets'
      } finally {
        this.loading = false
      }
    },

    async createBudget(
      fiscalYearId: string,
      organizationId: string,
      name: string,
      lines: NewBudgetLine[],
    ) {
      await apiPost('/budgets', { fiscalYearId, organizationId, name, lines })
      await this.fetchBudgets({ fiscalYearId })
    },

    async submitBudget(id: string) {
      await apiPost(`/budgets/${id}/submit`)
      await this.fetchBudgets(this.lastBudgetQuery)
    },

    async approveBudget(
      id: string,
      signedFields: { signature: string; signatureTimestamp: string; signatureNonce: string },
    ) {
      await apiPost(`/budgets/${id}/approve`, signedFields)
      await this.fetchBudgets(this.lastBudgetQuery)
    },

    async rejectBudget(id: string, reason?: string) {
      await apiPost(`/budgets/${id}/reject`, reason ? { reason } : undefined)
      await this.fetchBudgets(this.lastBudgetQuery)
    },

    async fetchAllocations(query: AllocationQuery = {}) {
      this.allocationsLoading = true
      this.lastAllocationQuery = query
      try {
        const params = new URLSearchParams()
        if (query.organizationId) params.set('organizationId', query.organizationId)
        params.set('skip', String(query.skip ?? 0))
        params.set('take', String(query.take ?? 25))
        const result = await apiGet<{ items: Allocation[]; total: number }>(`/allocations?${params.toString()}`)
        this.allocations = result.items
        this.allocationsTotal = result.total
      } catch {
        this.error = 'Unable to load allocations'
      } finally {
        this.allocationsLoading = false
      }
    },

    async createCommitment(allocationId: string, amount: number, description: string) {
      await apiPost(`/allocations/${allocationId}/commitments`, { amount, description })
      await this.fetchAllocations(this.lastAllocationQuery)
    },

    async createExpenditure(commitmentId: string, amount: number, description: string) {
      await apiPost(`/commitments/${commitmentId}/expenditures`, { amount, description })
      await this.fetchAllocations(this.lastAllocationQuery)
    },
  },
})
