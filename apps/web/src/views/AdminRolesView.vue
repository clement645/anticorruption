<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { Plus, Pencil, Trash2, X, Lock } from '@lucide/vue'
import { useAuthStore } from '../stores/auth'
import {
  useAdminStore,
  type AdminPermission,
  type AdminRoleDetail,
} from '../stores/admin'
import { ApiError } from '../api/client'
import PageHeader from '../components/ui/PageHeader.vue'
import AlertBanner from '../components/ui/AlertBanner.vue'
import ConfirmDialog from '../components/ui/ConfirmDialog.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import SkeletonRows from '../components/ui/SkeletonRows.vue'
import { notify } from '../components/ui/toast'

const auth = useAuthStore()
const admin = useAdminStore()

const roles = ref<AdminRoleDetail[]>([])
const permissions = ref<AdminPermission[]>([])
const loading = ref(true)
const loadError = ref<string | null>(null)

const selectedId = ref<string | null>(null)
const mode = ref<'view' | 'create' | 'edit'>('view')
const form = ref({ name: '', description: '', keys: [] as string[] })
const saving = ref(false)
const formError = ref<string | null>(null)

const selectedRole = computed(() => roles.value.find((r) => r.id === selectedId.value) ?? null)

// Editing is blocked for system roles and for any role the signed-in admin
// holds (the backend enforces both; this just explains the lock in the UI).
const canEditSelected = computed(
  () =>
    !!selectedRole.value &&
    !selectedRole.value.isSystem &&
    !(auth.user?.roles ?? []).includes(selectedRole.value.name),
)

const permissionGroups = computed(() => {
  const groups = new Map<string, AdminPermission[]>()
  for (const p of permissions.value) {
    const list = groups.get(p.resource) ?? []
    list.push(p)
    groups.set(p.resource, list)
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b))
})

function keyOf(p: AdminPermission) {
  return `${p.resource}:${p.action}`
}

function canGrant(p: AdminPermission) {
  return auth.hasPermission(keyOf(p))
}

function rolePermissionKeys(role: AdminRoleDetail) {
  return role.permissions.map((rp) => `${rp.permission.resource}:${rp.permission.action}`)
}

async function load() {
  loading.value = true
  loadError.value = null
  try {
    const [r, p] = await Promise.all([admin.fetchRoleDetails(), admin.fetchPermissions()])
    roles.value = r
    permissions.value = p
    if (selectedId.value && !roles.value.some((x) => x.id === selectedId.value)) {
      selectedId.value = null
    }
  } catch (err) {
    loadError.value = err instanceof ApiError ? err.message : 'Unable to load roles'
  } finally {
    loading.value = false
  }
}

function select(role: AdminRoleDetail) {
  selectedId.value = role.id
  mode.value = 'view'
  formError.value = null
}

function startCreate() {
  selectedId.value = null
  mode.value = 'create'
  form.value = { name: '', description: '', keys: [] }
  formError.value = null
}

function startEdit() {
  if (!selectedRole.value) return
  mode.value = 'edit'
  form.value = {
    name: selectedRole.value.name,
    description: selectedRole.value.description ?? '',
    keys: rolePermissionKeys(selectedRole.value),
  }
  formError.value = null
}

function toggleKey(key: string) {
  const idx = form.value.keys.indexOf(key)
  if (idx === -1) form.value.keys.push(key)
  else form.value.keys.splice(idx, 1)
}

function errorMessage(err: unknown) {
  if (err instanceof ApiError) return err.message
  if (err instanceof Error) return err.message
  return 'Something went wrong'
}

async function save() {
  formError.value = null
  if (form.value.name.trim().length < 3) {
    formError.value = 'Role name must be at least 3 characters'
    return
  }
  saving.value = true
  try {
    if (mode.value === 'create') {
      const created = await admin.createRole({
        name: form.value.name.trim(),
        description: form.value.description.trim() || undefined,
        permissions: form.value.keys,
      })
      await load()
      selectedId.value = created.id
      mode.value = 'view'
      notify(`Role “${created.name}” created.`)
    } else if (selectedRole.value) {
      await admin.updateRole(selectedRole.value.id, {
        name: form.value.name.trim(),
        description: form.value.description.trim(),
        permissions: form.value.keys,
      })
      await load()
      mode.value = 'view'
      notify('Role saved.')
    }
  } catch (err) {
    formError.value = errorMessage(err)
  } finally {
    saving.value = false
  }
}

const confirmDelete = ref(false)
const deleting = ref(false)

function remove() {
  if (!selectedRole.value) return
  formError.value = null
  confirmDelete.value = true
}

async function performDelete() {
  if (!selectedRole.value) return
  deleting.value = true
  try {
    const name = selectedRole.value.name
    await admin.deleteRole(selectedRole.value.id)
    selectedId.value = null
    await load()
    notify(`Role “${name}” deleted.`)
  } catch (err) {
    formError.value = errorMessage(err)
  } finally {
    deleting.value = false
    confirmDelete.value = false
  }
}

onMounted(load)
</script>

<template>
  <div class="mx-auto max-w-6xl px-4 py-8 sm:px-6">
    <PageHeader
      title="Roles & permissions"
      subtitle="Define what each role can do. You can only grant permissions you hold yourself."
    >
      <template #actions>
        <button v-if="auth.hasPermission('roles:manage')" type="button" class="btn btn-primary" @click="startCreate">
          <Plus class="h-4 w-4" />
          New role
        </button>
      </template>
    </PageHeader>

    <div v-if="loadError" class="mb-4">
      <AlertBanner>{{ loadError }}</AlertBanner>
    </div>

    <div class="grid gap-6 lg:grid-cols-[320px_minmax(0,1fr)]">
      <!-- Role list -->
      <section class="card p-0">
        <SkeletonRows v-if="loading" :rows="6" :columns="1" />
        <EmptyState
          v-else-if="roles.length === 0"
          title="No roles yet"
          description="Create a role to group the permissions people need for their work."
        />
        <ul v-else class="divide-y divide-slate-100">
          <li v-for="role in roles" :key="role.id">
            <button
              type="button"
              class="flex w-full items-start justify-between gap-3 px-4 py-3 text-left hover:bg-slate-50"
              :class="selectedId === role.id ? 'bg-brand-50' : ''"
              @click="select(role)"
            >
              <span class="min-w-0">
                <span class="block truncate text-sm font-medium text-slate-900">{{ role.name }}</span>
                <span class="block truncate text-xs text-slate-500">
                  {{ role.permissions.length }} permission{{ role.permissions.length === 1 ? '' : 's' }}
                </span>
              </span>
              <Lock v-if="role.isSystem" class="mt-1 h-4 w-4 flex-none text-slate-400" aria-label="System role" />
            </button>
          </li>
        </ul>
      </section>

      <!-- Detail / editor -->
      <section class="card">
        <!-- Create or edit form -->
        <form v-if="mode !== 'view'" class="space-y-5" @submit.prevent="save">
          <div class="flex items-center justify-between">
            <h2 class="text-lg font-semibold">{{ mode === 'create' ? 'New role' : 'Edit role' }}</h2>
            <button type="button" class="btn btn-ghost btn-sm" @click="mode = 'view'">
              <X class="h-4 w-4" />
              Cancel
            </button>
          </div>

          <div class="grid gap-4 sm:grid-cols-2">
            <label class="block">
              <span class="text-sm font-medium">Name</span>
              <input v-model="form.name" class="input mt-1" required minlength="3" maxlength="80" />
            </label>
            <label class="block">
              <span class="text-sm font-medium">Description</span>
              <input v-model="form.description" class="input mt-1" maxlength="500" />
            </label>
          </div>

          <fieldset class="space-y-4">
            <legend class="text-sm font-medium">Permissions</legend>
            <div v-for="[resource, group] in permissionGroups" :key="resource" class="rounded-lg border border-slate-200 p-3">
              <p class="mb-2 text-xs font-semibold uppercase tracking-wider text-slate-500">{{ resource }}</p>
              <div class="flex flex-wrap gap-x-5 gap-y-2">
                <label
                  v-for="p in group"
                  :key="keyOf(p)"
                  class="flex items-center gap-2 text-sm"
                  :class="canGrant(p) ? 'text-slate-700' : 'text-slate-400'"
                  :title="canGrant(p) ? p.description ?? '' : 'You do not hold this permission, so you cannot grant it'"
                >
                  <input
                    type="checkbox"
                    :checked="form.keys.includes(keyOf(p))"
                    :disabled="!canGrant(p)"
                    @change="toggleKey(keyOf(p))"
                  />
                  {{ p.action }}
                </label>
              </div>
            </div>
          </fieldset>

          <AlertBanner v-if="formError">{{ formError }}</AlertBanner>

          <div class="flex justify-end gap-2">
            <button type="submit" class="btn btn-primary" :disabled="saving">
              {{ saving ? 'Saving…' : mode === 'create' ? 'Create role' : 'Save changes' }}
            </button>
          </div>
        </form>

        <!-- Read-only detail -->
        <div v-else-if="selectedRole" class="space-y-5">
          <div class="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 class="text-lg font-semibold">{{ selectedRole.name }}</h2>
              <p class="text-sm text-slate-500">{{ selectedRole.description || 'No description' }}</p>
            </div>
            <div class="flex gap-2">
              <button
                v-if="canEditSelected && auth.hasPermission('roles:manage')"
                type="button"
                class="btn btn-secondary btn-sm"
                @click="startEdit"
              >
                <Pencil class="h-4 w-4" />
                Edit
              </button>
              <button
                v-if="canEditSelected && auth.hasPermission('roles:manage')"
                type="button"
                class="btn btn-danger btn-sm"
                @click="remove"
              >
                <Trash2 class="h-4 w-4" />
                Delete
              </button>
            </div>
          </div>

          <p v-if="selectedRole.isSystem" class="text-sm text-slate-500">
            System role: it cannot be edited or deleted.
          </p>
          <p v-else-if="!canEditSelected" class="text-sm text-slate-500">
            You hold this role yourself, so you cannot edit it.
          </p>

          <div class="flex flex-wrap gap-2">
            <span
              v-for="key in rolePermissionKeys(selectedRole)"
              :key="key"
              class="badge badge-info font-mono"
            >{{ key }}</span>
            <span v-if="selectedRole.permissions.length === 0" class="text-sm text-slate-400">No permissions</span>
          </div>
          <AlertBanner v-if="formError">{{ formError }}</AlertBanner>
        </div>

        <div v-else class="py-12 text-center text-sm text-slate-500">
          Select a role to see its permissions, or create a new one.
        </div>
      </section>
    </div>

    <ConfirmDialog
      :open="confirmDelete"
      title="Delete this role?"
      :message="`The role “${selectedRole?.name}” will be removed. Roles still assigned to people cannot be deleted, and this cannot be undone.`"
      confirm-label="Delete role"
      tone="danger"
      :busy="deleting"
      @confirm="performDelete"
      @cancel="confirmDelete = false"
    />
  </div>
</template>
