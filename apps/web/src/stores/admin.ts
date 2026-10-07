import { defineStore } from 'pinia'
import { apiDelete, apiGet, apiPatch, apiPost } from '../api/client'
import { requestStepUpToken } from '../lib/stepUp'

export interface AdminPermission {
  id: string
  resource: string
  action: string
  description: string | null
}

export interface AdminRoleDetail extends AdminRole {
  description: string | null
  isSystem: boolean
  permissions: Array<{ permission: AdminPermission }>
}

export interface RoleInput {
  name?: string
  description?: string
  permissions?: string[]
}

export interface AdminRole {
  id: string
  name: string
}

export interface AdminDepartment {
  id: string
  name: string
  code: string
}

export interface AdminOrganization {
  id: string
  name: string
  code: string
  departments: AdminDepartment[]
}

export interface AdminUser {
  id: string
  email: string
  firstName: string
  lastName: string
  status: 'ACTIVE' | 'SUSPENDED' | 'LOCKED' | 'PENDING_ACTIVATION'
  organizationId: string | null
  departmentId: string | null
  organization: { id: string; name: string } | null
  department: { id: string; name: string } | null
  lastLoginAt: string | null
  createdAt: string
  roles: AdminRole[]
  mfaEnabled: boolean
  mustChangePassword: boolean
}

interface CreateUserInput {
  email: string
  firstName: string
  lastName: string
  temporaryPassword: string
  roleIds: string[]
  organizationId?: string
  departmentId?: string
}

interface UpdateUserInput {
  roleIds?: string[]
  status?: AdminUser['status']
  organizationId?: string
  departmentId?: string
}

export interface UserListQuery {
  skip?: number
  take?: number
  search?: string
  status?: AdminUser['status']
  sortBy?: 'email' | 'status' | 'lastLoginAt' | 'createdAt'
  sortOrder?: 'asc' | 'desc'
}

interface AdminState {
  users: AdminUser[]
  total: number
  lastQuery: UserListQuery
  roles: AdminRole[]
  organizations: AdminOrganization[]
  loading: boolean
  error: string | null
}

export const useAdminStore = defineStore('admin', {
  state: (): AdminState => ({
    users: [],
    total: 0,
    lastQuery: {},
    roles: [],
    organizations: [],
    loading: false,
    error: null,
  }),
  actions: {
    async fetchUsers(query: UserListQuery = {}) {
      this.loading = true
      this.error = null
      try {
        const params = new URLSearchParams()
        params.set('take', String(query.take ?? 25))
        params.set('skip', String(query.skip ?? 0))
        if (query.search) params.set('search', query.search)
        if (query.status) params.set('status', query.status)
        if (query.sortBy) params.set('sortBy', query.sortBy)
        if (query.sortOrder) params.set('sortOrder', query.sortOrder)
        const response = await apiGet<{ items: AdminUser[]; total: number }>(`/users?${params.toString()}`)
        this.users = response.items
        this.total = response.total
        this.lastQuery = query
      } catch {
        this.error = 'Unable to load user accounts'
      } finally {
        this.loading = false
      }
    },

    async fetchRoles() {
      try {
        this.roles = await apiGet<AdminRole[]>('/roles')
      } catch {
        this.roles = []
      }
    },

    async fetchOrganizations() {
      try {
        this.organizations = await apiGet<AdminOrganization[]>('/organizations')
      } catch {
        this.organizations = []
      }
    },

    async createUser(input: CreateUserInput) {
      const created = await apiPost<AdminUser>('/users', input)
      await this.fetchUsers(this.lastQuery)
      return created
    },

    async updateUser(id: string, input: UpdateUserInput) {
      const stepUpToken = await requestStepUpToken()
      const updated = await apiPatch<AdminUser>(`/users/${id}`, input, {
        'X-Step-Up-Token': stepUpToken,
      })
      await this.fetchUsers(this.lastQuery)
      return updated
    },

    /** Issues a one-time temporary password. The caller must show it once. */
    async resetPassword(id: string) {
      const stepUpToken = await requestStepUpToken()
      return apiPost<{ temporaryPassword: string }>(`/users/${id}/password/reset`, undefined, {
        'X-Step-Up-Token': stepUpToken,
      })
    },

    async resetMfa(id: string) {
      const stepUpToken = await requestStepUpToken()
      await apiPost<void>(`/users/${id}/mfa/reset`, undefined, { 'X-Step-Up-Token': stepUpToken })
      await this.fetchUsers(this.lastQuery)
    },

    async fetchRoleDetails() {
      return apiGet<AdminRoleDetail[]>('/roles')
    },

    async fetchPermissions() {
      return apiGet<AdminPermission[]>('/roles/permissions')
    },

    async createRole(input: Required<Pick<RoleInput, 'name' | 'permissions'>> & { description?: string }) {
      const stepUpToken = await requestStepUpToken()
      const created = await apiPost<AdminRoleDetail>('/roles', input, {
        'X-Step-Up-Token': stepUpToken,
      })
      await this.fetchRoles()
      return created
    },

    async updateRole(id: string, input: RoleInput) {
      const stepUpToken = await requestStepUpToken()
      const updated = await apiPatch<AdminRoleDetail>(`/roles/${id}`, input, {
        'X-Step-Up-Token': stepUpToken,
      })
      await this.fetchRoles()
      return updated
    },

    async deleteRole(id: string) {
      const stepUpToken = await requestStepUpToken()
      await apiDelete(`/roles/${id}`, { 'X-Step-Up-Token': stepUpToken })
      await this.fetchRoles()
    },
  },
})
