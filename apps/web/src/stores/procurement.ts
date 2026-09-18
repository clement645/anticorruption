import { defineStore } from 'pinia'
import { apiGet, apiPost } from '../api/client'

export interface Supplier {
  id: string
  name: string
  registrationNumber: string
  status: string
}

export interface ProcurementPlan {
  id: string
  name: string
  status: string
}

export interface ProcurementRequest {
  id: string
  procurementPlanId: string
  allocationId: string
  title: string
  estimatedAmount: string
  status: string
  commitmentId: string | null
}

export interface TenderLot {
  id: string
  lotNumber: string
  description: string
  estimatedAmount: string
}

export interface Tender {
  id: string
  procurementRequestId: string
  tenderNumber: string
  title: string
  status: string
  lots: TenderLot[]
}

export interface Bid {
  id: string
  tenderLotId: string
  supplierId: string
  amount: string
  status: string
  technicalScore: string | null
  financialScore: string | null
}

interface ProcurementState {
  suppliers: Supplier[]
  plans: ProcurementPlan[]
  requests: ProcurementRequest[]
  tenders: Tender[]
  bidsByLot: Record<string, Bid[]>
  error: string | null
}

export const useProcurementStore = defineStore('procurement', {
  state: (): ProcurementState => ({
    suppliers: [],
    plans: [],
    requests: [],
    tenders: [],
    bidsByLot: {},
    error: null,
  }),
  actions: {
    async fetchSuppliers() {
      this.suppliers = await apiGet<Supplier[]>('/suppliers')
    },
    async createSupplier(name: string, registrationNumber: string) {
      await apiPost('/suppliers', { name, registrationNumber })
      await this.fetchSuppliers()
    },

    async fetchPlans() {
      this.plans = await apiGet<ProcurementPlan[]>('/procurement-plans')
    },
    async createPlan(organizationId: string, fiscalYearId: string, name: string) {
      await apiPost('/procurement-plans', { organizationId, fiscalYearId, name })
      await this.fetchPlans()
    },
    async approvePlan(id: string) {
      await apiPost(`/procurement-plans/${id}/approve`)
      await this.fetchPlans()
    },

    async fetchRequests() {
      const result = await apiGet<ProcurementRequest[]>('/procurement-requests')
      this.requests = result
    },
    async createRequest(
      procurementPlanId: string,
      organizationId: string,
      allocationId: string,
      title: string,
      description: string,
      estimatedAmount: number,
    ) {
      await apiPost('/procurement-requests', {
        procurementPlanId,
        organizationId,
        allocationId,
        title,
        description,
        estimatedAmount,
      })
      await this.fetchRequests()
    },
    async submitRequest(id: string) {
      await apiPost(`/procurement-requests/${id}/submit`)
      await this.fetchRequests()
    },
    async approveRequest(id: string) {
      try {
        await apiPost(`/procurement-requests/${id}/approve`)
        await this.fetchRequests()
      } catch {
        this.error = 'Unable to approve — check the allocation has enough available budget'
      }
    },
    async rejectRequest(id: string) {
      await apiPost(`/procurement-requests/${id}/reject`)
      await this.fetchRequests()
    },

    async fetchTenders() {
      this.tenders = await apiGet<Tender[]>('/tenders')
    },
    async createTender(
      procurementRequestId: string,
      title: string,
      description: string,
      closingDate: string,
      lots: Array<{ lotNumber: string; description: string; estimatedAmount: number }>,
    ) {
      await apiPost(`/procurement-requests/${procurementRequestId}/tenders`, {
        title,
        description,
        closingDate,
        lots,
      })
      await this.fetchTenders()
    },
    async publishTender(id: string) {
      await apiPost(`/tenders/${id}/publish`)
      await this.fetchTenders()
    },
    async closeTender(id: string) {
      await apiPost(`/tenders/${id}/close`)
      await this.fetchTenders()
    },

    async fetchBidsForLot(lotId: string) {
      this.bidsByLot[lotId] = await apiGet<Bid[]>(`/tender-lots/${lotId}/bids`)
    },
    async submitBid(lotId: string, supplierId: string, amount: number) {
      await apiPost(`/tender-lots/${lotId}/bids`, { supplierId, amount })
      await this.fetchBidsForLot(lotId)
    },
    async evaluateBid(bidId: string, lotId: string, technicalScore: number, financialScore: number) {
      await apiPost(`/bids/${bidId}/evaluate`, { technicalScore, financialScore })
      await this.fetchBidsForLot(lotId)
    },
    async awardBid(bidId: string, lotId: string) {
      try {
        await apiPost(`/bids/${bidId}/award`)
        await this.fetchBidsForLot(lotId)
        await this.fetchTenders()
      } catch {
        this.error = 'Unable to award — the bid may not be evaluated or the lot already awarded'
      }
    },
  },
})
