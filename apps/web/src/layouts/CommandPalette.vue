<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { useRouter } from 'vue-router'
import { Search } from '@lucide/vue'
import { useAuthStore } from '../stores/auth'
import { ACCOUNT_ITEMS, allNavItems, type NavItem } from './navigation'
import { useShell } from './useShell'

const router = useRouter()
const auth = useAuthStore()
const { paletteOpen, drawerOpen } = useShell()

const query = ref('')
const active = ref(0)
const input = ref<HTMLInputElement | null>(null)

// Navigation only. Searching records (projects, contracts, suppliers) needs a
// backend search endpoint that does not exist yet, so this does not pretend to.
const entries = computed<NavItem[]>(() => {
  const pages = allNavItems().filter((i) => !i.permission || auth.hasPermission(i.permission))
  return [...pages, ...ACCOUNT_ITEMS]
})

const results = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return entries.value
  return entries.value.filter((i) => i.label.toLowerCase().includes(q) || i.to.toLowerCase().includes(q))
})

watch(paletteOpen, async (open) => {
  if (open) {
    query.value = ''
    active.value = 0
    drawerOpen.value = false
    await nextTick()
    input.value?.focus()
  }
})

watch(results, () => {
  active.value = 0
})

function close() {
  paletteOpen.value = false
}

function choose(item: NavItem | undefined) {
  if (!item) return
  close()
  void router.push(item.to)
}

function onKeydown(event: KeyboardEvent) {
  if (event.key === 'ArrowDown') {
    event.preventDefault()
    active.value = Math.min(active.value + 1, Math.max(results.value.length - 1, 0))
  } else if (event.key === 'ArrowUp') {
    event.preventDefault()
    active.value = Math.max(active.value - 1, 0)
  } else if (event.key === 'Enter') {
    event.preventDefault()
    choose(results.value[active.value])
  }
}
</script>

<template>
  <div
    v-if="paletteOpen"
    class="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 px-4 pt-[12vh]"
    @mousedown.self="close"
  >
    <div
      role="dialog"
      aria-modal="true"
      aria-label="Go to a page"
      class="w-full max-w-lg overflow-hidden rounded-xl border border-slate-200 bg-white shadow-card-lg"
    >
      <div class="flex items-center gap-3 border-b border-slate-200 px-4">
        <Search class="h-4 w-4 flex-none text-slate-400" aria-hidden="true" />
        <input
          ref="input"
          v-model="query"
          type="search"
          class="h-12 w-full bg-transparent text-sm text-slate-900 placeholder:text-slate-400 focus:outline-none"
          placeholder="Go to a page…"
          aria-label="Go to a page"
          aria-controls="palette-results"
          :aria-activedescendant="results[active] ? `palette-${results[active].to}` : undefined"
          role="combobox"
          aria-expanded="true"
          aria-autocomplete="list"
          autocomplete="off"
          @keydown="onKeydown"
        />
        <kbd class="hidden rounded border border-slate-200 px-1.5 py-0.5 text-[11px] text-slate-500 sm:inline">Esc</kbd>
      </div>

      <ul id="palette-results" role="listbox" class="max-h-80 overflow-y-auto p-2">
        <li v-if="results.length === 0" class="px-3 py-6 text-center text-sm text-slate-500">
          No page matches “{{ query }}”.
        </li>
        <li
          v-for="(item, i) in results"
          :id="`palette-${item.to}`"
          :key="item.to"
          role="option"
          :aria-selected="i === active"
          class="flex cursor-pointer items-center gap-3 rounded-md px-3 py-2 text-sm"
          :class="i === active ? 'bg-brand-50 text-brand-800' : 'text-slate-700'"
          @mouseenter="active = i"
          @click="choose(item)"
        >
          <component :is="item.icon" class="h-4 w-4 flex-none text-slate-400" aria-hidden="true" />
          <span class="flex-1">{{ item.label }}</span>
          <span class="text-xs text-slate-400">{{ item.to }}</span>
        </li>
      </ul>
    </div>
  </div>
</template>
