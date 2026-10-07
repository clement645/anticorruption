<script setup lang="ts">
import { computed, onMounted, reactive, ref, watch } from 'vue'

import { UserPlus, X, Pencil, Loader2, KeyRound, ShieldOff, Copy, Check, Search, ArrowUp, ArrowDown, ArrowUpDown, ChevronLeft, ChevronRight } from '@lucide/vue'
import { useAuthStore } from '../stores/auth'
import { useAdminStore, type AdminUser, type UserListQuery } from '../stores/admin'
import { ApiError } from '../api/client'
import UserCreateWizard from '../components/UserCreateWizard.vue'
import PageHeader from '../components/ui/PageHeader.vue'
import StatusBadge from '../components/ui/StatusBadge.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import SkeletonRows from '../components/ui/SkeletonRows.vue'
import AlertBanner from '../components/ui/AlertBanner.vue'
import ConfirmDialog from '../components/ui/ConfirmDialog.vue'
import { notify } from '../components/ui/toast'

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

const PAGE_SIZE = 20
const page = ref(0)
const search = ref('')
const statusFilter = ref<'' | AdminUser['status']>('')
const sortBy = ref<NonNullable<UserListQuery['sortBy']>>('createdAt')
const sortOrder = ref<NonNullable<UserListQuery['sortOrder']>>('desc')

const totalPages = computed(() => Math.max(1, Math.ceil(admin.total / PAGE_SIZE)))
const rangeStart = computed(() => (admin.total === 0 ? 0 : page.value * PAGE_SIZE + 1))
const rangeEnd = computed(() => Math.min(admin.total, (page.value + 1) * PAGE_SIZE))

function currentQuery(): UserListQuery {
  return {
    skip: page.value * PAGE_SIZE,
    take: PAGE_SIZE,
    search: search.value.trim() || undefined,
    status: statusFilter.value || undefined,
    sortBy: sortBy.value,
    sortOrder: sortOrder.value,
  }
}

function reload() {
  void admin.fetchUsers(currentQuery())
}

function sortIcon(column: NonNullable<UserListQuery['sortBy']>) {
  if (sortBy.value !== column) return ArrowUpDown
  return sortOrder.value === 'asc' ? ArrowUp : ArrowDown
}

function toggleSort(column: NonNullable<UserListQuery['sortBy']>) {
  if (sortBy.value === column) {
    sortOrder.value = sortOrder.value === 'asc' ? 'desc' : 'asc'
  } else {
    sortBy.value = column
    sortOrder.value = 'asc'
  }
}

let searchDebounce: ReturnType<typeof setTimeout> | undefined
watch(search, () => {
  clearTimeout(searchDebounce)
  searchDebounce = setTimeout(() => {
    page.value = 0
    reload()
  }, 300)
})
watch([statusFilter, sortBy, sortOrder], () => {
  page.value = 0
  reload()
})
watch(page, reload)

onMounted(async () => {
  await Promise.all([admin.fetchUsers(currentQuery()), admin.fetchRoles(), admin.fetchOrganizations()])
})

function openCreate() {
  createOpen.value = true
}

const canManageUsers = computed(
  () => auth.hasPermission('users:update') || auth.hasPermission('users:reset_password') || auth.hasPermission('users:reset_mfa'),
)
const resetResult = ref<{ email: string; temporaryPassword: string } | null>(null)
const resetCopied = ref(false)
const actionError = ref<string | null>(null)

type PendingAction = { kind: 'password' | 'mfa'; user: AdminUser } | null
const pending = ref<PendingAction>(null)
const working = ref(false)

function askResetPassword(u: AdminUser) {
  actionError.value = null
  pending.value = { kind: 'password', user: u }
}

function askResetMfa(u: AdminUser) {
  actionError.value = null
  pending.value = { kind: 'mfa', user: u }
}

async function confirmPending() {
  if (!pending.value) return
  const { kind, user } = pending.value
  working.value = true
  actionError.value = null
  try {
    if (kind === 'password') {
      const result = await admin.resetPassword(user.id)
      resetResult.value = { email: user.email, temporaryPassword: result.temporaryPassword }
      reload()
    } else {
      await admin.resetMfa(user.id)
      notify(`Authenticator removed for ${user.email}.`)
    }
    pending.value = null
  } catch (err) {
    actionError.value = err instanceof ApiError ? err.message : 'That action did not complete. Nothing was changed.'
    pending.value = null
  } finally {
    working.value = false
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
  reload()
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
    <PageHeader
      title="Users"
      subtitle="Create accounts, assign roles, and manage access for staff, auditors, and oversight bodies."
    >
      <template #actions>
        <button v-if="auth.hasPermission('users:create')" type="button" class="btn btn-primary" @click="openCreate">
          <UserPlus class="h-4 w-4" />
          New user
        </button>
      </template>
    </PageHeader>

    <div class="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
      <label class="relative w-full sm:max-w-xs">
        <span class="sr-only">Search users</span>
        <Search class="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" aria-hidden="true" />
        <input
          v-model="search"
          type="search"
          placeholder="Search by name or email"
          class="input pl-9"
        />
      </label>
      <select v-model="statusFilter" class="select w-full sm:w-48" aria-label="Filter by status">
        <option value="">All statuses</option>
        <option value="ACTIVE">Active</option>
        <option value="SUSPENDED">Suspended</option>
        <option value="LOCKED">Locked</option>
        <option value="PENDING_ACTIVATION">Awaiting activation</option>
      </select>
    </div>

    <div class="mt-4 hidden table-shell sm:block">
      <table class="table-base">
        <thead>
          <tr>
            <th>Name</th>
            <th>
              <button type="button" class="inline-flex items-center gap-1 hover:text-slate-900" @click="toggleSort('email')">
                Email
                <component :is="sortIcon('email')" class="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </th>
            <th>Roles</th>
            <th>Organization</th>
            <th>
              <button type="button" class="inline-flex items-center gap-1 hover:text-slate-900" @click="toggleSort('status')">
                Status
                <component :is="sortIcon('status')" class="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </th>
            <th>MFA</th>
            <th>
              <button type="button" class="inline-flex items-center gap-1 hover:text-slate-900" @click="toggleSort('lastLoginAt')">
                Last login
                <component :is="sortIcon('lastLoginAt')" class="h-3.5 w-3.5" aria-hidden="true" />
              </button>
            </th>
            <th v-if="canManageUsers" />
          </tr>
        </thead>
        <tbody>
          <tr v-if="admin.loading">
            <td colspan="8" class="py-8 text-center text-slate-500">
              <SkeletonRows :rows="4" :columns="5" />
            </td>
          </tr>
          <tr v-else-if="admin.users.length === 0">
            <td colspan="8" class="p-0">
              <EmptyState
                :title="search || statusFilter ? 'No users match this filter' : 'No user accounts yet'"
                :description="
                  search || statusFilter
                    ? 'Try a different search term or clear the status filter.'
                    : 'Accounts you create will appear here, with their roles, MFA status, and last sign-in.'
                "
              />
            </td>
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
              <StatusBadge :status="u.status" />
              <span v-if="u.mustChangePassword" class="badge badge-warning ml-1">Change pending</span>
            </td>
            <td>
              <span class="badge whitespace-nowrap" :class="u.mfaEnabled ? 'badge-success' : 'badge-neutral'">
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
                  @click="askResetPassword(u)"
                >
                  <KeyRound class="h-3.5 w-3.5" />
                  Reset password
                </button>
                <button
                  v-if="auth.hasPermission('users:reset_mfa') && u.id !== auth.user?.sub && u.mfaEnabled"
                  type="button"
                  class="btn btn-ghost btn-sm"
                  @click="askResetMfa(u)"
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

    <!-- Mobile: cards instead of a horizontally-scrolling table -->
    <div class="mt-4 space-y-3 sm:hidden">
      <SkeletonRows v-if="admin.loading" :rows="3" :columns="2" />
      <EmptyState
        v-else-if="admin.users.length === 0"
        :title="search || statusFilter ? 'No users match this filter' : 'No user accounts yet'"
      />
      <div v-for="u in admin.users" v-else :key="u.id" class="card p-4">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <p class="truncate font-medium text-slate-900">{{ u.firstName }} {{ u.lastName }}</p>
            <p class="truncate text-sm text-slate-500">{{ u.email }}</p>
          </div>
          <StatusBadge :status="u.status" />
        </div>
        <dl class="mt-3 grid grid-cols-2 gap-y-1.5 text-xs">
          <dt class="text-slate-400">Organization</dt>
          <dd class="text-right text-slate-700">{{ u.organization?.name ?? '—' }}</dd>
          <dt class="text-slate-400">MFA</dt>
          <dd class="text-right text-slate-700">{{ u.mfaEnabled ? 'Enabled' : 'Not enabled' }}</dd>
          <dt class="text-slate-400">Last login</dt>
          <dd class="text-right text-slate-700">{{ u.lastLoginAt ? new Date(u.lastLoginAt).toLocaleDateString() : 'Never' }}</dd>
        </dl>
        <div v-if="u.roles.length > 0" class="mt-2 flex flex-wrap gap-1">
          <span v-for="r in u.roles" :key="r.id" class="badge badge-info">{{ r.name }}</span>
        </div>
        <div v-if="canManageUsers" class="mt-3 flex flex-wrap gap-1.5 border-t border-slate-100 pt-3">
          <button type="button" class="btn btn-ghost btn-sm" @click="openEdit(u)">
            <Pencil class="h-3.5 w-3.5" />
            Manage
          </button>
          <button
            v-if="auth.hasPermission('users:reset_password') && u.id !== auth.user?.sub"
            type="button"
            class="btn btn-ghost btn-sm"
            @click="askResetPassword(u)"
          >
            <KeyRound class="h-3.5 w-3.5" />
            Reset password
          </button>
          <button
            v-if="auth.hasPermission('users:reset_mfa') && u.id !== auth.user?.sub && u.mfaEnabled"
            type="button"
            class="btn btn-ghost btn-sm"
            @click="askResetMfa(u)"
          >
            <ShieldOff class="h-3.5 w-3.5" />
            Reset MFA
          </button>
        </div>
      </div>
    </div>

    <!-- Pagination -->
    <div v-if="admin.total > 0" class="mt-4 flex items-center justify-between text-sm text-slate-600">
      <p>Showing {{ rangeStart }}–{{ rangeEnd }} of {{ admin.total }}</p>
      <div class="flex gap-2">
        <button type="button" class="btn btn-secondary btn-sm" :disabled="page === 0" @click="page -= 1">
          <ChevronLeft class="h-3.5 w-3.5" />
          Previous
        </button>
        <button type="button" class="btn btn-secondary btn-sm" :disabled="page >= totalPages - 1" @click="page += 1">
          Next
          <ChevronRight class="h-3.5 w-3.5" />
        </button>
      </div>
    </div>

    <div v-if="actionError" class="mt-4">
      <AlertBanner>{{ actionError }}</AlertBanner>
    </div>

    <ConfirmDialog
      :open="pending !== null"
      :title="pending?.kind === 'password' ? 'Issue a temporary password?' : 'Remove this authenticator?'"
      :message="
        pending?.kind === 'password'
          ? `A new one-time password will be issued for ${pending?.user.email}. Their current sessions will end, and they must choose a new password at next sign-in.`
          : `The authenticator for ${pending?.user.email} will be removed. They will set it up again at their next sign-in, and their current sessions will end.`
      "
      :confirm-label="pending?.kind === 'password' ? 'Issue password' : 'Remove authenticator'"
      tone="danger"
      :busy="working"
      @confirm="confirmPending"
      @cancel="pending = null"
    />

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
