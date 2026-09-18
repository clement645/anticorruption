import { defineStore } from 'pinia'
import { apiGet, apiPost } from '../api/client'

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
  payments: Payment[]
  error: string | null
}

export const useContractsStore = defineStore('contracts', {
  state: (): ContractsState => ({
    contracts: [],
    purchaseOrders: [],
    invoices: [],
    paymentRequests: [],
    payments: [],
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
      this.paymentRequests = await apiGet<PaymentRequest[]>('/payment-requests')
    },
    async castApproval(id: string, decision: 'APPROVE' | 'REJECT', notes?: string) {
      try {
        await apiPost(`/payment-requests/${id}/approvals`, { decision, notes })
        await this.fetchPaymentRequests()
      } catch {
        this.error = 'Unable to record approval — you may have already decided on this request, or verified its invoice yourself'
      }
    },
    async executePayment(id: string) {
      try {
        const idempotencyKey =
          typeof crypto !== 'undefined' && 'randomUUID' in crypto
            ? crypto.randomUUID()
            : `${Date.now()}-${Math.random().toString(36).slice(2)}`
        await apiPost(`/payment-requests/${id}/execute`, undefined, { 'Idempotency-Key': idempotencyKey })
        await Promise.all([this.fetchPaymentRequests(), this.fetchPayments(), this.fetchInvoices()])
      } catch {
        this.error = 'Unable to execute payment — it may not be fully approved yet'
      }
    },

    async fetchPayments() {
      this.payments = await apiGet<Payment[]>('/payments')
    },
    async recordReconciliation(paymentId: string, externalReference: string, status: 'MATCHED' | 'DISCREPANCY', notes?: string) {
      await apiPost(`/payments/${paymentId}/reconciliations`, { externalReference, status, notes })
    },
  },
})
