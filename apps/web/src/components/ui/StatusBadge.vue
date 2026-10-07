<script setup lang="ts">
import { computed } from 'vue'
import { CircleAlert, CircleCheck, CircleDot, CircleX, Clock, Lock, Circle } from '@lucide/vue'
import { statusFor, TONE_CLASSES, type Tone } from './status'

const props = defineProps<{ status: string; label?: string }>()

const definition = computed(() => statusFor(props.status))
const text = computed(() => props.label ?? definition.value.label)

// Icon and text carry the meaning too, so status is never colour alone.
const icons: Record<Tone, typeof Circle> = {
  neutral: Circle,
  info: CircleDot,
  success: CircleCheck,
  warning: Clock,
  danger: CircleX,
  critical: CircleAlert,
}
const icon = computed(() => (props.status === 'LOCKED' ? Lock : icons[definition.value.tone]))
</script>

<template>
  <span
    class="inline-flex items-center gap-1.5 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium ring-1 ring-inset"
    :class="TONE_CLASSES[definition.tone]"
  >
    <component :is="icon" class="h-3 w-3 flex-none" aria-hidden="true" />
    {{ text }}
  </span>
</template>
