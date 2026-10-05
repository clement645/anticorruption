<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { cancelStepUp, stepUpState, submitStepUpCode } from '../lib/stepUp'

const code = ref('')
const input = ref<HTMLInputElement | null>(null)

watch(
  () => stepUpState.open,
  async (open) => {
    if (open) {
      code.value = ''
      await nextTick()
      input.value?.focus()
    }
  },
)

async function onSubmit() {
  await submitStepUpCode(code.value.trim())
}
</script>

<template>
  <div
    v-if="stepUpState.open"
    class="fixed inset-0 z-50 flex items-center justify-center bg-brand-900/50 p-4"
    role="dialog"
    aria-modal="true"
    aria-labelledby="step-up-title"
  >
    <form class="card w-full max-w-sm space-y-4" @submit.prevent="onSubmit">
      <div>
        <h2 id="step-up-title" class="text-lg font-semibold">Confirm it's you</h2>
        <p class="mt-1 text-sm text-brand-600">
          This action needs a fresh code from your authenticator app.
        </p>
      </div>

      <label class="block text-sm font-medium" for="step-up-code">Authenticator code</label>
      <input
        id="step-up-code"
        ref="input"
        v-model="code"
        class="input font-mono tracking-widest"
        inputmode="numeric"
        autocomplete="one-time-code"
        maxlength="8"
        required
      />

      <p v-if="stepUpState.error" class="alert-error" role="alert">{{ stepUpState.error }}</p>

      <div class="flex justify-end gap-2">
        <button type="button" class="btn" :disabled="stepUpState.busy" @click="cancelStepUp">
          Cancel
        </button>
        <button type="submit" class="btn btn-primary" :disabled="stepUpState.busy || !code">
          {{ stepUpState.busy ? 'Verifying…' : 'Verify' }}
        </button>
      </div>
    </form>
  </div>
</template>
