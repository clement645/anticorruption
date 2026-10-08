<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import { Menu, X, Search, ChevronDown, LogOut, ShieldCheck, ShieldAlert } from '@lucide/vue'
import { useAuthStore } from '../stores/auth'
import { apiGet } from '../api/client'
import { ACCOUNT_ITEMS, breadcrumbsFor, titleFor } from './navigation'
import { useShell } from './useShell'

interface SecurityStatus {
  mfaEnabled: boolean
}
interface OrgSummary {
  id: string
  name: string
  departments: Array<{ id: string; name: string }>
}

const auth = useAuthStore()
const route = useRoute()
const router = useRouter()
const { drawerOpen, openPalette } = useShell()

const userMenuOpen = ref(false)
const mfaEnabled = ref<boolean | null>(null)
const orgContext = ref<{ org: string; department: string | null } | null>(null)

const crumbs = computed(() => breadcrumbsFor(route.path))
// A dynamic route (e.g. /suppliers/:id) has no exact entry in the nav/title
// map, so fall back to its own last breadcrumb ("Details") before the app
// name — the page itself already shows the specific record's name as its
// own heading, so this only needs to orient, not duplicate that.
const pageTitle = computed(() => {
  const exact = titleFor(route.path)
  if (exact) return exact
  const trail = crumbs.value
  return trail.length > 0 ? trail[trail.length - 1].label : 'B-PFMPS'
})
const initials = computed(() => (auth.user?.email ?? '').slice(0, 2).toUpperCase())
const primaryRole = computed(() => auth.user?.roles?.[0] ?? '—')

async function loadSecurityStatus() {
  try {
    const status = await apiGet<SecurityStatus>('/users/me/security')
    mfaEnabled.value = status.mfaEnabled
  } catch {
    // Unknown is shown as unknown rather than guessed.
    mfaEnabled.value = null
  }
}

async function loadOrgContext() {
  const orgId = auth.user?.organizationId
  if (!orgId) return
  try {
    const orgs = await apiGet<OrgSummary[]>('/organizations')
    const org = orgs.find((o) => o.id === orgId)
    if (!org) return
    const dept = org.departments.find((d) => d.id === auth.user?.departmentId)
    orgContext.value = { org: org.name, department: dept?.name ?? null }
  } catch {
    orgContext.value = null
  }
}

onMounted(() => {
  void loadSecurityStatus()
  void loadOrgContext()
})

watch(
  () => route.path,
  () => {
    userMenuOpen.value = false
  },
)

async function handleLogout() {
  userMenuOpen.value = false
  await auth.logout()
  await router.push('/login')
}
</script>

<template>
  <header class="sticky top-0 z-20 flex h-16 flex-none items-center gap-3 border-b border-slate-200 bg-white/95 px-4 backdrop-blur sm:px-6">
    <button
      type="button"
      class="rounded-md p-2 text-slate-500 hover:bg-slate-100 lg:hidden"
      :aria-label="drawerOpen ? 'Close navigation' : 'Open navigation'"
      :aria-expanded="drawerOpen"
      @click="drawerOpen = !drawerOpen"
    >
      <Menu v-if="!drawerOpen" class="h-5 w-5" aria-hidden="true" />
      <X v-else class="h-5 w-5" aria-hidden="true" />
    </button>

    <div class="min-w-0 flex-1">
      <nav v-if="crumbs.length > 0" aria-label="Breadcrumb" class="hidden sm:block">
        <ol class="flex flex-wrap items-center gap-1 text-xs text-slate-500">
          <li v-for="(crumb, i) in crumbs" :key="`${crumb.label}-${i}`" class="flex items-center gap-1">
            <span v-if="i > 0" aria-hidden="true" class="text-slate-300">/</span>
            <router-link v-if="crumb.to && i < crumbs.length - 1" :to="crumb.to" class="hover:text-slate-900 hover:underline">
              {{ crumb.label }}
            </router-link>
            <span v-else :aria-current="i === crumbs.length - 1 ? 'page' : undefined" class="truncate">
              {{ crumb.label }}
            </span>
          </li>
        </ol>
      </nav>
      <h1 class="truncate text-base font-semibold tracking-tight text-slate-900 sm:text-lg">{{ pageTitle }}</h1>
    </div>

    <button
      type="button"
      class="hidden items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-1.5 text-sm text-slate-500 transition-colors hover:border-slate-300 hover:bg-white md:flex"
      aria-label="Go to a page (Ctrl K)"
      @click="openPalette"
    >
      <Search class="h-4 w-4" aria-hidden="true" />
      <span class="w-40 text-left">Go to a page</span>
      <kbd class="rounded border border-slate-200 bg-white px-1.5 text-[11px] text-slate-500">Ctrl K</kbd>
    </button>

    <router-link
      to="/settings/security"
      class="hidden items-center gap-1.5 rounded-md px-2 py-1 text-xs font-medium transition-colors hover:bg-slate-100 sm:flex"
      :class="mfaEnabled ? 'text-success' : 'text-warning'"
      :title="mfaEnabled ? 'Authenticator enabled' : 'Authenticator not enabled'"
    >
      <ShieldCheck v-if="mfaEnabled" class="h-4 w-4" aria-hidden="true" />
      <ShieldAlert v-else class="h-4 w-4" aria-hidden="true" />
      <span v-if="mfaEnabled === null" class="text-slate-500">Security</span>
      <span v-else>{{ mfaEnabled ? 'Authenticator on' : 'Authenticator off' }}</span>
    </router-link>

    <div v-if="orgContext" class="hidden min-w-0 max-w-[14rem] flex-col text-right xl:flex">
      <span class="truncate text-xs font-medium text-slate-700">{{ orgContext.org }}</span>
      <span class="truncate text-[11px] text-slate-500">{{ orgContext.department ?? 'No department' }}</span>
    </div>

    <div class="relative">
      <button
        type="button"
        class="flex items-center gap-2 rounded-md px-1.5 py-1 hover:bg-slate-100"
        :aria-expanded="userMenuOpen"
        aria-haspopup="menu"
        aria-label="Account menu"
        @click="userMenuOpen = !userMenuOpen"
      >
        <span class="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800">
          {{ initials }}
        </span>
        <span class="hidden text-left sm:block">
          <span class="block max-w-[12rem] truncate text-sm font-medium text-slate-900">{{ auth.user?.email }}</span>
          <span class="block text-xs text-slate-500">{{ primaryRole }}</span>
        </span>
        <ChevronDown class="hidden h-4 w-4 text-slate-500 sm:block" aria-hidden="true" />
      </button>

      <div
        v-if="userMenuOpen"
        role="menu"
        class="absolute right-0 z-30 mt-2 w-56 rounded-lg border border-slate-200 bg-white py-1 shadow-card-lg"
      >
        <div class="border-b border-slate-100 px-3 py-2">
          <p class="truncate text-sm font-medium text-slate-900">{{ auth.user?.email }}</p>
          <p class="text-xs text-slate-500">{{ primaryRole }}</p>
        </div>
        <router-link
          v-for="item in ACCOUNT_ITEMS"
          :key="item.to"
          :to="item.to"
          role="menuitem"
          class="flex items-center gap-2 px-3 py-2 text-sm text-slate-700 hover:bg-slate-50"
          @click="userMenuOpen = false"
        >
          <component :is="item.icon" class="h-4 w-4 text-slate-500" aria-hidden="true" />
          {{ item.label }}
        </router-link>
        <button
          type="button"
          role="menuitem"
          class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-700 hover:bg-slate-50"
          @click="handleLogout"
        >
          <LogOut class="h-4 w-4 text-slate-500" aria-hidden="true" />
          Sign out
        </button>
      </div>
    </div>
  </header>
</template>
