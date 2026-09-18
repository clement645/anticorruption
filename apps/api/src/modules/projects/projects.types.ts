export interface ProjectView {
  id: string;
  contractId: string;
  organizationId: string;
  name: string;
  description: string;
  location: string | null;
  status: string;
  startDate: string;
  plannedEndDate: string;
  actualEndDate: string | null;
  createdById: string | null;
  createdAt: string;
}

export interface MilestoneView {
  id: string;
  projectId: string;
  sequenceNumber: number;
  title: string;
  description: string;
  plannedAmount: string;
  plannedDate: string;
  status: string;
  completedAt: string | null;
}

export interface InspectionView {
  id: string;
  milestoneId: string;
  inspectedById: string | null;
  inspectedAt: string;
  outcome: string;
  findings: string;
}

export interface ProjectEvidenceView {
  id: string;
  projectId: string;
  inspectionId: string | null;
  fileName: string;
  fileHash: string;
  fileSizeBytes: number;
  mimeType: string;
  blockchainTxRef: string | null;
  uploadedById: string | null;
  createdAt: string;
}

export interface ProjectEvidenceDownload {
  fileName: string;
  mimeType: string;
  contentBase64: string;
  hashVerified: boolean;
}
