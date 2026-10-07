import { defineStore } from 'pinia'
import { apiGet, apiPost } from '../api/client'
import { requestStepUpToken } from '../lib/stepUp'

export interface Contract {
  id: string
  awardId: string
  supplierId: string
  organizationId: string
  allocationId: string
  commitmentId: string
  contractNumber: string
  title: string
  value: string
  startDate: string
  endDate: string
  status: string
  signedById: string | null
  signedAt: string | null
}

export interface PurchaseOrder {
  id: string
  contractId: string
  poNumber: string
  description: string
  amount: string
  status: string
}

export interface InvoiceItem {
  id: string
  description: string
  quantity: string
  unitPrice: string
  amount: string
}

export interface Invoice {
  id: string
  purchaseOrderId: string
  supplierId: string
  invoiceNumber: string
  amount: string
  status: string
  items: InvoiceItem[]
  verifiedById: string | null
  rejectionReason: string | null
}

export interface PaymentApproval {
  id: string
  approvedById: string
  decision: string
  notes: string | null
  createdAt: string
}

export interface PaymentRequest {
  id: string
  invoiceId: string
  amount: string
  requiredApprovals: number
  status: string
  approvals: PaymentApproval[]
  createdAt: string
}

export interface Payment {
  id: string
  paymentRequestId: string
  expenditureId: string | null
  amount: string
  idempotencyKey: string
  reference: string
  executedAt: string
}

interface PageQuery {
  skip?: number
  take?: number
}
interface InvoiceQuery extends PageQuery {
  status?: string
}

interface ContractsState {
  contracts: Contract[]
  contractsTotal: number
  contractsLoading: boolean
  lastContractsQuery: PageQuery
  purchaseOrders: PurchaseOrder[]
  purchaseOrdersTotal: number
  purchaseOrdersLoading: boolean
  lastPurchaseOrdersQuery: PageQuery
  invoices: Invoice[]
  invoicesTotal: number
  invoicesLoading: boolean
  lastInvoicesQuery: InvoiceQuery
  paymentRequests: PaymentRequest[]
  paymentRequestsTotal: number
  paymentRequestsLoading: boolean
  lastPaymentRequestsQuery: PageQuery
  payments: Payment[]
  paymentsTotal: number
  paymentsLoading: boolean
  lastPaymentsQuery: PageQuery
  error: string | null
}

function toParams(query: Record<string, string | number | undefined>): string {
  const params = new URLSearchParams()
  for (const [key, value] of Object.entries(query)) {
    if (value !== undefined) params.set(key, String(value))
  }
  return params.toString()
}

export const useContractsStore = defineStore('contracts', {
  state: (): ContractsState => ({
    contracts: [],
    contractsTotal: 0,
    contractsLoading: false,
    lastContractsQuery: {},
    purchaseOrders: [],
    purchaseOrdersTotal: 0,
    purchaseOrdersLoading: false,
    lastPurchaseOrdersQuery: {},
    invoices: [],
    invoicesTotal: 0,
    invoicesLoading: false,
    lastInvoicesQuery: {},
    paymentRequests: [],
    paymentRequestsTotal: 0,
    paymentRequestsLoading: false,
    lastPaymentRequestsQuery: {},
    payments: [],
    paymentsTotal: 0,
    paymentsLoading: false,
    lastPaymentsQuery: {},
    error: null,
  }),
  actions: {
    // Each list below is paginated — a real contract/PO/invoice/payment
    // register grows with every procurement cycle and has no natural cap
    // (found unbounded during Phase 10 QA, same shape of problem risk-alerts
    // had). Every mutating action below refetches with the caller's *last*
    // query rather than a bare refetch, so approving/issuing/etc. doesn't
    // silently snap the list back to page 1 and drop any filter.
    async fetchContracts(query: PageQuery = {}) {
      this.contractsLoading = true
      this.lastContractsQuery = query
      try {
        const result = await apiGet<{ items: Contract[]; total: number }>(
          `/contracts?${toParams({ skip: query.skip ?? 0, take: query.take ?? 25 })}`,
        )
        this.contracts = result.items
        this.contractsTotal = result.total
      } catch {
        this.error = 'Unable to load contracts'
      } finally {
        this.contractsLoading = false
      }
    },
    async createContract(
      awardId: string,
      contractNumber: string,
      title: string,
      value: number,
      startDate: string,
      endDate: string,
    ) {
      try {
        await apiPost('/contracts', { awardId, contractNumber, title, value, startDate, endDate })
        await this.fetchContracts(this.lastContractsQuery)
      } catch {
        this.error = 'Unable to create contract — check the award exists and has no contract yet'
      }
    },
    async activateContract(id: string) {
      try {
        await apiPost(`/contracts/${id}/activate`)
        await this.fetchContracts(this.lastContractsQuery)
      } catch {
        this.error = 'Unable to activate the contract'
      }
    },
    async completeContract(id: string) {
      try {
        await apiPost(`/contracts/${id}/complete`)
        await this.fetchContracts(this.lastContractsQuery)
      } catch {
        this.error = 'Unable to complete the contract'
      }
    },
    async terminateContract(id: string) {
      await apiPost(`/contracts/${id}/terminate`)
      await this.fetchContracts(this.lastContractsQuery)
    },

    async fetchPurchaseOrders(query: PageQuery = {}) {
      this.purchaseOrdersLoading = true
      this.lastPurchaseOrdersQuery = query
      try {
        const result = await apiGet<{ items: PurchaseOrder[]; total: number }>(
          `/purchase-orders?${toParams({ skip: query.skip ?? 0, take: query.take ?? 25 })}`,
        )
        this.purchaseOrders = result.items
        this.purchaseOrdersTotal = result.total
      } catch {
        this.error = 'Unable to load purchase orders'
      } finally {
        this.purchaseOrdersLoading = false
      }
    },
    async createPurchaseOrder(contractId: string, poNumber: string, description: string, amount: number) {
      try {
        await apiPost(`/contracts/${contractId}/purchase-orders`, { poNumber, description, amount })
        await this.fetchPurchaseOrders(this.lastPurchaseOrdersQuery)
      } catch {
        this.error = 'Unable to create purchase order — check the contract is ACTIVE'
      }
    },
    async issuePurchaseOrder(id: string) {
      try {
        await apiPost(`/purchase-orders/${id}/issue`)
        await this.fetchPurchaseOrders(this.lastPurchaseOrdersQuery)
      } catch {
        this.error = 'Unable to issue the purchase order'
      }
    },
    async cancelPurchaseOrder(id: string) {
      await apiPost(`/purchase-orders/${id}/cancel`)
      await this.fetchPurchaseOrders(this.lastPurchaseOrdersQuery)
    },

    async fetchInvoices(query: InvoiceQuery = {}) {
      this.invoicesLoading = true
      this.lastInvoicesQuery = query
      try {
        const result = await apiGet<{ items: Invoice[]; total: number }>(
          `/invoices?${toParams({ status: query.status, skip: query.skip ?? 0, take: query.take ?? 25 })}`,
        )
        this.invoices = result.items
        this.invoicesTotal = result.total
      } catch {
        this.error = 'Unable to load invoices'
      } finally {
        this.invoicesLoading = false
      }
    },
    async createInvoice(
      purchaseOrderId: string,
      invoiceNumber: string,
      amount: number,
      items: Array<{ description: string; quantity: number; unitPrice: number; amount: number }>,
    ) {
      try {
        await apiPost(`/purchase-orders/${purchaseOrderId}/invoices`, { invoiceNumber, amount, items })
        await this.fetchInvoices(this.lastInvoicesQuery)
      } catch {
        this.error = 'Unable to submit invoice — check the purchase order is ISSUED'
      }
    },
    async verifyInvoice(id: string) {
      await apiPost(`/invoices/${id}/verify`)
      await Promise.all([
        this.fetchInvoices(this.lastInvoicesQuery),
        this.fetchPaymentRequests(this.lastPaymentRequestsQuery),
      ])
    },
    async rejectInvoice(id: string, reason: string) {
      await apiPost(`/invoices/${id}/reject`, { reason })
      await this.fetchInvoices(this.lastInvoicesQuery)
    },

    async fetchPaymentRequests(query: PageQuery = {}) {
      this.paymentRequestsLoading = true
      this.lastPaymentRequestsQuery = query
      try {
        const result = await apiGet<{ items: PaymentRequest[]; total: number }>(
          `/payment-requests?${toParams({ skip: query.skip ?? 0, take: query.take ?? 25 })}`,
        )
        this.paymentRequests = result.items
        this.paymentRequestsTotal = result.total
      } catch {
        this.error = 'Unable to load payment requests'
      } finally {
        this.paymentRequestsLoading = false
      }
    },
    async castApproval(id: string, decision: 'APPROVE' | 'REJECT', notes?: string) {
      try {
        await apiPost(`/payment-requests/${id}/approvals`, { decision, notes })
        await this.fetchPaymentRequests(this.lastPaymentRequestsQuery)
      } catch {
        this.error = 'Unable to record approval — you may have already decided on this request, or verified its invoice yourself'
      }
    },
    // Payment execution is @RequireStepUp() on the backend — disbursing real money
    // needs a fresh MFA code, not just a valid session. The shared step-up challenge
    // (built in the security hardening phase) was never wired in here until now.
    async executePayment(id: string) {
      // A cancelled step-up challenge is not an execution failure — let it
      // propagate so the caller can tell "user backed out" apart from "the
      // API rejected this" rather than reporting both as the same error.
      const stepUpToken = await requestStepUpToken()
      try {
        const idempotencyKey =
          typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`
        await apiPost(`/payment-requests/${id}/execute`, undefined, {
          'Idempotency-Key': idempotencyKey,
          'X-Step-Up-Token': stepUpToken,
        })
        await Promise.all([
          this.fetchPaymentRequests(this.lastPaymentRequestsQuery),
          this.fetchPayments(this.lastPaymentsQuery),
          this.fetchInvoices(this.lastInvoicesQuery),
        ])
      } catch {
        this.error = 'Unable to execute payment — it may not be fully approved yet, or the step-up code was not accepted'
      }
    },

    async fetchPayments(query: PageQuery = {}) {
      this.paymentsLoading = true
      this.lastPaymentsQuery = query
      try {
        const result = await apiGet<{ items: Payment[]; total: number }>(
          `/payments?${toParams({ skip: query.skip ?? 0, take: query.take ?? 25 })}`,
        )
        this.payments = result.items
        this.paymentsTotal = result.total
      } catch {
        this.error = 'Unable to load executed payments'
      } finally {
        this.paymentsLoading = false
      }
    },
    async recordReconciliation(paymentId: string, externalReference: string, status: 'MATCHED' | 'DISCREPANCY', notes?: string) {
      try {
        await apiPost(`/payments/${paymentId}/reconciliations`, { externalReference, status, notes })
      } catch {
        this.error = 'Unable to record reconciliation'
      }
    },
  },
})
