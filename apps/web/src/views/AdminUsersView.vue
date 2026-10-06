<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'

import { UserPlus, X, Pencil, Loader2 } from '@lucide/vue'
import { useAuthStore } from '../stores/auth'
import { useAdminStore, type AdminUser } from '../stores/admin'
import { ApiError } from '../api/client'
import UserCreateWizard from '../components/UserCreateWizard.vue'

const auth = useAuthStore()
const admin = useAdminStore()

const createOpen = ref(false)
const editOpen = ref(false)
const editingUser = ref<AdminUser | null>(null)
const submitting = ref(false)
const formError = ref<string | null>(null)

const editForm = reactive({
  status: 'ACTIVE' as AdminUser['status'],
  roleIds: [] as string[],
})

onMounted(async () => {
  await Promise.all([admin.fetchUsers(), admin.fetchRoles(), admin.fetchOrganizations()])
})

function statusBadgeClass(status: AdminUser['status']) {
  switch (status) {
    case 'ACTIVE':
      return 'badge-success'
    case 'SUSPENDED':
      return 'badge-danger'
    case 'LOCKED':
      return 'badge-warning'
    default:
      return 'badge-neutral'
  }
}

function openCreate() {
  createOpen.value = true
}

function onCreated() {
  void admin.fetchUsers()
}

function openEdit(user: AdminUser) {
  editingUser.value = user
  editForm.status = user.status
  editForm.roleIds = user.roles.map((r) => r.id)
  formError.value = null
  editOpen.value = true
}

async function handleEdit() {
  if (!editingUser.value) return
  formError.value = null
  if (editForm.roleIds.length === 0) {
    formError.value = 'A user must have at least one role'
    return
  }
  submitting.value = true
  try {
    await admin.updateUser(editingUser.value.id, {
      status: editForm.status,
      roleIds: editForm.roleIds,
    })
    editOpen.value = false
  } catch (err) {
    formError.value = err instanceof ApiError ? err.message : 'Unable to update user'
  } finally {
    submitting.value = false
  }
}

function toggleRole(list: string[], roleId: string) {
  const idx = list.indexOf(roleId)
  if (idx === -1) list.push(roleId)
  else list.splice(idx, 1)
}
</script>

<template>
  <section class="mx-auto max-w-6xl px-4 py-8 sm:px-6">
    <div class="page-header flex-row items-end justify-between">
      <div>
        <h1 class="page-title">User Management</h1>
        <p class="page-subtitle">Create accounts and assign roles for staff, auditors, and oversight bodies.</p>
      </div>
      <button v-if="auth.hasPermission('users:create')" type="button" class="btn btn-primary" @click="openCreate">
        <UserPlus class="h-4 w-4" />
        New user
      </button>
    </div>

    <div class="mt-6 table-shell">
      <table class="table-base">
        <thead>
          <tr>
            <th>Name</th>
            <th>Email</th>
            <th>Roles</th>
            <th>Organization</th>
            <th>Status</th>
            <th>Last login</th>
            <th v-if="auth.hasPermission('users:update')" />
          </tr>
        </thead>
        <tbody>
          <tr v-if="admin.loading">
            <td colspan="7" class="py-8 text-center text-slate-500">
              <Loader2 class="mx-auto h-5 w-5 animate-spin" />
            </td>
          </tr>
          <tr v-else-if="admin.users.length === 0">
            <td colspan="7" class="py-8 text-center text-slate-500">No user accounts yet.</td>
          </tr>
          <tr v-for="u in admin.users" :key="u.id">
            <td class="font-medium text-slate-900">{{ u.firstName }} {{ u.lastName }}</td>
            <td>{{ u.email }}</td>
            <td>
              <div class="flex flex-wrap gap-1">
                <span v-for="r in u.roles" :key="r.id" class="badge badge-info">{{ r.name }}</span>
                <span v-if="u.roles.length === 0" class="text-xs text-slate-400">none</span>
              </div>
            </td>
            <td class="text-slate-500">{{ u.organization?.name ?? '—' }}</td>
            <td>
              <span class="badge" :class="statusBadgeClass(u.status)">{{ u.status }}</span>
            </td>
            <td class="text-slate-500">
              {{ u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'Never' }}
            </td>
            <td v-if="auth.hasPermission('users:update')">
              <button type="button" class="btn btn-ghost btn-sm" @click="openEdit(u)">
                <Pencil class="h-3.5 w-3.5" />
                Manage
              </button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <UserCreateWizard
      v-if="createOpen"
      @close="createOpen = false"
      @created="onCreated"
    />

    <!-- Edit user modal -->
    <div v-if="editOpen && editingUser" class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4">
      <div class="card w-full max-w-md p-6">
        <div class="mb-4 flex items-center justify-between">
          <h2 class="section-title">Manage {{ editingUser.email }}</h2>
          <button type="button" class="btn btn-ghost btn-sm" @click="editOpen = false">
            <X class="h-4 w-4" />
          </button>
        </div>

        <form class="space-y-4" @submit.prevent="handleEdit">
          <div>
            <label class="field-label">Status</label>
            <select
              v-model="editForm.status"
              class="select mt-1"
              :disabled="auth.user?.sub === editingUser.id"
            >
              <option value="ACTIVE">Active</option>
              <option value="SUSPENDED">Suspended</option>
              <option value="LOCKED">Locked</option>
              <option value="PENDING_ACTIVATION">Pending activation</option>
            </select>
            <p v-if="auth.user?.sub === editingUser.id" class="mt-1 text-xs text-slate-400">
              You cannot change your own account status.
            </p>
          </div>

          <div>
            <label class="field-label">Roles</label>
            <div class="mt-1.5 grid max-h-40 grid-cols-2 gap-1.5 overflow-y-auto rounded-lg border border-slate-200 p-3">
              <label
                v-for="role in admin.roles"
                :key="role.id"
                class="flex items-center gap-2 text-sm text-slate-700"
              >
                <input
                  type="checkbox"
                  :checked="editForm.roleIds.includes(role.id)"
                  class="rounded border-slate-300 text-brand-600 focus:ring-brand-500"
                  @change="toggleRole(editForm.roleIds, role.id)"
                />
                {{ role.name }}
              </label>
            </div>
          </div>

          <p v-if="formError" class="alert-error">{{ formError }}</p>

          <div class="flex justify-end gap-2 pt-2">
            <button type="button" class="btn btn-secondary" @click="editOpen = false">Cancel</button>
            <button type="submit" :disabled="submitting" class="btn btn-primary">
              <Loader2 v-if="submitting" class="h-4 w-4 animate-spin" />
              Save changes
            </button>
          </div>
        </form>
      </div>
    </div>
  </section>
</template>
