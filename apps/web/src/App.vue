<script setup lang="ts">
import { computed, ref } from 'vue'
import { useRoute, useRouter } from 'vue-router'
import {
  LayoutDashboard,
  Wallet,
  Gavel,
  FileText,
  FolderKanban,
  ShieldAlert,
  ClipboardList,
  ShieldCheck,
  MessageSquareWarning,
  UserCog,
  Eye,
  Megaphone,
  Menu,
  X,
  ChevronDown,
  LogOut,
  KeyRound,
} from '@lucide/vue'
import { useAuthStore } from './stores/auth'

const appName = import.meta.env.VITE_APP_NAME ?? 'B-PFMPS'
const auth = useAuthStore()
const router = useRouter()
const route = useRoute()

const sidebarOpen = ref(false)
const userMenuOpen = ref(false)

interface NavItem {
  to: string
  label: string
  icon: typeof LayoutDashboard
  permission?: string
}
interface NavGroup {
  label: string
  items: NavItem[]
}

const navGroups = computed<NavGroup[]>(() => [
  {
    label: 'Overview',
    items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard }],
  },
  {
    label: 'Financial Management',
    items: [
      { to: '/budgets', label: 'Budgets', icon: Wallet, permission: 'budget:read' },
      { to: '/contracts', label: 'Contracts & Payments', icon: FileText, permission: 'contract:read' },
    ],
  },
  {
    label: 'Procurement & Delivery',
    items: [
      { to: '/procurement', label: 'Procurement', icon: Gavel, permission: 'procurement:read' },
      { to: '/projects', label: 'Projects', icon: FolderKanban, permission: 'project:read' },
    ],
  },
  {
    label: 'Oversight',
    items: [
      { to: '/risk-alerts', label: 'Risk Alerts', icon: ShieldAlert, permission: 'risk:read' },
      { to: '/audit', label: 'Audit Trail', icon: ClipboardList, permission: 'audit:read' },
      { to: '/auditor-portal', label: 'Auditor Portal', icon: ShieldCheck, permission: 'audit:read' },
      {
        to: '/whistleblower-investigations',
        label: 'Whistleblower Cases',
        icon: MessageSquareWarning,
        permission: 'whistleblower:read',
      },
    ],
  },
  {
    label: 'Administration',
    items: [{ to: '/admin/users', label: 'User Management', icon: UserCog, permission: 'users:read' }],
  },
])

const visibleGroups = computed(() =>
  navGroups.value
    .map((group) => ({
      ...group,
      items: group.items.filter((item) => !item.permission || auth.hasPermission(item.permission)),
    }))
    .filter((group) => group.items.length > 0),
)

const initials = computed(() => {
  const email = auth.user?.email ?? ''
  return email.slice(0, 2).toUpperCase()
})

function isActive(to: string) {
  return to === '/' ? route.path === '/' : route.path.startsWith(to)
}

async function handleLogout() {
  userMenuOpen.value = false
  await auth.logout()
  await router.push('/login')
}
</script>

<template>
  <div v-if="auth.isAuthenticated" class="flex min-h-screen bg-slate-50">
    <!-- Mobile overlay -->
    <div
      v-if="sidebarOpen"
      class="fixed inset-0 z-30 bg-slate-900/40 lg:hidden"
      @click="sidebarOpen = false"
    />

    <!-- Sidebar -->
    <aside
      class="fixed inset-y-0 left-0 z-40 flex w-64 flex-col border-r border-slate-200 bg-white transition-transform duration-200 lg:static lg:translate-x-0"
      :class="sidebarOpen ? 'translate-x-0' : '-translate-x-full'"
    >
      <div class="flex h-16 flex-none items-center gap-2.5 border-b border-slate-200 px-5">
        <div
          class="flex h-8 w-8 flex-none items-center justify-center rounded-md bg-brand-800 font-serif text-sm font-bold text-white shadow-sm"
        >
          B
        </div>
        <div class="min-w-0">
          <span class="block truncate text-sm font-semibold tracking-tight text-slate-900">{{ appName }}</span>
          <span class="block text-[10px] font-medium uppercase tracking-wider text-accent-600">Republic of Kenya</span>
        </div>
      </div>

      <nav class="flex-1 overflow-y-auto px-3 py-4">
        <div v-for="group in visibleGroups" :key="group.label" class="mb-5">
          <p class="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">
            {{ group.label }}
          </p>
          <router-link
            v-for="item in group.items"
            :key="item.to"
            :to="item.to"
            class="mb-0.5 flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium transition-colors"
            :class="
              isActive(item.to)
                ? 'bg-brand-50 text-brand-800'
                : 'text-slate-600 hover:bg-slate-100 hover:text-slate-900'
            "
            @click="sidebarOpen = false"
          >
            <component
              :is="item.icon"
              class="h-[18px] w-[18px] flex-none"
              :class="isActive(item.to) ? 'text-brand-700' : 'text-slate-400'"
            />
            <span class="truncate">{{ item.label }}</span>
          </router-link>
        </div>

        <div class="mt-2 border-t border-slate-100 pt-4">
          <p class="px-3 pb-1.5 text-[11px] font-semibold uppercase tracking-wider text-slate-400">Public</p>
          <router-link
            to="/transparency"
            class="mb-0.5 flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
          >
            <Eye class="h-[18px] w-[18px] flex-none text-slate-400" />
            Transparency Portal
          </router-link>
          <router-link
            to="/report-a-concern"
            class="flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium text-slate-600 transition-colors hover:bg-slate-100 hover:text-slate-900"
          >
            <Megaphone class="h-[18px] w-[18px] flex-none text-slate-400" />
            Report a Concern
          </router-link>
        </div>
      </nav>
    </aside>

    <!-- Main column -->
    <div class="flex min-h-screen flex-1 flex-col lg:pl-0">
      <header class="sticky top-0 z-20 flex h-16 flex-none items-center justify-between border-b border-slate-200 bg-white/85 px-4 backdrop-blur sm:px-6">
        <button
          type="button"
          class="rounded-md p-2 text-slate-500 hover:bg-slate-100 lg:hidden"
          @click="sidebarOpen = !sidebarOpen"
        >
          <Menu v-if="!sidebarOpen" class="h-5 w-5" />
          <X v-else class="h-5 w-5" />
        </button>
        <div class="hidden items-center gap-2 text-sm text-slate-400 lg:flex">
          <span class="h-1.5 w-1.5 rounded-full bg-accent-500" aria-hidden="true" />
          Blockchain-Based Integrated Public Financial Management &amp; Procurement System
        </div>

        <div class="relative ml-auto">
          <button
            type="button"
            class="flex items-center gap-2 rounded-md px-2 py-1.5 hover:bg-slate-100"
            @click="userMenuOpen = !userMenuOpen"
          >
            <span class="flex h-8 w-8 items-center justify-center rounded-full bg-brand-100 text-xs font-semibold text-brand-800">
              {{ initials }}
            </span>
            <span class="hidden text-left sm:block">
              <span class="block text-sm font-medium text-slate-900">{{ auth.user?.email }}</span>
              <span class="block text-xs text-slate-500">{{ auth.user?.roles.join(', ') || '—' }}</span>
            </span>
            <ChevronDown class="hidden h-4 w-4 text-slate-400 sm:block" />
          </button>

          <div
            v-if="userMenuOpen"
            class="absolute right-0 z-30 mt-2 w-48 rounded-lg border border-slate-200 bg-white py-1 shadow-lg shadow-slate-900/10"
            @click="userMenuOpen = false"
          >
            <div class="border-b border-slate-100 px-3 py-2 sm:hidden">
              <p class="truncate text-sm font-medium text-slate-900">{{ auth.user?.email }}</p>
              <p class="text-xs text-slate-500">{{ auth.user?.roles.join(', ') || '—' }}</p>
            </div>
            <router-link
              to="/settings/signing-key"
              class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-600 hover:bg-slate-50"
            >
              <KeyRound class="h-4 w-4" />
              Signing key
            </router-link>
            <button
              type="button"
              class="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-slate-600 hover:bg-slate-50"
              @click="handleLogout"
            >
              <LogOut class="h-4 w-4" />
              Sign out
            </button>
          </div>
        </div>
      </header>

      <main class="flex-1">
        <router-view />
      </main>
    </div>
  </div>

  <!-- Unauthenticated / public shell -->
  <div v-else class="min-h-screen bg-slate-50">
    <div class="h-1 bg-gradient-to-r from-brand-800 via-brand-600 to-accent-500" aria-hidden="true" />
    <header class="border-b border-slate-200 bg-white">
      <div class="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <router-link to="/" class="flex items-center gap-2.5">
          <div class="flex h-8 w-8 flex-none items-center justify-center rounded-md bg-brand-800 font-serif text-sm font-bold text-white shadow-sm">
            B
          </div>
          <span class="text-base font-semibold tracking-tight text-slate-900">{{ appName }}</span>
        </router-link>
        <nav class="flex items-center gap-5 text-sm">
          <router-link to="/transparency" class="text-slate-600 hover:text-slate-900">Transparency Portal</router-link>
          <router-link to="/report-a-concern" class="text-slate-600 hover:text-slate-900">Report a Concern</router-link>
          <router-link v-if="route.path !== '/login'" to="/login" class="btn btn-primary btn-sm">Sign in</router-link>
        </nav>
      </div>
    </header>
    <main>
      <router-view />
    </main>
  </div>
</template>
