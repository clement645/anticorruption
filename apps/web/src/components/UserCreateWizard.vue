<script setup lang="ts">
import { computed, reactive, ref } from 'vue'
import { Check, Copy, RefreshCw, X, Loader2, ArrowLeft, ArrowRight } from '@lucide/vue'
import { useAdminStore, type AdminUser } from '../stores/admin'
import { ApiError } from '../api/client'

const emit = defineEmits<{
  close: []
  created: [user: AdminUser]
}>()

const admin = useAdminStore()

const steps = [
  { key: 'identity', label: 'Identity' },
  { key: 'organization', label: 'Organization' },
  { key: 'department', label: 'Department' },
  { key: 'role', label: 'Role' },
  { key: 'security', label: 'Security' },
  { key: 'review', label: 'Review' },
] as const

const current = ref(0)
const submitting = ref(false)
const stepError = ref<string | null>(null)
const created = ref<AdminUser | null>(null)
const copied = ref<'password' | 'email' | null>(null)

const form = reactive({
  firstName: '',
  lastName: '',
  email: '',
  organizationId: '',
  departmentId: '',
  roleIds: [] as string[],
  temporaryPassword: '',
})

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/

const departments = computed(() => {
  const org = admin.organizations.find((o) => o.id === form.organizationId)
  return org?.departments ?? []
})

const organizationName = computed(
  () => admin.organizations.find((o) => o.id === form.organizationId)?.name ?? 'None',
)
const departmentName = computed(
  () => departments.value.find((d) => d.id === form.departmentId)?.name ?? 'None',
)
const roleNames = computed(() =>
  admin.roles.filter((r) => form.roleIds.includes(r.id)).map((r) => r.name),
)

const isLast = computed(() => current.value === steps.length - 1)

function validateStep(index: number): string | null {
  const key = steps[index].key
  if (key === 'identity') {
    if (!form.firstName.trim() || !form.lastName.trim()) return 'Enter the first and last name.'
    if (!EMAIL_PATTERN.test(form.email.trim())) return 'Enter a valid email address.'
  }
  if (key === 'role' && form.roleIds.length === 0) {
    return 'Select at least one role. A role is what grants permissions.'
  }
  if (key === 'security' && form.temporaryPassword.length < 12) {
    return 'The temporary password must be at least 12 characters.'
  }
  return null
}

function next() {
  const problem = validateStep(current.value)
  stepError.value = problem
  if (problem) return
  if (current.value < steps.length - 1) current.value += 1
}

function back() {
  stepError.value = null
  if (current.value > 0) current.value -= 1
}

function jumpTo(index: number) {
  if (index <= current.value) {
    stepError.value = null
    current.value = index
  }
}

function setOrganization(id: string) {
  form.organizationId = id
  form.departmentId = ''
}

function toggleRole(id: string) {
  const idx = form.roleIds.indexOf(id)
  if (idx === -1) form.roleIds.push(id)
  else form.roleIds.splice(idx, 1)
}

function generatePassword() {
  const bytes = new Uint8Array(18)
  crypto.getRandomValues(bytes)
  const raw = btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, '9')
    .replace(/\//g, '8')
    .replace(/=/g, '')
  form.temporaryPassword = `Bp-${raw}!`
}

async function copy(text: string, which: 'password' | 'email') {
  try {
    await navigator.clipboard.writeText(text)
    copied.value = which
    setTimeout(() => {
      if (copied.value === which) copied.value = null
    }, 1500)
  } catch {
    // Clipboard can be blocked by the browser; the value stays visible to copy by hand.
  }
}

async function submit() {
  stepError.value = null
  submitting.value = true
  try {
    const user = await admin.createUser({
      email: form.email.trim(),
      firstName: form.firstName.trim(),
      lastName: form.lastName.trim(),
      temporaryPassword: form.temporaryPassword,
      roleIds: form.roleIds,
      organizationId: form.organizationId || undefined,
      departmentId: form.departmentId || undefined,
    })
    created.value = user
    emit('created', user)
  } catch (err) {
    stepError.value =
      err instanceof ApiError && err.statusCode === 409
        ? 'A user with this email already exists. Go back and use a different email.'
        : err instanceof ApiError
          ? err.message
          : 'Unable to create the account. Try again.'
  } finally {
    submitting.value = false
  }
}

generatePassword()
</script>

<template>
  <div class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 px-4" role="dialog" aria-modal="true" aria-labelledby="wizard-title">
    <div class="card flex max-h-[92vh] w-full max-w-2xl flex-col p-0">
      <!-- Header with step indicator -->
      <div class="border-b border-slate-200 px-6 pb-4 pt-5">
        <div class="flex items-center justify-between">
          <h2 id="wizard-title" class="section-title">{{ created ? 'Account created' : 'Create user account' }}</h2>
          <button type="button" class="btn btn-ghost btn-sm" aria-label="Close" @click="emit('close')">
            <X class="h-4 w-4" />
          </button>
        </div>

        <ol v-if="!created" class="mt-4 flex flex-wrap gap-2" aria-label="Steps">
          <li v-for="(step, i) in steps" :key="step.key">
            <button
              type="button"
              class="flex items-center gap-2 rounded-full px-3 py-1 text-xs font-medium"
              :class="
                i === current
                  ? 'bg-brand-800 text-white'
                  : i < current
                    ? 'bg-emerald-50 text-emerald-800'
                    : 'bg-slate-100 text-slate-500'
              "
              :aria-current="i === current ? 'step' : undefined"
              :disabled="i > current"
              @click="jumpTo(i)"
            >
              <Check v-if="i < current" class="h-3 w-3" />
              <span>{{ i + 1 }}. {{ step.label }}</span>
            </button>
          </li>
        </ol>
      </div>

      <div class="flex-1 overflow-y-auto px-6 py-5">
        <!-- Success -->
        <div v-if="created" class="space-y-5">
          <div class="rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-sm text-emerald-900">
            <p class="font-semibold">Account created successfully.</p>
            <p class="mt-1">Share the sign-in details below with {{ created.firstName }} through a secure channel.</p>
          </div>
          <dl class="grid gap-3 text-sm sm:grid-cols-2">
            <div>
              <dt class="text-slate-500">Name</dt>
              <dd class="font-medium">{{ created.firstName }} {{ created.lastName }}</dd>
            </div>
            <div>
              <dt class="text-slate-500">Email</dt>
              <dd class="flex items-center gap-2 font-medium">
                {{ created.email }}
                <button type="button" class="btn btn-ghost btn-sm" title="Copy email" @click="copy(created.email, 'email')">
                  <Check v-if="copied === 'email'" class="h-3.5 w-3.5 text-emerald-600" />
                  <Copy v-else class="h-3.5 w-3.5" />
                </button>
              </dd>
            </div>
            <div>
              <dt class="text-slate-500">Temporary password</dt>
              <dd class="flex items-center gap-2 font-mono text-sm">
                {{ form.temporaryPassword }}
                <button type="button" class="btn btn-ghost btn-sm" title="Copy password" @click="copy(form.temporaryPassword, 'password')">
                  <Check v-if="copied === 'password'" class="h-3.5 w-3.5 text-emerald-600" />
                  <Copy v-else class="h-3.5 w-3.5" />
                </button>
              </dd>
            </div>
            <div>
              <dt class="text-slate-500">Status</dt>
              <dd class="font-medium">{{ created.status }}</dd>
            </div>
          </dl>
          <ol class="list-decimal space-y-1 pl-5 text-sm text-slate-700">
            <li>The user signs in with the email and temporary password above.</li>
            <li>They then open Security and enable an authenticator app.</li>
            <li>Until they do, the account has no second factor.</li>
          </ol>
          <p class="text-xs text-slate-500">
            The password is shown only now. It is not stored in readable form, so copy it before closing this window.
          </p>
        </div>

        <!-- Steps -->
        <form v-else class="space-y-5" @submit.prevent="isLast ? submit() : next()">
          <section v-if="steps[current].key === 'identity'" class="grid gap-4 sm:grid-cols-2" aria-label="Identity">
            <div>
              <label class="field-label" for="uw-first">First name</label>
              <input id="uw-first" v-model="form.firstName" class="input mt-1" autocomplete="off" required />
            </div>
            <div>
              <label class="field-label" for="uw-last">Last name</label>
              <input id="uw-last" v-model="form.lastName" class="input mt-1" autocomplete="off" required />
            </div>
            <div class="sm:col-span-2">
              <label class="field-label" for="uw-email">Work email</label>
              <input id="uw-email" v-model="form.email" type="email" class="input mt-1" autocomplete="off" required />
              <p class="mt-1 text-xs text-slate-500">This is the sign-in name.</p>
            </div>
          </section>

          <section v-else-if="steps[current].key === 'organization'" class="space-y-3" aria-label="Organization">
            <p class="text-sm text-slate-600">Which organization does this person belong to?</p>
            <label
              v-for="org in admin.organizations"
              :key="org.id"
              class="flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm"
              :class="form.organizationId === org.id ? 'border-brand-600 bg-brand-50' : 'border-slate-200 hover:bg-slate-50'"
            >
              <input
                type="radio"
                name="org"
                :checked="form.organizationId === org.id"
                class="text-brand-700"
                @change="setOrganization(org.id)"
              />
              <span class="font-medium">{{ org.name }}</span>
              <span class="text-xs text-slate-500">{{ org.code }}</span>
            </label>
            <label class="flex cursor-pointer items-center gap-3 rounded-lg border border-slate-200 p-3 text-sm hover:bg-slate-50">
              <input type="radio" name="org" :checked="form.organizationId === ''" @change="setOrganization('')" />
              <span class="text-slate-600">No organization for now</span>
            </label>
          </section>

          <section v-else-if="steps[current].key === 'department'" class="space-y-3" aria-label="Department">
            <p class="text-sm text-slate-600">Which department?</p>
            <p v-if="!form.organizationId" class="rounded-md bg-slate-50 p-3 text-sm text-slate-500">
              Choose an organization first, or skip this step.
            </p>
            <div v-else class="grid gap-2 sm:grid-cols-2">
              <label
                v-for="dep in departments"
                :key="dep.id"
                class="flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm"
                :class="form.departmentId === dep.id ? 'border-brand-600 bg-brand-50' : 'border-slate-200 hover:bg-slate-50'"
              >
                <input
                  type="radio"
                  name="dep"
                  :checked="form.departmentId === dep.id"
                  @change="form.departmentId = dep.id"
                />
                <span>{{ dep.name }}</span>
              </label>
            </div>
          </section>

          <section v-else-if="steps[current].key === 'role'" class="space-y-3" aria-label="Role">
            <p class="text-sm text-slate-600">
              Choose the role(s). A role is the only way permissions are granted, so review what each one allows in
              <router-link to="/admin/roles" class="font-medium text-brand-700 hover:underline">Roles &amp; Permissions</router-link>.
            </p>
            <div class="grid gap-2 sm:grid-cols-2">
              <label
                v-for="role in admin.roles"
                :key="role.id"
                class="flex cursor-pointer items-center gap-3 rounded-lg border p-3 text-sm"
                :class="form.roleIds.includes(role.id) ? 'border-brand-600 bg-brand-50' : 'border-slate-200 hover:bg-slate-50'"
              >
                <input
                  type="checkbox"
                  :checked="form.roleIds.includes(role.id)"
                  class="rounded border-slate-300 text-brand-700"
                  @change="toggleRole(role.id)"
                />
                <span>{{ role.name }}</span>
              </label>
            </div>
          </section>

          <section v-else-if="steps[current].key === 'security'" class="space-y-3" aria-label="Security">
            <p class="text-sm text-slate-600">
              Set a temporary password. Share it securely; the user should change it at first sign-in and then enable an
              authenticator app.
            </p>
            <div class="flex gap-2">
              <input
                v-model="form.temporaryPassword"
                class="input font-mono"
                minlength="12"
                aria-label="Temporary password"
                autocomplete="off"
                required
              />
              <button type="button" class="btn btn-secondary flex-none" title="Generate a new password" @click="generatePassword">
                <RefreshCw class="h-4 w-4" />
                Generate
              </button>
            </div>
            <p class="text-xs text-slate-500">At least 12 characters. A generated value is recommended.</p>
          </section>

          <section v-else class="space-y-4" aria-label="Review">
            <p class="text-sm text-slate-600">Check the details before creating the account.</p>
            <dl class="divide-y divide-slate-100 rounded-lg border border-slate-200 text-sm">
              <div class="grid grid-cols-3 gap-2 p-3">
                <dt class="text-slate-500">Name</dt>
                <dd class="col-span-2 font-medium">{{ form.firstName }} {{ form.lastName }}</dd>
              </div>
              <div class="grid grid-cols-3 gap-2 p-3">
                <dt class="text-slate-500">Email</dt>
                <dd class="col-span-2 font-medium">{{ form.email }}</dd>
              </div>
              <div class="grid grid-cols-3 gap-2 p-3">
                <dt class="text-slate-500">Organization</dt>
                <dd class="col-span-2">{{ organizationName }}</dd>
              </div>
              <div class="grid grid-cols-3 gap-2 p-3">
                <dt class="text-slate-500">Department</dt>
                <dd class="col-span-2">{{ departmentName }}</dd>
              </div>
              <div class="grid grid-cols-3 gap-2 p-3">
                <dt class="text-slate-500">Roles</dt>
                <dd class="col-span-2">
                  <span v-for="name in roleNames" :key="name" class="badge badge-info mr-1">{{ name }}</span>
                </dd>
              </div>
              <div class="grid grid-cols-3 gap-2 p-3">
                <dt class="text-slate-500">MFA</dt>
                <dd class="col-span-2">Not enabled — the user enables it after first sign-in</dd>
              </div>
            </dl>
          </section>

          <p v-if="stepError" class="alert-error" role="alert">{{ stepError }}</p>

          <div class="flex items-center justify-between gap-2 border-t border-slate-200 pt-4">
            <button type="button" class="btn btn-secondary" :disabled="current === 0 || submitting" @click="back">
              <ArrowLeft class="h-4 w-4" />
              Back
            </button>
            <button v-if="!isLast" type="submit" class="btn btn-primary">
              Continue
              <ArrowRight class="h-4 w-4" />
            </button>
            <button v-else type="submit" class="btn btn-primary" :disabled="submitting">
              <Loader2 v-if="submitting" class="h-4 w-4 animate-spin" />
              Create account
            </button>
          </div>
        </form>
      </div>

      <div v-if="created" class="flex justify-end gap-2 border-t border-slate-200 px-6 py-4">
        <button type="button" class="btn btn-primary" @click="emit('close')">Done</button>
      </div>
    </div>
  </div>
</template>
