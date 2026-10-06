<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import QRCode from 'qrcode'
import { ShieldCheck, ShieldAlert, Copy, Check, Download } from '@lucide/vue'
import { useAuthStore } from '../stores/auth'
import { apiGet, apiPost, ApiError } from '../api/client'

const auth = useAuthStore()

interface SecurityStatus {
  mfaEnabled: boolean
}
interface SetupResponse {
  secret: string
  otpauthUrl: string
}
interface EnableResponse {
  backupCodes: string[]
}

const status = ref<SecurityStatus | null>(null)
const loading = ref(true)
const loadError = ref<string | null>(null)

// Enrollment state lives only in this component. The secret and backup codes
// are never written to browser storage, and they are cleared once enrollment
// is finished.
const enrolling = ref(false)
const setup = ref<SetupResponse | null>(null)
const qrDataUrl = ref<string | null>(null)
const code = ref('')
const busy = ref(false)
const enrollError = ref<string | null>(null)
const backupCodes = ref<string[] | null>(null)
const copied = ref<'secret' | 'codes' | null>(null)

const mfaEnabled = computed(() => status.value?.mfaEnabled === true)

const roleList = computed(() => (auth.user?.roles ?? []).join(', ') || 'None')

async function loadStatus() {
  loading.value = true
  loadError.value = null
  try {
    status.value = await apiGet<SecurityStatus>('/users/me/security')
  } catch (err) {
    loadError.value = err instanceof ApiError ? err.message : 'Unable to load security status'
  } finally {
    loading.value = false
  }
}

async function startEnrollment() {
  enrollError.value = null
  busy.value = true
  try {
    const response = await apiPost<SetupResponse>('/users/me/mfa/totp/setup')
    setup.value = response
    qrDataUrl.value = await QRCode.toDataURL(response.otpauthUrl, {
      width: 220,
      margin: 1,
      errorCorrectionLevel: 'M',
    })
    enrolling.value = true
    code.value = ''
  } catch (err) {
    enrollError.value = err instanceof ApiError ? err.message : 'Unable to start authenticator setup'
  } finally {
    busy.value = false
  }
}

async function confirmEnrollment() {
  if (!setup.value) return
  enrollError.value = null
  busy.value = true
  try {
    const response = await apiPost<EnableResponse>('/users/me/mfa/totp/enable', {
      code: code.value.trim(),
    })
    backupCodes.value = response.backupCodes
    setup.value = null
    qrDataUrl.value = null
    code.value = ''
    await loadStatus()
  } catch (err) {
    enrollError.value =
      err instanceof ApiError && err.statusCode === 400
        ? 'That code was not accepted. Check the time on your device and try the current code.'
        : err instanceof ApiError
          ? err.message
          : 'Unable to verify the code'
  } finally {
    busy.value = false
  }
}

function cancelEnrollment() {
  enrolling.value = false
  setup.value = null
  qrDataUrl.value = null
  code.value = ''
  enrollError.value = null
}

function finishEnrollment() {
  backupCodes.value = null
  enrolling.value = false
  copied.value = null
}

async function copy(text: string, which: 'secret' | 'codes') {
  try {
    await navigator.clipboard.writeText(text)
    copied.value = which
    setTimeout(() => {
      if (copied.value === which) copied.value = null
    }, 2000)
  } catch {
    enrollError.value = 'Copy failed. Select the text and copy it manually.'
  }
}

function downloadCodes() {
  if (!backupCodes.value) return
  const blob = new Blob(
    [
      'B-PFMPS recovery codes\n',
      'Each code can be used once in place of an authenticator code.\n\n',
      backupCodes.value.join('\n'),
      '\n',
    ],
    { type: 'text/plain' },
  )
  const url = URL.createObjectURL(blob)
  const link = document.createElement('a')
  link.href = url
  link.download = 'bpfmps-recovery-codes.txt'
  link.click()
  URL.revokeObjectURL(url)
}

onMounted(loadStatus)
</script>

<template>
  <div class="mx-auto max-w-4xl px-4 py-8 sm:px-6">
    <div class="mb-6">
      <h1 class="page-title">Security</h1>
      <p class="page-subtitle">Protect your account. Changes here take effect immediately.</p>
    </div>

    <div class="space-y-6">
      <!-- Account -->
      <section class="card" aria-labelledby="account-heading">
        <h2 id="account-heading" class="text-base font-semibold">Account</h2>
        <dl class="mt-4 grid gap-4 text-sm sm:grid-cols-2">
          <div>
            <dt class="text-slate-500">Email</dt>
            <dd class="mt-0.5 font-medium text-slate-900">{{ auth.user?.email ?? '—' }}</dd>
          </div>
          <div>
            <dt class="text-slate-500">Roles</dt>
            <dd class="mt-0.5 font-medium text-slate-900">{{ roleList }}</dd>
          </div>
        </dl>
      </section>

      <!-- Authenticator -->
      <section class="card" aria-labelledby="mfa-heading">
        <div class="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 id="mfa-heading" class="text-base font-semibold">Authenticator app</h2>
            <p class="mt-1 text-sm text-slate-500">
              Use Google Authenticator, Microsoft Authenticator, Authy, 1Password, or any standard TOTP app.
            </p>
          </div>

          <span
            v-if="!loading && status"
            class="badge"
            :class="mfaEnabled ? 'badge-success' : 'badge-warning'"
            role="status"
          >
            <ShieldCheck v-if="mfaEnabled" class="h-3.5 w-3.5" />
            <ShieldAlert v-else class="h-3.5 w-3.5" />
            {{ mfaEnabled ? 'Enabled' : 'Not enabled' }}
          </span>
        </div>

        <p v-if="loadError" class="alert-error mt-4" role="alert">{{ loadError }}</p>
        <p v-else-if="loading" class="mt-4 text-sm text-slate-500">Checking status…</p>

        <!-- Backup codes, shown once -->
        <div v-else-if="backupCodes" class="mt-6 space-y-4" aria-live="polite">
          <div class="rounded-lg border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
            <p class="font-semibold">Save these recovery codes now.</p>
            <p class="mt-1">
              They are shown only once. Each code works once, in place of an authenticator code, if you lose
              your device. We cannot show them again.
            </p>
          </div>
          <ol class="grid grid-cols-2 gap-2 font-mono text-sm sm:grid-cols-5">
            <li v-for="c in backupCodes" :key="c" class="rounded-md border border-slate-200 bg-white px-3 py-2">
              {{ c }}
            </li>
          </ol>
          <div class="flex flex-wrap gap-2">
            <button type="button" class="btn btn-secondary" @click="copy(backupCodes.join('\n'), 'codes')">
              <Check v-if="copied === 'codes'" class="h-4 w-4" />
              <Copy v-else class="h-4 w-4" />
              {{ copied === 'codes' ? 'Copied' : 'Copy codes' }}
            </button>
            <button type="button" class="btn btn-secondary" @click="downloadCodes">
              <Download class="h-4 w-4" />
              Download
            </button>
            <button type="button" class="btn btn-primary ml-auto" @click="finishEnrollment">
              I have saved my codes
            </button>
          </div>
        </div>

        <!-- Enrollment steps -->
        <div v-else-if="enrolling && setup" class="mt-6 grid gap-6 md:grid-cols-[240px_minmax(0,1fr)]">
          <div class="flex flex-col items-center gap-3">
            <img
              v-if="qrDataUrl"
              :src="qrDataUrl"
              width="220"
              height="220"
              alt="QR code for your authenticator app"
              class="rounded-lg border border-slate-200 bg-white p-2"
            />
            <p class="text-xs text-slate-500">Scan with your authenticator app</p>
          </div>

          <div class="space-y-5">
            <ol class="list-decimal space-y-1 pl-5 text-sm text-slate-700">
              <li>Open your authenticator app and choose “Add account”.</li>
              <li>Scan the QR code, or enter the setup key below.</li>
              <li>Type the 6-digit code the app shows, then confirm.</li>
            </ol>

            <div>
              <p class="text-xs font-medium uppercase tracking-wider text-slate-500">Setup key</p>
              <div class="mt-1 flex items-center gap-2">
                <code class="flex-1 break-all rounded-md bg-slate-100 px-3 py-2 text-sm">{{ setup.secret }}</code>
                <button type="button" class="btn btn-ghost btn-sm" @click="copy(setup.secret, 'secret')">
                  <Check v-if="copied === 'secret'" class="h-4 w-4" />
                  <Copy v-else class="h-4 w-4" />
                  <span class="sr-only">Copy setup key</span>
                </button>
              </div>
            </div>

            <form class="space-y-3" @submit.prevent="confirmEnrollment">
              <label class="block">
                <span class="text-sm font-medium">6-digit code</span>
                <input
                  v-model="code"
                  class="input mt-1 w-40 font-mono tracking-widest"
                  inputmode="numeric"
                  autocomplete="one-time-code"
                  pattern="[0-9]{6}"
                  maxlength="6"
                  required
                />
              </label>
              <p v-if="enrollError" class="alert-error" role="alert">{{ enrollError }}</p>
              <div class="flex gap-2">
                <button type="submit" class="btn btn-primary" :disabled="busy || code.length !== 6">
                  {{ busy ? 'Verifying…' : 'Confirm and enable' }}
                </button>
                <button type="button" class="btn btn-ghost" :disabled="busy" @click="cancelEnrollment">Cancel</button>
              </div>
            </form>
          </div>
        </div>

        <!-- Idle -->
        <div v-else class="mt-6 space-y-4">
          <p v-if="mfaEnabled" class="text-sm text-slate-600">
            Your account requires an authenticator code at sign-in. Replacing or removing it is not available yet;
            contact an administrator if you need that.
          </p>
          <p v-else class="text-sm text-slate-600">
            Turn on two-step sign-in. Your account will then ask for a code from your phone each time you sign in.
          </p>
          <p v-if="enrollError" class="alert-error" role="alert">{{ enrollError }}</p>
          <button
            v-if="!mfaEnabled"
            type="button"
            class="btn btn-primary"
            :disabled="busy"
            @click="startEnrollment"
          >
            {{ busy ? 'Preparing…' : 'Enable authenticator' }}
          </button>
        </div>
      </section>
    </div>
  </div>
</template>
