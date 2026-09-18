/**
 * Internal (investigator-facing) view types. `ReportPublicStatus` below is
 * the deliberately narrower shape a reporter sees when checking on their own
 * report via tracking code — see the doc comment there for exactly what's
 * withheld and why.
 */

export interface ReportEvidenceView {
  id: string;
  fileName: string;
  mimeType: string;
  fileSizeBytes: number;
  fileHash: string;
  anchored: boolean;
  createdAt: string;
}

export interface ReportUpdateView {
  id: string;
  author: 'INVESTIGATOR' | 'REPORTER';
  message: string;
  createdAt: string;
}

export interface ReportView {
  id: string;
  category: string;
  description: string;
  organizationId: string | null;
  status: string;
  contact: string | null;
  assignedToId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ReportDetailView extends ReportView {
  evidence: ReportEvidenceView[];
  updates: ReportUpdateView[];
}

/**
 * What a reporter sees when they check status via their own tracking code —
 * no `organizationId` (irrelevant to them, and one bit closer to "which
 * organization is this about" than a public status page should reveal),
 * `assignedToId` (an investigator's identity is never disclosed to the
 * reporter), or the decrypted `contact` (the reporter obviously already
 * knows their own contact info if they left one — echoing it back adds
 * nothing and is one more place it could leak from).
 */
export interface ReportPublicStatus {
  category: string;
  description: string;
  status: string;
  createdAt: string;
  evidence: ReportEvidenceView[];
  updates: ReportUpdateView[];
}

export interface SubmitReportResult {
  trackingCode: string;
  reportId: string;
}
