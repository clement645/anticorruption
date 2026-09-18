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

interface BudgetState {
  fiscalYears: FiscalYear[]
  budgets: Budget[]
  allocations: Allocation[]
  loading: boolean
  error: string | null
}

export const useBudgetStore = defineStore('budget', {
  state: (): BudgetState => ({
    fiscalYears: [],
    budgets: [],
    allocations: [],
    loading: false,
    error: null,
  }),
  actions: {
    async fetchFiscalYears() {
      this.fiscalYears = await apiGet<FiscalYear[]>('/fiscal-years')
    },

    async createFiscalYear(name: string, startDate: string, endDate: string) {
      await apiPost('/fiscal-years', { name, startDate, endDate })
      await this.fetchFiscalYears()
    },

    async fetchBudgets(fiscalYearId?: string) {
      this.loading = true
      this.error = null
      try {
        const query = fiscalYearId ? `?fiscalYearId=${fiscalYearId}` : ''
        const result = await apiGet<{ items: Budget[] }>(`/budgets${query}`)
        this.budgets = result.items
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
      await this.fetchBudgets(fiscalYearId)
    },

    async submitBudget(id: string) {
      await apiPost(`/budgets/${id}/submit`)
      await this.fetchBudgets()
    },

    async approveBudget(id: string) {
      await apiPost(`/budgets/${id}/approve`)
      await this.fetchBudgets()
    },

    async rejectBudget(id: string) {
      await apiPost(`/budgets/${id}/reject`)
      await this.fetchBudgets()
    },

    async fetchAllocations(organizationId?: string) {
      const query = organizationId ? `?organizationId=${organizationId}` : ''
      const result = await apiGet<{ items: Allocation[] }>(`/allocations${query}`)
      this.allocations = result.items
    },

    async createCommitment(allocationId: string, amount: number, description: string) {
      await apiPost(`/allocations/${allocationId}/commitments`, { amount, description })
      await this.fetchAllocations()
    },

    async createExpenditure(commitmentId: string, amount: number, description: string) {
      await apiPost(`/commitments/${commitmentId}/expenditures`, { amount, description })
      await this.fetchAllocations()
    },
  },
})
