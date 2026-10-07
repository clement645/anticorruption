<script setup lang="ts">
withDefaults(defineProps<{ rows?: number; columns?: number }>(), { rows: 4, columns: 4 })
</script>

<template>
  <div class="animate-pulse motion-reduce:animate-none space-y-3 p-4" role="status" aria-label="Loading">
    <div v-for="r in rows" :key="r" class="grid gap-4" :style="{ gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` }">
      <div v-for="c in columns" :key="c" class="h-3.5 rounded bg-slate-200" :class="c === 1 ? 'w-3/4' : 'w-full'" />
    </div>
    <span class="sr-only">Loading…</span>
  </div>
</template>
