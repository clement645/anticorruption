<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'

import { UserPlus, X, Pencil, Loader2, KeyRound, ShieldOff, Copy, Check } from '@lucide/vue'
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

const canManageUsers = computed(
  () => auth.hasPermission('users:update') || auth.hasPermission('users:reset_password') || auth.hasPermission('users:reset_mfa'),
)
const resetResult = ref<{ email: string; temporaryPassword: string } | null>(null)
const resetCopied = ref(false)
const actionError = ref<string | null>(null)

async function doResetPassword(u: AdminUser) {
  if (!window.confirm(`Issue a new temporary password for ${u.email}? Their current sessions will end.`)) return
  actionError.value = null
  try {
    const result = await admin.resetPassword(u.id)
    resetResult.value = { email: u.email, temporaryPassword: result.temporaryPassword }
    await admin.fetchUsers()
  } catch (err) {
    actionError.value = err instanceof ApiError ? err.message : 'Unable to reset the password'
  }
}

async function doResetMfa(u: AdminUser) {
  if (!window.confirm(`Remove the authenticator for ${u.email}? They will set it up again at next sign-in.`)) return
  actionError.value = null
  try {
    await admin.resetMfa(u.id)
  } catch (err) {
    actionError.value = err instanceof ApiError ? err.message : 'Unable to reset MFA'
  }
}

async function copyResetPassword() {
  if (!resetResult.value) return
  try {
    await navigator.clipboard.writeText(resetResult.value.temporaryPassword)
    resetCopied.value = true
    setTimeout(() => (resetCopied.value = false), 1500)
  } catch {
    // Clipboard may be blocked; the password remains visible to copy by hand.
  }
}

function closeResetResult() {
  resetResult.value = null
  resetCopied.value = false
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
            <th>MFA</th>
            <th>Last login</th>
            <th v-if="canManageUsers" />
          </tr>
        </thead>
        <tbody>
          <tr v-if="admin.loading">
            <td colspan="8" class="py-8 text-center text-slate-500">
              <Loader2 class="mx-auto h-5 w-5 animate-spin" />
            </td>
          </tr>
          <tr v-else-if="admin.users.length === 0">
            <td colspan="8" class="py-8 text-center text-slate-500">No user accounts yet.</td>
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
              <span v-if="u.mustChangePassword" class="badge badge-warning ml-1">Change pending</span>
            </td>
            <td>
              <span class="badge" :class="u.mfaEnabled ? 'badge-success' : 'badge-neutral'">
                {{ u.mfaEnabled ? 'Enabled' : 'Not enabled' }}
              </span>
            </td>
            <td class="text-slate-500">
              {{ u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleString() : 'Never' }}
            </td>
            <td v-if="canManageUsers">
              <div class="flex flex-wrap justify-end gap-1">
                <button type="button" class="btn btn-ghost btn-sm" @click="openEdit(u)">
                  <Pencil class="h-3.5 w-3.5" />
                  Manage
                </button>
                <button
                  v-if="auth.hasPermission('users:reset_password') && u.id !== auth.user?.sub"
                  type="button"
                  class="btn btn-ghost btn-sm"
                  @click="doResetPassword(u)"
                >
                  <KeyRound class="h-3.5 w-3.5" />
                  Reset password
                </button>
                <button
                  v-if="auth.hasPermission('users:reset_mfa') && u.id !== auth.user?.sub && u.mfaEnabled"
                  type="button"
                  class="btn btn-ghost btn-sm"
                  @click="doResetMfa(u)"
                >
                  <ShieldOff class="h-3.5 w-3.5" />
                  Reset MFA
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <p v-if="actionError" class="alert-error mt-4" role="alert">{{ actionError }}</p>

    <!-- One-time temporary password -->
    <div
      v-if="resetResult"
      class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4"
      role="dialog"
      aria-modal="true"
      aria-labelledby="reset-title"
    >
      <div class="card w-full max-w-md p-6">
        <h2 id="reset-title" class="section-title">Temporary password issued</h2>
        <p class="mt-2 text-sm text-slate-600">
          Share this with <span class="font-medium">{{ resetResult.email }}</span> through a secure channel. It is shown
          only now. They must choose a new password at their next sign-in.
        </p>
        <div class="mt-4 flex items-center gap-2">
          <code class="flex-1 break-all rounded-md bg-slate-100 px-3 py-2 text-sm">{{ resetResult.temporaryPassword }}</code>
          <button type="button" class="btn btn-secondary btn-sm" @click="copyResetPassword">
            <Check v-if="resetCopied" class="h-3.5 w-3.5 text-emerald-600" />
            <Copy v-else class="h-3.5 w-3.5" />
            {{ resetCopied ? 'Copied' : 'Copy' }}
          </button>
        </div>
        <div class="mt-6 flex justify-end">
          <button type="button" class="btn btn-primary" @click="closeResetResult">Done</button>
        </div>
      </div>
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
