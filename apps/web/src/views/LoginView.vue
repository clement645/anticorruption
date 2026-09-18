<script setup lang="ts">
import { ref } from 'vue'
import { useRouter } from 'vue-router'
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
  <section class="mx-auto flex min-h-[70vh] max-w-md flex-col justify-center px-4">
    <h1 class="text-xl font-semibold text-slate-900">Sign in to B-PFMPS</h1>
    <p class="mt-1 text-sm text-slate-600">DEMO/TEST credentials only — see IMPLEMENTATION_PLAN.md.</p>

    <form
      v-if="stage === 'credentials'"
      class="mt-6 space-y-4"
      @submit.prevent="submitCredentials"
    >
      <div>
        <label for="email" class="block text-sm font-medium text-slate-700">Email</label>
        <input
          id="email"
          v-model="email"
          type="email"
          required
          autocomplete="username"
          class="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-slate-500 focus:outline-none"
        />
      </div>
      <div>
        <label for="password" class="block text-sm font-medium text-slate-700">Password</label>
        <input
          id="password"
          v-model="password"
          type="password"
          required
          autocomplete="current-password"
          class="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-slate-500 focus:outline-none"
        />
      </div>

      <p v-if="localError" class="text-sm text-red-700">{{ localError }}</p>

      <button
        type="submit"
        :disabled="submitting"
        class="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {{ submitting ? 'Signing in…' : 'Sign in' }}
      </button>
    </form>

    <form v-else class="mt-6 space-y-4" @submit.prevent="submitMfa">
      <div>
        <label for="mfaCode" class="block text-sm font-medium text-slate-700">
          Authenticator code or backup code
        </label>
        <input
          id="mfaCode"
          v-model="mfaCode"
          type="text"
          required
          autocomplete="one-time-code"
          class="mt-1 block w-full rounded-md border border-slate-300 px-3 py-2 text-sm shadow-sm focus:border-slate-500 focus:outline-none"
        />
      </div>

      <p v-if="localError" class="text-sm text-red-700">{{ localError }}</p>

      <button
        type="submit"
        :disabled="submitting"
        class="w-full rounded-md bg-slate-900 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-50"
      >
        {{ submitting ? 'Verifying…' : 'Verify' }}
      </button>
    </form>
  </section>
</template>
