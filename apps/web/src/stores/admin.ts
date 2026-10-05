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

interface AdminState {
  users: AdminUser[]
  total: number
  roles: AdminRole[]
  organizations: AdminOrganization[]
  loading: boolean
  error: string | null
}

export const useAdminStore = defineStore('admin', {
  state: (): AdminState => ({
    users: [],
    total: 0,
    roles: [],
    organizations: [],
    loading: false,
    error: null,
  }),
  actions: {
    async fetchUsers() {
      this.loading = true
      this.error = null
      try {
        const response = await apiGet<{ items: AdminUser[]; total: number }>(
          '/users?take=100',
        )
        this.users = response.items
        this.total = response.total
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
      await this.fetchUsers()
      return created
    },

    async updateUser(id: string, input: UpdateUserInput) {
      const stepUpToken = await requestStepUpToken()
      const updated = await apiPatch<AdminUser>(`/users/${id}`, input, {
        'X-Step-Up-Token': stepUpToken,
      })
      await this.fetchUsers()
      return updated
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
