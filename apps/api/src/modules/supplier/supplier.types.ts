export interface SupplierProfileView {
  id: string;
  name: string;
  registrationNumber: string;
  email: string | null;
  phone: string | null;
  status: string;
  businessType: string | null;
  taxIdentifier: string | null;
  physicalAddress: string | null;
  county: string | null;
  contactPersonName: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface SupplierOwnerView {
  id: string;
  supplierId: string;
  fullName: string;
  nationalIdOrPassport: string;
  ownershipPercentage: string;
  position: string | null;
  isPoliticallyExposedPerson: boolean;
  createdAt: string;
}

export interface SupplierDocumentView {
  id: string;
  supplierId: string;
  documentType: string;
  fileName: string;
  fileHash: string;
  fileSizeBytes: number;
  mimeType: string;
  status: string;
  expiryDate: string | null;
  uploadedById: string | null;
  verifiedById: string | null;
  verifiedAt: string | null;
  rejectionReason: string | null;
  createdAt: string;
}

export interface SupplierRiskProfileView {
  id: string;
  supplierId: string;
  riskLevel: string;
  score: string;
  factors: unknown;
  notes: string | null;
  assessedById: string | null;
  assessedAt: string;
}
