import { defineStore } from 'pinia'
import { apiGet, apiPost } from '../api/client'

/**
 * The "by tracking code" actions here talk only to `/public/whistleblower/*`
 * — genuinely unauthenticated, works with no session at all, the same as
 * Phase 12's transparency store. The "investigator" actions talk to
 * `/whistleblower/*` and do rely on an authenticated session with
 * `whistleblower:read`/`investigate`.
 */

export interface ReportEvidenceItem {
  id: string
  fileName: string
  mimeType: string
  fileSizeBytes: number
  fileHash: string
  anchored: boolean
  createdAt: string
}

export interface ReportUpdateItem {
  id: string
  author: 'INVESTIGATOR' | 'REPORTER'
  message: string
  createdAt: string
}

export interface PublicReportStatus {
  category: string
  description: string
  status: string
  createdAt: string
  evidence: ReportEvidenceItem[]
  updates: ReportUpdateItem[]
}

export interface InvestigatorReport {
  id: string
  category: string
  description: string
  organizationId: string | null
  status: string
  contact: string | null
  assignedToId: string | null
  createdAt: string
  updatedAt: string
}

export interface InvestigatorReportDetail extends InvestigatorReport {
  evidence: ReportEvidenceItem[]
  updates: ReportUpdateItem[]
}

interface WhistleblowerState {
  submittedTrackingCode: string | null
  reportStatus: PublicReportStatus | null
  reports: InvestigatorReport[]
  reportDetail: InvestigatorReportDetail | null
  loading: boolean
  error: string | null
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.split(',')[1] ?? '')
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

export const useWhistleblowerStore = defineStore('whistleblower', {
  state: (): WhistleblowerState => ({
    submittedTrackingCode: null,
    reportStatus: null,
    reports: [],
    reportDetail: null,
    loading: false,
    error: null,
  }),
  actions: {
    async submitReport(category: string, description: string, contact?: string) {
      this.loading = true
      this.error = null
      try {
        const result = await apiPost<{ trackingCode: string }>('/public/whistleblower/reports', {
          category,
          description,
          contact: contact || undefined,
        })
        this.submittedTrackingCode = result.trackingCode
        return result.trackingCode
      } catch {
        this.error = 'Unable to submit the report — please try again'
        return null
      } finally {
        this.loading = false
      }
    },

    async addEvidence(trackingCode: string, file: File) {
      const base64 = await fileToBase64(file)
      await apiPost(`/public/whistleblower/reports/${encodeURIComponent(trackingCode)}/evidence`, {
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
        fileContentBase64: base64,
      })
    },

    async checkStatus(trackingCode: string) {
      this.loading = true
      this.error = null
      this.reportStatus = null
      try {
        this.reportStatus = await apiGet<PublicReportStatus>(
          `/public/whistleblower/reports/${encodeURIComponent(trackingCode)}`,
        )
      } catch {
        this.error = 'No report found for that tracking code'
      } finally {
        this.loading = false
      }
    },

    async replyAsReporter(trackingCode: string, message: string) {
      await apiPost(`/public/whistleblower/reports/${encodeURIComponent(trackingCode)}/updates`, {
        message,
      })
      await this.checkStatus(trackingCode)
    },

    // --- investigator side ---

    async fetchReports(status?: string) {
      this.loading = true
      this.error = null
      try {
        const query = status ? `?status=${encodeURIComponent(status)}` : ''
        const result = await apiGet<{ items: InvestigatorReport[] }>(`/whistleblower/reports${query}`)
        this.reports = result.items
      } catch {
        this.error = 'Unable to load reports'
      } finally {
        this.loading = false
      }
    },

    async fetchReportDetail(id: string) {
      this.loading = true
      this.error = null
      try {
        this.reportDetail = await apiGet<InvestigatorReportDetail>(`/whistleblower/reports/${id}`)
      } catch {
        this.error = 'Unable to load this report'
      } finally {
        this.loading = false
      }
    },

    async assignToSelf(id: string) {
      await apiPost(`/whistleblower/reports/${id}/assign`)
      await this.fetchReportDetail(id)
    },

    async changeStatus(id: string, status: string) {
      try {
        await apiPost(`/whistleblower/reports/${id}/status`, { status })
        await this.fetchReportDetail(id)
      } catch {
        this.error = 'Unable to change status — check the report is in a state that allows this transition'
      }
    },

    async postInvestigatorUpdate(id: string, message: string) {
      await apiPost(`/whistleblower/reports/${id}/updates`, { message })
      await this.fetchReportDetail(id)
    },
  },
})
