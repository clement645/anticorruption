<script setup lang="ts">
import { CircleAlert, CircleCheck, Info, X } from '@lucide/vue'
import { dismiss, toasts } from './toast'
</script>

<template>
  <div class="pointer-events-none fixed bottom-4 right-4 z-[60] flex w-full max-w-sm flex-col gap-2 px-4 sm:px-0" aria-live="polite">
    <div
      v-for="t in toasts"
      :key="t.id"
      class="pointer-events-auto flex items-start gap-3 rounded-lg border bg-white px-4 py-3 text-sm shadow-card-lg"
      :class="t.tone === 'error' ? 'border-danger/30' : 'border-slate-200'"
      :role="t.tone === 'error' ? 'alert' : 'status'"
    >
      <CircleCheck v-if="t.tone === 'success'" class="mt-0.5 h-4 w-4 flex-none text-success" aria-hidden="true" />
      <CircleAlert v-else-if="t.tone === 'error'" class="mt-0.5 h-4 w-4 flex-none text-danger" aria-hidden="true" />
      <Info v-else class="mt-0.5 h-4 w-4 flex-none text-info" aria-hidden="true" />
      <p class="flex-1 text-slate-800">{{ t.message }}</p>
      <button type="button" class="rounded p-0.5 text-slate-400 hover:text-slate-700" aria-label="Dismiss" @click="dismiss(t.id)">
        <X class="h-3.5 w-3.5" aria-hidden="true" />
      </button>
    </div>
  </div>
</template>
