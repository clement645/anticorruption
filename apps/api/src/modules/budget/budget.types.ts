/**
 * JSON-safe view types for the budget module. Prisma's `Decimal` (decimal.js)
 * does serialize to a string via its own `toJSON()`, but these explicit view
 * types keep the API contract self-documenting and let us add computed
 * fields (e.g. `availableAmount`) that aren't stored columns.
 */

export interface FiscalYearView {
  id: string;
  name: string;
  startDate: string;
  endDate: string;
  status: string;
  createdAt: string;
}

export interface BudgetLineView {
  id: string;
  code: string;
  voteCode: string;
  voteName: string;
  programName: string;
  subProgramName: string | null;
  description: string;
  authorizedAmount: string;
}

export interface BudgetView {
  id: string;
  fiscalYearId: string;
  organizationId: string;
  name: string;
  description: string | null;
  status: string;
  createdById: string | null;
  approvedById: string | null;
  approvedAt: string | null;
  rejectedAt: string | null;
  totalAuthorizedAmount: string;
  lines: BudgetLineView[];
  createdAt: string;
}

export interface AllocationView {
  id: string;
  budgetLineId: string;
  organizationId: string;
  fiscalYearId: string;
  authorizedAmount: string;
  committedAmount: string;
  spentAmount: string;
  availableAmount: string;
  status: string;
  authorizationReference: string;
  blockchainTxRef: string | null;
  createdAt: string;
}

export interface CommitmentView {
  id: string;
  allocationId: string;
  amount: string;
  description: string;
  status: string;
  createdById: string | null;
  releasedAt: string | null;
  createdAt: string;
}

export interface ExpenditureView {
  id: string;
  commitmentId: string;
  allocationId: string;
  amount: string;
  description: string;
  recordedById: string | null;
  createdAt: string;
}

export interface BudgetAdjustmentView {
  id: string;
  allocationId: string;
  type: string;
  amount: string;
  reason: string;
  status: string;
  requestedById: string | null;
  approvedById: string | null;
  approvedAt: string | null;
  createdAt: string;
}
