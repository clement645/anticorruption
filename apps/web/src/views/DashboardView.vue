<script setup lang="ts">
import { computed, onMounted } from 'vue'
import {
  Wallet,
  Gavel,
  FileText,
  FolderKanban,
  ShieldAlert,
  ClipboardList,
  MessageSquareWarning,
  UserCog,
  ArrowRight,
  Activity,
} from '@lucide/vue'
import { useHealthStore } from '../stores/health'
import { useAuthStore } from '../stores/auth'

const health = useHealthStore()
const auth = useAuthStore()

onMounted(() => {
  void health.checkHealth()
})

const quickLinks = computed(() =>
  [
    { to: '/budgets', label: 'Budgets', desc: 'Fiscal years, allocations, commitments', icon: Wallet, permission: 'budget:read' },
    { to: '/procurement', label: 'Procurement', desc: 'Plans, tenders, bids, awards', icon: Gavel, permission: 'procurement:read' },
    { to: '/contracts', label: 'Contracts & Payments', desc: 'Contracts, invoices, disbursements', icon: FileText, permission: 'contract:read' },
    { to: '/projects', label: 'Projects', desc: 'Milestones, inspections, evidence', icon: FolderKanban, permission: 'project:read' },
    { to: '/risk-alerts', label: 'Risk Alerts', desc: 'AI-detected anomalies', icon: ShieldAlert, permission: 'risk:read' },
    { to: '/audit', label: 'Audit Trail', desc: 'Immutable, hash-chained log', icon: ClipboardList, permission: 'audit:read' },
    { to: '/whistleblower-investigations', label: 'Whistleblower Cases', desc: 'Investigate submitted reports', icon: MessageSquareWarning, permission: 'whistleblower:read' },
    { to: '/admin/users', label: 'User Management', desc: 'Create accounts, assign roles', icon: UserCog, permission: 'users:read' },
  ].filter((l) => auth.hasPermission(l.permission)),
)
</script>

<template>
  <section class="mx-auto max-w-6xl px-4 py-8 sm:px-6">
    <div class="page-header sm:flex-row sm:items-center sm:justify-between">
      <div>
        <h1 class="page-title">Welcome{{ auth.user ? `, ${auth.user.email.split('@')[0]}` : '' }}</h1>
        <p class="page-subtitle mt-1">Here's what needs your attention across the system.</p>
      </div>
      <div class="hidden flex-wrap justify-end gap-1.5 sm:flex">
        <span
          v-for="role in auth.user?.roles ?? []"
          :key="role"
          class="badge badge-info"
        >
          {{ role }}
        </span>
      </div>
    </div>

    <div v-if="quickLinks.length > 0" class="mt-6">
      <h2 class="section-title">Quick access</h2>
      <div class="mt-3 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <router-link
          v-for="link in quickLinks"
          :key="link.to"
          :to="link.to"
          class="card group flex items-start gap-3 p-4 transition-all hover:-translate-y-0.5 hover:shadow-[0_4px_10px_rgba(23,41,66,0.06),0_16px_32px_-16px_rgba(23,41,66,0.18)]"
        >
          <div class="flex h-10 w-10 flex-none items-center justify-center rounded-md bg-brand-50 text-brand-700">
            <component :is="link.icon" class="h-5 w-5" />
          </div>
          <div class="flex-1">
            <p class="text-sm font-semibold text-slate-900">{{ link.label }}</p>
            <p class="mt-0.5 text-xs text-slate-500">{{ link.desc }}</p>
          </div>
          <ArrowRight class="mt-2 h-4 w-4 flex-none text-slate-300 transition-transform group-hover:translate-x-0.5 group-hover:text-brand-600" />
        </router-link>
      </div>
    </div>

    <div class="mt-8">
      <h2 class="section-title flex items-center gap-2">
        <Activity class="h-4 w-4 text-slate-400" />
        System Status
      </h2>
      <p class="mt-1 text-sm text-slate-500">Live connectivity check between this frontend and the B-PFMPS API.</p>

      <div class="mt-3 card p-6">
        <div v-if="health.loading" class="text-sm text-slate-500">Checking system status…</div>

        <div v-else-if="health.error" class="flex items-start gap-3">
          <span class="mt-1 h-2.5 w-2.5 flex-none rounded-full bg-red-600" aria-hidden="true" />
          <div>
            <p class="font-medium text-red-800">API unreachable</p>
            <p class="mt-1 text-sm text-slate-600">{{ health.error }}</p>
          </div>
        </div>

        <dl v-else class="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <div>
            <dt class="text-xs font-medium uppercase tracking-wide text-slate-500">API Liveness</dt>
            <dd class="mt-1 flex items-center gap-2">
              <span
                class="h-2.5 w-2.5 flex-none rounded-full"
                :class="health.liveness?.status === 'ok' ? 'bg-emerald-500' : 'bg-red-500'"
                aria-hidden="true"
              />
              <span class="text-sm font-medium text-slate-900">
                {{ health.liveness?.status === 'ok' ? 'Operational' : 'Unknown' }}
              </span>
            </dd>
            <dd class="mt-1 text-xs text-slate-500">
              Uptime: {{ health.liveness?.uptimeSeconds }}s
            </dd>
          </div>

          <div>
            <dt class="text-xs font-medium uppercase tracking-wide text-slate-500">
              Database Readiness
            </dt>
            <dd class="mt-1 flex items-center gap-2">
              <span
                class="h-2.5 w-2.5 flex-none rounded-full"
                :class="health.readiness?.checks.database === 'ok' ? 'bg-emerald-500' : 'bg-red-500'"
                aria-hidden="true"
              />
              <span class="text-sm font-medium text-slate-900">
                {{ health.readiness?.checks.database === 'ok' ? 'Connected' : 'Unavailable' }}
              </span>
            </dd>
          </div>
        </dl>

        <p v-if="health.lastCheckedAt" class="mt-6 text-xs text-slate-400">
          Last checked {{ new Date(health.lastCheckedAt).toLocaleTimeString() }}
        </p>

        <button type="button" class="btn btn-secondary btn-sm mt-4" :disabled="health.loading" @click="health.checkHealth()">
          Recheck
        </button>
      </div>
    </div>
  </section>
</template>
