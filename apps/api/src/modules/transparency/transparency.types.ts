/**
 * Every type in this file is the PUBLIC, privacy-filtered shape of an
 * internal entity — deliberately hand-written, never a re-export of an
 * internal *View type, so an internal field can never leak here just
 * because someone adds it to the internal type without thinking about this
 * module. No individual civil-servant identity (actor names/emails/ids),
 * no supplier beneficial-ownership/contact/tax data, no bid amounts or
 * evaluation scores for anything other than the final award, and no
 * evidence file content — only what section 12/40's public-transparency
 * intent actually calls for. See SECURITY.md § Citizen Transparency Portal
 * for the full reasoning behind each inclusion/exclusion.
 */

export interface PublicProjectSummary {
  id: string;
  name: string;
  description: string;
  location: string | null;
  status: string;
  organizationName: string;
  startDate: string;
  plannedEndDate: string;
  actualEndDate: string | null;
}

export interface PublicMilestone {
  sequenceNumber: number;
  title: string;
  description: string;
  plannedAmount: string;
  plannedDate: string;
  status: string;
  completedAt: string | null;
}

export interface PublicEvidenceSummary {
  id: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  fileHash: string;
  anchored: boolean;
  createdAt: string;
}

export interface PublicProjectDetail extends PublicProjectSummary {
  milestones: PublicMilestone[];
  evidence: PublicEvidenceSummary[];
}

export interface PublicTenderSummary {
  id: string;
  tenderNumber: string;
  title: string;
  description: string;
  status: string;
  publishedAt: string | null;
  closingDate: string;
  closedAt: string | null;
}

export interface PublicLotAward {
  supplierName: string;
  awardedAmount: string;
  awardedAt: string;
}

export interface PublicLot {
  lotNumber: string;
  description: string;
  estimatedAmount: string;
  award: PublicLotAward | null;
}

export interface PublicTenderDetail extends PublicTenderSummary {
  lots: PublicLot[];
}

export interface PublicSupplierSummary {
  id: string;
  name: string;
  registrationNumber: string;
  status: string;
  businessType: string | null;
  county: string | null;
}

export interface PublicBudgetLine {
  organizationName: string;
  fiscalYearName: string;
  voteCode: string;
  voteName: string;
  programName: string;
  authorizedAmount: string;
  committedAmount: string;
  spentAmount: string;
  status: string;
}

export interface PublicHashVerification {
  found: boolean;
  fileName?: string;
  mimeType?: string;
  fileSizeBytes?: number;
  projectId?: string;
  projectName?: string;
  milestoneTitle?: string | null;
  uploadedAt?: string;
  anchored?: boolean;
  chainIntact?: boolean;
}
