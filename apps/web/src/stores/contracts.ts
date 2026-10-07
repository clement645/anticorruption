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

interface ContractsState {
  contracts: Contract[]
  purchaseOrders: PurchaseOrder[]
  invoices: Invoice[]
  paymentRequests: PaymentRequest[]
  paymentRequestsLoading: boolean
  payments: Payment[]
  paymentsLoading: boolean
  error: string | null
}

export const useContractsStore = defineStore('contracts', {
  state: (): ContractsState => ({
    contracts: [],
    purchaseOrders: [],
    invoices: [],
    paymentRequests: [],
    paymentRequestsLoading: false,
    payments: [],
    paymentsLoading: false,
    error: null,
  }),
  actions: {
    async fetchContracts() {
      this.contracts = await apiGet<Contract[]>('/contracts')
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
        await this.fetchContracts()
      } catch {
        this.error = 'Unable to create contract — check the award exists and has no contract yet'
      }
    },
    async activateContract(id: string) {
      await apiPost(`/contracts/${id}/activate`)
      await this.fetchContracts()
    },
    async completeContract(id: string) {
      await apiPost(`/contracts/${id}/complete`)
      await this.fetchContracts()
    },
    async terminateContract(id: string) {
      await apiPost(`/contracts/${id}/terminate`)
      await this.fetchContracts()
    },

    async fetchPurchaseOrders() {
      this.purchaseOrders = await apiGet<PurchaseOrder[]>('/purchase-orders')
    },
    async createPurchaseOrder(contractId: string, poNumber: string, description: string, amount: number) {
      await apiPost(`/contracts/${contractId}/purchase-orders`, { poNumber, description, amount })
      await this.fetchPurchaseOrders()
    },
    async issuePurchaseOrder(id: string) {
      await apiPost(`/purchase-orders/${id}/issue`)
      await this.fetchPurchaseOrders()
    },
    async cancelPurchaseOrder(id: string) {
      await apiPost(`/purchase-orders/${id}/cancel`)
      await this.fetchPurchaseOrders()
    },

    async fetchInvoices() {
      this.invoices = await apiGet<Invoice[]>('/invoices')
    },
    async createInvoice(
      purchaseOrderId: string,
      invoiceNumber: string,
      amount: number,
      items: Array<{ description: string; quantity: number; unitPrice: number; amount: number }>,
    ) {
      await apiPost(`/purchase-orders/${purchaseOrderId}/invoices`, { invoiceNumber, amount, items })
      await this.fetchInvoices()
    },
    async verifyInvoice(id: string) {
      await apiPost(`/invoices/${id}/verify`)
      await Promise.all([this.fetchInvoices(), this.fetchPaymentRequests()])
    },
    async rejectInvoice(id: string, reason: string) {
      await apiPost(`/invoices/${id}/reject`, { reason })
      await this.fetchInvoices()
    },

    async fetchPaymentRequests() {
      this.paymentRequestsLoading = true
      try {
        this.paymentRequests = await apiGet<PaymentRequest[]>('/payment-requests')
      } catch {
        this.error = 'Unable to load payment requests'
      } finally {
        this.paymentRequestsLoading = false
      }
    },
    async castApproval(id: string, decision: 'APPROVE' | 'REJECT', notes?: string) {
      try {
        await apiPost(`/payment-requests/${id}/approvals`, { decision, notes })
        await this.fetchPaymentRequests()
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
        await Promise.all([this.fetchPaymentRequests(), this.fetchPayments(), this.fetchInvoices()])
      } catch {
        this.error = 'Unable to execute payment — it may not be fully approved yet, or the step-up code was not accepted'
      }
    },

    async fetchPayments() {
      this.paymentsLoading = true
      try {
        this.payments = await apiGet<Payment[]>('/payments')
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
