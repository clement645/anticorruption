import { defineStore } from 'pinia'
import { apiGet } from '../api/client'

/**
 * Talks only to `/public/*` — every call here works with no access token at
 * all (the backend routes are @Public()). apiGet() still attaches an
 * Authorization header if a session happens to be active, but the backend
 * ignores it entirely for these routes; this store must never be given a
 * reason to require one.
 */

export interface PublicProjectSummary {
  id: string
  name: string
  description: string
  location: string | null
  status: string
  organizationName: string
  startDate: string
  plannedEndDate: string
  actualEndDate: string | null
}

export interface PublicMilestone {
  sequenceNumber: number
  title: string
  description: string
  plannedAmount: string
  plannedDate: string
  status: string
  completedAt: string | null
}

export interface PublicEvidenceSummary {
  id: string
  fileName: string
  mimeType: string
  fileSizeBytes: number
  fileHash: string
  anchored: boolean
  createdAt: string
}

export interface PublicProjectDetail extends PublicProjectSummary {
  milestones: PublicMilestone[]
  evidence: PublicEvidenceSummary[]
}

export interface PublicTenderSummary {
  id: string
  tenderNumber: string
  title: string
  description: string
  status: string
  publishedAt: string | null
  closingDate: string
  closedAt: string | null
}

export interface PublicLot {
  lotNumber: string
  description: string
  estimatedAmount: string
  award: { supplierName: string; awardedAmount: string; awardedAt: string } | null
}

export interface PublicTenderDetail extends PublicTenderSummary {
  lots: PublicLot[]
}

export interface PublicSupplierSummary {
  id: string
  name: string
  registrationNumber: string
  status: string
  businessType: string | null
  county: string | null
}

export interface PublicBudgetLine {
  organizationName: string
  fiscalYearName: string
  voteCode: string
  voteName: string
  programName: string
  authorizedAmount: string
  committedAmount: string
  spentAmount: string
  status: string
}

export interface PublicHashVerification {
  found: boolean
  fileName?: string
  mimeType?: string
  fileSizeBytes?: number
  projectId?: string
  projectName?: string
  milestoneTitle?: string | null
  uploadedAt?: string
  anchored?: boolean
  chainIntact?: boolean
}

interface Paginated<T> {
  items: T[]
  total: number
}

interface TransparencyState {
  projects: PublicProjectSummary[]
  projectDetail: PublicProjectDetail | null
  tenders: PublicTenderSummary[]
  tenderDetail: PublicTenderDetail | null
  suppliers: PublicSupplierSummary[]
  budgetLines: PublicBudgetLine[]
  verification: PublicHashVerification | null
  loading: boolean
  error: string | null
}

export const useTransparencyStore = defineStore('transparency', {
  state: (): TransparencyState => ({
    projects: [],
    projectDetail: null,
    tenders: [],
    tenderDetail: null,
    suppliers: [],
    budgetLines: [],
    verification: null,
    loading: false,
    error: null,
  }),
  actions: {
    async searchProjects(search?: string) {
      this.loading = true
      this.error = null
      try {
        const query = search ? `?search=${encodeURIComponent(search)}` : ''
        const result = await apiGet<Paginated<PublicProjectSummary>>(`/public/projects${query}`)
        this.projects = result.items
      } catch {
        this.error = 'Unable to load projects'
      } finally {
        this.loading = false
      }
    },
    async fetchProjectDetail(id: string) {
      this.loading = true
      this.error = null
      try {
        this.projectDetail = await apiGet<PublicProjectDetail>(`/public/projects/${id}`)
      } catch {
        this.projectDetail = null
        this.error = 'Unable to load this project'
      } finally {
        this.loading = false
      }
    },

    async searchTenders(search?: string) {
      this.loading = true
      this.error = null
      try {
        const query = search ? `?search=${encodeURIComponent(search)}` : ''
        const result = await apiGet<Paginated<PublicTenderSummary>>(`/public/tenders${query}`)
        this.tenders = result.items
      } catch {
        this.error = 'Unable to load tenders'
      } finally {
        this.loading = false
      }
    },
    async fetchTenderDetail(id: string) {
      this.loading = true
      this.error = null
      try {
        this.tenderDetail = await apiGet<PublicTenderDetail>(`/public/tenders/${id}`)
      } catch {
        this.tenderDetail = null
        this.error = 'Unable to load this tender'
      } finally {
        this.loading = false
      }
    },

    async searchSuppliers(search?: string) {
      this.loading = true
      this.error = null
      try {
        const query = search ? `?search=${encodeURIComponent(search)}` : ''
        const result = await apiGet<Paginated<PublicSupplierSummary>>(`/public/suppliers${query}`)
        this.suppliers = result.items
      } catch {
        this.error = 'Unable to load suppliers'
      } finally {
        this.loading = false
      }
    },

    async fetchBudgetLines() {
      this.loading = true
      this.error = null
      try {
        const result = await apiGet<Paginated<PublicBudgetLine>>('/public/budgets')
        this.budgetLines = result.items
      } catch {
        this.error = 'Unable to load budget data'
      } finally {
        this.loading = false
      }
    },

    async verifyHash(hash: string) {
      this.loading = true
      this.error = null
      this.verification = null
      try {
        this.verification = await apiGet<PublicHashVerification>(
          `/public/verify?hash=${encodeURIComponent(hash)}`,
        )
      } catch {
        this.error = 'Unable to verify — check the hash is a 64-character hex SHA-256 digest'
      } finally {
        this.loading = false
      }
    },
  },
})
