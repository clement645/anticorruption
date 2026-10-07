<script setup lang="ts">
import { computed } from 'vue'
import { CircleAlert, CircleCheck, Info, TriangleAlert } from '@lucide/vue'

const props = withDefaults(defineProps<{ tone?: 'error' | 'success' | 'info' | 'warning'; title?: string }>(), {
  tone: 'error',
  title: '',
})

const styles = {
  error: { box: 'border-danger/30 bg-danger-soft text-danger', icon: CircleAlert },
  success: { box: 'border-success/30 bg-success-soft text-success', icon: CircleCheck },
  info: { box: 'border-info/25 bg-info-soft text-info', icon: Info },
  warning: { box: 'border-warning/30 bg-warning-soft text-warning', icon: TriangleAlert },
}
const current = computed(() => styles[props.tone])
</script>

<template>
  <div
    class="flex gap-3 rounded-md border px-4 py-3 text-sm"
    :class="current.box"
    :role="tone === 'error' ? 'alert' : 'status'"
  >
    <component :is="current.icon" class="mt-0.5 h-4 w-4 flex-none" aria-hidden="true" />
    <div class="min-w-0 space-y-0.5">
      <p v-if="title" class="font-semibold">{{ title }}</p>
      <div class="text-slate-800">
        <slot />
      </div>
    </div>
  </div>
</template>
