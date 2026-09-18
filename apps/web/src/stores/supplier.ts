import { defineStore } from 'pinia'
import { apiGet, apiPatch, apiPost } from '../api/client'

export interface SupplierProfile {
  id: string
  name: string
  registrationNumber: string
  email: string | null
  phone: string | null
  status: string
  businessType: string | null
  taxIdentifier: string | null
  physicalAddress: string | null
  county: string | null
  contactPersonName: string | null
  createdAt: string
  updatedAt: string
}

export interface SupplierOwner {
  id: string
  supplierId: string
  fullName: string
  nationalIdOrPassport: string
  ownershipPercentage: string
  position: string | null
  isPoliticallyExposedPerson: boolean
  createdAt: string
}

export interface SupplierDocument {
  id: string
  supplierId: string
  documentType: string
  fileName: string
  fileHash: string
  fileSizeBytes: number
  mimeType: string
  status: string
  expiryDate: string | null
  uploadedById: string | null
  verifiedById: string | null
  verifiedAt: string | null
  rejectionReason: string | null
  createdAt: string
}

export interface SupplierRiskProfile {
  id: string
  supplierId: string
  riskLevel: string
  score: string
  factors: unknown
  notes: string | null
  assessedById: string | null
  assessedAt: string
}

interface SupplierManagementState {
  profile: SupplierProfile | null
  owners: SupplierOwner[]
  documents: SupplierDocument[]
  currentRisk: SupplierRiskProfile | null
  riskHistory: SupplierRiskProfile[]
  error: string | null
}

export const useSupplierStore = defineStore('supplierManagement', {
  state: (): SupplierManagementState => ({
    profile: null,
    owners: [],
    documents: [],
    currentRisk: null,
    riskHistory: [],
    error: null,
  }),
  actions: {
    async fetchProfile(supplierId: string) {
      this.error = null
      try {
        this.profile = await apiGet<SupplierProfile>(`/suppliers/${supplierId}/profile`)
      } catch {
        this.error = 'Unable to load supplier profile'
      }
    },

    async updateProfile(supplierId: string, patch: Record<string, unknown>) {
      this.profile = await apiPatch<SupplierProfile>(`/suppliers/${supplierId}`, patch)
    },

    async suspend(supplierId: string) {
      this.profile = await apiPost<SupplierProfile>(`/suppliers/${supplierId}/suspend`)
    },
    async reactivate(supplierId: string) {
      this.profile = await apiPost<SupplierProfile>(`/suppliers/${supplierId}/reactivate`)
    },
    async blacklist(supplierId: string) {
      this.profile = await apiPost<SupplierProfile>(`/suppliers/${supplierId}/blacklist`)
    },

    async fetchOwners(supplierId: string) {
      try {
        this.owners = await apiGet<SupplierOwner[]>(`/suppliers/${supplierId}/owners`)
      } catch {
        this.owners = []
      }
    },
    async addOwner(
      supplierId: string,
      fullName: string,
      nationalIdOrPassport: string,
      ownershipPercentage: number,
      isPoliticallyExposedPerson: boolean,
      position?: string,
    ) {
      try {
        await apiPost(`/suppliers/${supplierId}/owners`, {
          fullName,
          nationalIdOrPassport,
          ownershipPercentage,
          isPoliticallyExposedPerson,
          position,
        })
        await this.fetchOwners(supplierId)
      } catch {
        this.error = 'Unable to add owner — total disclosed ownership may exceed 100%'
      }
    },
    async removeOwner(supplierId: string, ownerId: string) {
      await apiPost(`/suppliers/${supplierId}/owners/${ownerId}/remove`)
      await this.fetchOwners(supplierId)
    },

    async fetchDocuments(supplierId: string) {
      try {
        this.documents = await apiGet<SupplierDocument[]>(`/suppliers/${supplierId}/documents`)
      } catch {
        this.documents = []
      }
    },
    async uploadDocument(
      supplierId: string,
      documentType: string,
      fileName: string,
      mimeType: string,
      fileContentBase64: string,
      expiryDate?: string,
    ) {
      await apiPost(`/suppliers/${supplierId}/documents`, {
        documentType,
        fileName,
        mimeType,
        fileContentBase64,
        expiryDate,
      })
      await this.fetchDocuments(supplierId)
    },
    async verifyDocument(supplierId: string, documentId: string) {
      await apiPost(`/supplier-documents/${documentId}/verify`)
      await this.fetchDocuments(supplierId)
    },
    async rejectDocument(supplierId: string, documentId: string, reason: string) {
      await apiPost(`/supplier-documents/${documentId}/reject`, { reason })
      await this.fetchDocuments(supplierId)
    },

    async fetchCurrentRisk(supplierId: string) {
      try {
        this.currentRisk = await apiGet<SupplierRiskProfile | null>(
          `/suppliers/${supplierId}/risk-profile`,
        )
      } catch {
        this.currentRisk = null
      }
    },
    async fetchRiskHistory(supplierId: string) {
      try {
        this.riskHistory = await apiGet<SupplierRiskProfile[]>(
          `/suppliers/${supplierId}/risk-profile/history`,
        )
      } catch {
        this.riskHistory = []
      }
    },
    async recordRiskAssessment(
      supplierId: string,
      riskLevel: string,
      score: number,
      factors: string[],
      notes?: string,
    ) {
      await apiPost(`/suppliers/${supplierId}/risk-profile`, {
        riskLevel,
        score,
        factors,
        notes,
      })
      await this.fetchCurrentRisk(supplierId)
      await this.fetchRiskHistory(supplierId)
    },
  },
})
