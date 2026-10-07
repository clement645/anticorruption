<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'

const props = withDefaults(
  defineProps<{
    open: boolean
    title: string
    message: string
    confirmLabel?: string
    cancelLabel?: string
    /** Destructive or irreversible actions use danger styling and default focus on Cancel. */
    tone?: 'default' | 'danger'
    busy?: boolean
  }>(),
  { confirmLabel: 'Confirm', cancelLabel: 'Cancel', tone: 'default', busy: false },
)

const emit = defineEmits<{ confirm: []; cancel: [] }>()

const dialog = ref<HTMLElement | null>(null)
const cancelButton = ref<HTMLButtonElement | null>(null)
const confirmButton = ref<HTMLButtonElement | null>(null)
let returnFocus: HTMLElement | null = null

watch(
  () => props.open,
  async (open) => {
    if (open) {
      returnFocus = document.activeElement as HTMLElement | null
      await nextTick()
      if (props.tone === 'danger') cancelButton.value?.focus()
      else confirmButton.value?.focus()
    } else {
      returnFocus?.focus?.()
      returnFocus = null
    }
  },
  { immediate: true },
)

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'Escape' && !props.busy) {
    event.preventDefault()
    emit('cancel')
    return
  }
  if (event.key === 'Tab' && dialog.value) {
    // Keep keyboard focus inside the dialog while it is open.
    const focusable = Array.from(
      dialog.value.querySelectorAll<HTMLElement>('button:not([disabled])'),
    )
    if (focusable.length === 0) return
    const first = focusable[0]
    const last = focusable[focusable.length - 1]
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault()
      last.focus()
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault()
      first.focus()
    }
  }
}
</script>

<template>
  <div
    v-if="open"
    class="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/40 px-4"
    @mousedown.self="!busy && emit('cancel')"
  >
    <div
      ref="dialog"
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="confirm-title"
      aria-describedby="confirm-message"
      class="w-full max-w-md rounded-xl border border-slate-200 bg-white p-6 shadow-card-lg"
      @keydown="onKeydown"
    >
      <h2 id="confirm-title" class="text-base font-semibold text-slate-900">{{ title }}</h2>
      <p id="confirm-message" class="mt-2 text-sm text-slate-600">{{ message }}</p>
      <div v-if="$slots.default" class="mt-4">
        <slot />
      </div>
      <div class="mt-6 flex justify-end gap-2">
        <button ref="cancelButton" type="button" class="btn btn-secondary" :disabled="busy" @click="emit('cancel')">
          {{ cancelLabel }}
        </button>
        <button
          ref="confirmButton"
          type="button"
          class="btn"
          :class="tone === 'danger' ? 'btn-danger' : 'btn-primary'"
          :disabled="busy"
          @click="emit('confirm')"
        >
          {{ busy ? 'Working…' : confirmLabel }}
        </button>
      </div>
    </div>
  </div>
</template>
