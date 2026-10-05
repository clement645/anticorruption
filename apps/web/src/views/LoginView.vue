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
  <section class="grid min-h-[calc(100vh-65px)] lg:grid-cols-2">
    <!-- Branding panel -->
    <div class="relative hidden overflow-hidden bg-brand-900 px-12 py-16 lg:flex lg:flex-col lg:justify-between">
      <div
        class="pointer-events-none absolute inset-0 opacity-[0.07]"
        style="background-image: radial-gradient(circle at 1px 1px, white 1px, transparent 0); background-size: 28px 28px"
        aria-hidden="true"
      />
      <div class="relative">
        <div class="flex h-11 w-11 items-center justify-center rounded-md bg-white/10 ring-1 ring-white/20">
          <ShieldCheck class="h-5 w-5 text-accent-300" />
        </div>
        <p class="mt-2 text-[11px] font-medium uppercase tracking-wider text-accent-300">Republic of Kenya</p>
      </div>
      <div class="relative max-w-md">
        <h1 class="font-serif text-4xl font-semibold leading-tight text-white">
          Public financial management, made accountable by design.
        </h1>
        <p class="mt-5 text-sm leading-relaxed text-brand-200">
          Every budget, procurement, and payment action on this platform is signed, hash-chained, and
          independently verifiable — built to make unauthorized modification difficult and highly detectable.
        </p>
      </div>
      <p class="relative text-xs text-brand-300">Blockchain-Based Integrated Public Financial Management &amp; Procurement System</p>
    </div>

    <!-- Form panel -->
    <div class="flex items-center justify-center bg-slate-50 px-4 py-12 sm:px-6">
      <div class="w-full max-w-sm">
        <div class="mb-8 flex flex-col items-start lg:hidden">
          <div class="flex h-11 w-11 items-center justify-center rounded-md bg-brand-800 shadow-sm">
            <ShieldCheck class="h-5 w-5 text-white" />
          </div>
        </div>
        <h2 class="font-serif text-2xl font-semibold tracking-tight text-slate-900">Sign in</h2>
        <p class="mt-1 text-sm text-slate-500">Enter your credentials to access your portal.</p>

        <div class="card mt-6 p-6 sm:p-7">
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

            <p v-if="localError" class="alert-error">{{ localError }}</p>

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

            <p v-if="localError" class="alert-error">{{ localError }}</p>

            <button type="submit" :disabled="submitting" class="btn btn-primary w-full">
              <Loader2 v-if="submitting" class="h-4 w-4 animate-spin" />
              {{ submitting ? 'Verifying…' : 'Verify' }}
            </button>
          </form>
        </div>

        <p class="mt-6 text-center text-xs text-slate-400">
          Authorised personnel only. Access is logged and monitored.
        </p>
      </div>
    </div>
  </section>
</template>
