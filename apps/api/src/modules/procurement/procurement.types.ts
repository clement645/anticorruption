export interface SupplierView {
  id: string;
  name: string;
  registrationNumber: string;
  email: string | null;
  phone: string | null;
  status: string;
  createdAt: string;
}

export interface ProcurementPlanView {
  id: string;
  organizationId: string;
  fiscalYearId: string;
  name: string;
  description: string | null;
  status: string;
  approvedById: string | null;
  approvedAt: string | null;
  createdAt: string;
}

export interface ProcurementRequestView {
  id: string;
  procurementPlanId: string;
  organizationId: string;
  allocationId: string;
  title: string;
  description: string;
  estimatedAmount: string;
  status: string;
  commitmentId: string | null;
  requestedById: string | null;
  approvedById: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  createdAt: string;
}

export interface TenderLotView {
  id: string;
  lotNumber: string;
  description: string;
  estimatedAmount: string;
}

export interface TenderView {
  id: string;
  procurementRequestId: string;
  tenderNumber: string;
  title: string;
  description: string;
  status: string;
  publishedAt: string | null;
  closingDate: string;
  closedAt: string | null;
  lots: TenderLotView[];
  createdAt: string;
}

export interface BidView {
  id: string;
  tenderLotId: string;
  supplierId: string;
  amount: string;
  status: string;
  technicalScore: string | null;
  financialScore: string | null;
  createdAt: string;
}

export interface BidEvaluationView {
  id: string;
  bidId: string;
  technicalScore: string;
  financialScore: string;
  comments: string | null;
  evaluatedById: string | null;
  createdAt: string;
}

export interface AwardView {
  id: string;
  tenderLotId: string;
  bidId: string;
  awardedAmount: string;
  awardedById: string | null;
  createdAt: string;
}
