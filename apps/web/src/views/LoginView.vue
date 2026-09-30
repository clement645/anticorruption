<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
import { ShieldCheck, Loader2 } from '@lucide/vue'
import { useAuthStore } from '../stores/auth'

const auth = useAuthStore()
const router = useRouter()

const email = ref('')
const password = ref('')
const mfaCode = ref('')
const stage = ref<'credentials' | 'mfa'>('credentials')
const submitting = ref(false)
const localError = ref<string | null>(null)

async function submitCredentials() {
  localError.value = null
  submitting.value = true
  try {
    const result = await auth.login(email.value, password.value)
    if (result === 'mfa_required') {
      stage.value = 'mfa'
    } else {
      await router.push('/')
    }
  } catch {
    localError.value = auth.error ?? 'Unable to sign in'
  } finally {
    submitting.value = false
  }
}

async function submitMfa() {
  localError.value = null
  submitting.value = true
  try {
    await auth.verifyMfa(mfaCode.value)
    await router.push('/')
  } catch {
    localError.value = auth.error ?? 'Invalid code'
  } finally {
    submitting.value = false
  }
}
</script>

<template>
  <section class="flex min-h-[calc(100vh-65px)] items-center justify-center bg-slate-50 px-4 py-12">
    <div class="w-full max-w-md">
      <div class="mb-6 flex flex-col items-center text-center">
        <div class="flex h-12 w-12 items-center justify-center rounded-xl bg-brand-600 shadow-sm">
          <ShieldCheck class="h-6 w-6 text-white" />
        </div>
        <h1 class="mt-4 text-xl font-semibold tracking-tight text-slate-900">Sign in to B-PFMPS</h1>
        <p class="mt-1 text-sm text-slate-500">
          Blockchain-Based Integrated Public Financial Management &amp; Procurement System
        </p>
      </div>

      <div class="card p-6 sm:p-8">
        <form
          v-if="stage === 'credentials'"
          class="space-y-4"
          @submit.prevent="submitCredentials"
        >
          <div>
            <label for="email" class="field-label">Email</label>
            <input
              id="email"
              v-model="email"
              type="email"
              required
              autocomplete="username"
              class="input mt-1"
            />
          </div>
          <div>
            <label for="password" class="field-label">Password</label>
            <input
              id="password"
              v-model="password"
              type="password"
              required
              autocomplete="current-password"
              class="input mt-1"
            />
          </div>

          <p v-if="localError" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{{ localError }}</p>

          <button type="submit" :disabled="submitting" class="btn btn-primary w-full">
            <Loader2 v-if="submitting" class="h-4 w-4 animate-spin" />
            {{ submitting ? 'Signing in…' : 'Sign in' }}
          </button>
        </form>

        <form v-else class="space-y-4" @submit.prevent="submitMfa">
          <div>
            <label for="mfaCode" class="field-label">Authenticator code or backup code</label>
            <input
              id="mfaCode"
              v-model="mfaCode"
              type="text"
              required
              autocomplete="one-time-code"
              class="input mt-1"
            />
          </div>

          <p v-if="localError" class="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{{ localError }}</p>

          <button type="submit" :disabled="submitting" class="btn btn-primary w-full">
            <Loader2 v-if="submitting" class="h-4 w-4 animate-spin" />
            {{ submitting ? 'Verifying…' : 'Verify' }}
          </button>
        </form>
      </div>

      <p class="mt-6 text-center text-xs text-slate-400">
        DEMO/TEST credentials only — see IMPLEMENTATION_PLAN.md.
      </p>
    </div>
  </section>
</template>
