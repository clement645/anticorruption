import { defineStore } from 'pinia'
import { apiGet, apiPost } from '../api/client'

export interface Project {
  id: string
  contractId: string
  organizationId: string
  name: string
  description: string
  location: string | null
  status: string
  startDate: string
  plannedEndDate: string
  actualEndDate: string | null
  createdById: string
  createdAt: string
}

export interface Milestone {
  id: string
  projectId: string
  sequenceNumber: number
  title: string
  description: string
  plannedAmount: string
  plannedDate: string
  status: string
  completedAt: string | null
}

export interface Inspection {
  id: string
  milestoneId: string
  inspectedById: string
  inspectedAt: string
  outcome: string
  findings: string
}

export interface ProjectEvidence {
  id: string
  projectId: string
  inspectionId: string | null
  fileName: string
  fileHash: string
  fileSizeBytes: number
  mimeType: string
  blockchainTxRef: string | null
  uploadedById: string
  createdAt: string
}

interface ProjectsState {
  projects: Project[]
  milestones: Milestone[]
  inspectionsByMilestone: Record<string, Inspection[]>
  evidence: ProjectEvidence[]
  projectsLoading: boolean
  milestonesLoading: boolean
  evidenceLoading: boolean
  error: string | null
}

export const useProjectsStore = defineStore('projects', {
  state: (): ProjectsState => ({
    projects: [],
    milestones: [],
    inspectionsByMilestone: {},
    evidence: [],
    projectsLoading: false,
    milestonesLoading: false,
    evidenceLoading: false,
    error: null,
  }),
  actions: {
    async fetchProjects() {
      this.projectsLoading = true
      try {
        this.projects = await apiGet<Project[]>('/projects')
      } catch {
        this.error = 'Unable to load projects'
      } finally {
        this.projectsLoading = false
      }
    },
    async createProject(
      contractId: string,
      name: string,
      description: string,
      startDate: string,
      plannedEndDate: string,
      location?: string,
    ) {
      try {
        await apiPost('/projects', { contractId, name, description, startDate, plannedEndDate, location })
        await this.fetchProjects()
      } catch {
        this.error = 'Unable to create project — the contract must be ACTIVE and not already have a project'
      }
    },
    async activateProject(id: string) {
      try {
        await apiPost(`/projects/${id}/activate`)
        await this.fetchProjects()
      } catch {
        this.error = 'Unable to activate the project'
      }
    },
    async suspendProject(id: string) {
      try {
        await apiPost(`/projects/${id}/suspend`)
        await this.fetchProjects()
      } catch {
        this.error = 'Unable to suspend the project'
      }
    },
    async resumeProject(id: string) {
      try {
        await apiPost(`/projects/${id}/resume`)
        await this.fetchProjects()
      } catch {
        this.error = 'Unable to resume the project'
      }
    },
    async cancelProject(id: string) {
      try {
        await apiPost(`/projects/${id}/cancel`)
        await this.fetchProjects()
      } catch {
        this.error = 'Unable to cancel the project'
      }
    },

    async fetchMilestones(projectId?: string) {
      this.milestonesLoading = true
      try {
        const query = projectId ? `?projectId=${projectId}` : ''
        this.milestones = await apiGet<Milestone[]>(`/milestones${query}`)
      } catch {
        this.error = 'Unable to load milestones'
      } finally {
        this.milestonesLoading = false
      }
    },
    async createMilestone(
      projectId: string,
      sequenceNumber: number,
      title: string,
      description: string,
      plannedAmount: number,
      plannedDate: string,
    ) {
      try {
        await apiPost(`/projects/${projectId}/milestones`, {
          sequenceNumber,
          title,
          description,
          plannedAmount,
          plannedDate,
        })
        await this.fetchMilestones(projectId)
      } catch {
        this.error =
          'Unable to add milestone — the project must still be PLANNED (the milestone list is frozen once activated), and the sequence number must be unique'
      }
    },
    async startMilestone(id: string, projectId: string) {
      try {
        await apiPost(`/milestones/${id}/start`)
        await this.fetchMilestones(projectId)
      } catch {
        this.error = 'Unable to start the milestone'
      }
    },
    async completeMilestone(id: string, projectId: string) {
      try {
        await apiPost(`/milestones/${id}/complete`)
        await this.fetchMilestones(projectId)
      } catch {
        this.error = 'Unable to mark the milestone completed'
      }
    },

    async fetchInspections(milestoneId: string) {
      this.inspectionsByMilestone[milestoneId] = await apiGet<Inspection[]>(`/milestones/${milestoneId}/inspections`)
    },
    async recordInspection(
      milestoneId: string,
      projectId: string,
      outcome: 'PASSED' | 'FAILED' | 'NEEDS_REVISION',
      findings: string,
    ) {
      try {
        await apiPost(`/milestones/${milestoneId}/inspections`, { outcome, findings })
        await Promise.all([this.fetchInspections(milestoneId), this.fetchMilestones(projectId), this.fetchProjects()])
      } catch {
        this.error = 'Unable to record inspection — the milestone must be COMPLETED first'
      }
    },

    async fetchEvidence(projectId: string) {
      this.evidenceLoading = true
      try {
        this.evidence = await apiGet<ProjectEvidence[]>(`/projects/${projectId}/evidence`)
      } catch {
        this.error = 'Unable to load evidence'
      } finally {
        this.evidenceLoading = false
      }
    },
    async uploadEvidence(
      projectId: string,
      fileName: string,
      mimeType: string,
      fileContentBase64: string,
      inspectionId?: string,
    ) {
      try {
        await apiPost(`/projects/${projectId}/evidence`, { fileName, mimeType, fileContentBase64, inspectionId })
        await this.fetchEvidence(projectId)
      } catch {
        this.error = 'Unable to upload evidence'
      }
    },
    async downloadEvidence(id: string) {
      return apiGet<{ fileName: string; mimeType: string; contentBase64: string; hashVerified: boolean }>(
        `/evidence/${id}/download`,
      )
    },
  },
})
