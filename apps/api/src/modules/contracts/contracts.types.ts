export interface ContractView {
  id: string;
  awardId: string;
  supplierId: string;
  organizationId: string;
  allocationId: string;
  commitmentId: string;
  contractNumber: string;
  title: string;
  value: string;
  startDate: string;
  endDate: string;
  status: string;
  signedById: string | null;
  signedAt: string | null;
  createdAt: string;
}

export interface PurchaseOrderView {
  id: string;
  contractId: string;
  poNumber: string;
  description: string;
  amount: string;
  status: string;
  issuedById: string | null;
  issuedAt: string | null;
  createdAt: string;
}

export interface InvoiceItemView {
  id: string;
  description: string;
  quantity: string;
  unitPrice: string;
  amount: string;
}

export interface InvoiceView {
  id: string;
  purchaseOrderId: string;
  supplierId: string;
  invoiceNumber: string;
  amount: string;
  dueDate: string | null;
  status: string;
  items: InvoiceItemView[];
  submittedById: string | null;
  verifiedById: string | null;
  verifiedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
}

export interface PaymentApprovalView {
  id: string;
  approvedById: string;
  decision: string;
  notes: string | null;
  createdAt: string;
}

export interface PaymentRequestView {
  id: string;
  invoiceId: string;
  amount: string;
  requiredApprovals: number;
  status: string;
  approvals: PaymentApprovalView[];
  createdAt: string;
}

export interface PaymentView {
  id: string;
  paymentRequestId: string;
  expenditureId: string | null;
  amount: string;
  idempotencyKey: string;
  reference: string;
  executedById: string | null;
  executedAt: string;
}

export interface PaymentReconciliationView {
  id: string;
  paymentId: string;
  externalReference: string;
  status: string;
  notes: string | null;
  reconciledById: string | null;
  createdAt: string;
}
