<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { Eye, Megaphone, PanelLeftClose, PanelLeftOpen } from '@lucide/vue'
import { useAuthStore } from '../stores/auth'
import { NAV_GROUPS, type NavItem } from './navigation'
import { useShell } from './useShell'

const appName = import.meta.env.VITE_APP_NAME ?? 'B-PFMPS'
const auth = useAuthStore()
const route = useRoute()
const { collapsed, drawerOpen, toggleCollapsed, labelClass } = useShell()

// Permission-aware: items the user cannot use are removed, not greyed out.
// The backend remains the authority on what each route actually allows.
const visibleGroups = computed(() =>
  NAV_GROUPS.map((group) => ({
    ...group,
    items: group.items.filter((item) => !item.permission || auth.hasPermission(item.permission)),
  })).filter((group) => group.items.length > 0),
)

function isActive(item: NavItem) {
  return item.to === '/' ? route.path === '/' : route.path === item.to || route.path.startsWith(`${item.to}/`)
}

function closeDrawer() {
  drawerOpen.value = false
}
</script>

<template>
  <aside
    class="fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-slate-200 bg-white transition-[transform,width] duration-200 motion-reduce:transition-none lg:static lg:translate-x-0"
    :class="[drawerOpen ? 'translate-x-0' : '-translate-x-full', collapsed ? 'lg:w-16' : 'lg:w-64']"
    aria-label="Application"
  >
    <div class="flex h-16 flex-none items-center gap-2.5 border-b border-slate-200 px-4">
      <div class="flex h-8 w-8 flex-none items-center justify-center rounded-md bg-brand-800 font-serif text-sm font-bold text-white">
        B
      </div>
      <div class="min-w-0" :class="labelClass">
        <span class="block truncate text-sm font-semibold tracking-tight text-slate-900">{{ appName }}</span>
        <span class="block text-[10px] font-medium uppercase tracking-wider text-accent-600">Republic of Kenya</span>
      </div>
    </div>

    <nav class="flex-1 overflow-y-auto px-2.5 py-4" aria-label="Main navigation">
      <div v-for="group in visibleGroups" :key="group.label" class="mb-5">
        <p
          class="px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400"
          :class="labelClass"
        >
          {{ group.label }}
        </p>
        <router-link
          v-for="item in group.items"
          :key="item.to"
          :to="item.to"
          class="mb-0.5 flex items-center gap-3 rounded-md px-2.5 py-2 text-sm font-medium transition-colors duration-150 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-brand-600"
          :class="
            isActive(item)
              ? 'bg-brand-50 text-brand-800'
              : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
          "
          :aria-current="isActive(item) ? 'page' : undefined"
          :title="item.label"
          @click="closeDrawer"
        >
          <component
            :is="item.icon"
            class="h-[18px] w-[18px] flex-none"
            :class="isActive(item) ? 'text-brand-700' : 'text-slate-400'"
            aria-hidden="true"
          />
          <span class="truncate" :class="labelClass">{{ item.label }}</span>
        </router-link>
      </div>

      <div class="mt-2 border-t border-slate-100 pt-4">
        <p class="px-2.5 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400" :class="labelClass">
          Public
        </p>
        <router-link
          to="/transparency"
          class="mb-0.5 flex items-center gap-3 rounded-md px-2.5 py-2 text-sm font-medium text-slate-600 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-900"
          :title="'Transparency portal'"
          @click="closeDrawer"
        >
          <Eye class="h-[18px] w-[18px] flex-none text-slate-400" aria-hidden="true" />
          <span class="truncate" :class="labelClass">Transparency portal</span>
        </router-link>
        <router-link
          to="/report-a-concern"
          class="flex items-center gap-3 rounded-md px-2.5 py-2 text-sm font-medium text-slate-600 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-900"
          :title="'Report a concern'"
          @click="closeDrawer"
        >
          <Megaphone class="h-[18px] w-[18px] flex-none text-slate-400" aria-hidden="true" />
          <span class="truncate" :class="labelClass">Report a concern</span>
        </router-link>
      </div>
    </nav>

    <div class="hidden flex-none border-t border-slate-200 p-2.5 lg:block">
      <button
        type="button"
        class="flex w-full items-center gap-3 rounded-md px-2.5 py-2 text-sm font-medium text-slate-600 transition-colors duration-150 hover:bg-slate-100 hover:text-slate-900"
        :aria-label="collapsed ? 'Expand navigation' : 'Collapse navigation'"
        :aria-expanded="!collapsed"
        :title="collapsed ? 'Expand navigation' : 'Collapse navigation'"
        @click="toggleCollapsed"
      >
        <PanelLeftOpen v-if="collapsed" class="h-[18px] w-[18px] flex-none text-slate-400" aria-hidden="true" />
        <PanelLeftClose v-else class="h-[18px] w-[18px] flex-none text-slate-400" aria-hidden="true" />
        <span :class="labelClass">Collapse</span>
      </button>
    </div>
  </aside>
</template>
