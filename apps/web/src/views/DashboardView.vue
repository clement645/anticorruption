<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { RouterLink } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { apiGet } from '../api/client'
import { money } from '../lib/money'
import PageHeader from '../components/ui/PageHeader.vue'
import AlertBanner from '../components/ui/AlertBanner.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import SkeletonRows from '../components/ui/SkeletonRows.vue'
import StatusBadge from '../components/ui/StatusBadge.vue'

/**
 * Executive command centre. Every figure is read from a list endpoint the
 * signed-in role is allowed to call. A section whose data the role cannot
 * read is not rendered at all, and a section that fails says so and offers a
 * retry, rather than showing zeros that look like real results.
 */

const auth = useAuthStore()


interface Allocation {
  authorizedAmount: string
  committedAmount: string
  spentAmount: string
  availableAmount: string
}
interface Paged<T> {
  items: T[]
  total: number
}
interface Project {
  id: string
  name: string
  status: string
}
interface RiskSummary {
  total: number
  bySeverity: Record<'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL', number>
}
interface AuditEvent {
  id: string
  eventType: string
  actorEmail: string | null
  createdAt: string
  resourceType: string | null
}
interface Invoice {
  id: string
  status: string
  invoiceNumber: string
  amount: string
}
interface ProcurementRequest {
  id: string
  title: string
  status: string
  estimatedAmount: string
}

type Load<T> = { state: 'loading' | 'ready' | 'error'; data: T | null }

const sections = reactive({
  allocations: { state: 'loading', data: null } as Load<Allocation[]>,
  budgetsPending: { state: 'loading', data: null } as Load<number>,
  projects: { state: 'loading', data: null } as Load<Project[]>,
  risks: { state: 'loading', data: null } as Load<RiskSummary>,
  procurement: { state: 'loading', data: null } as Load<ProcurementRequest[]>,
  invoices: { state: 'loading', data: null } as Load<Invoice[]>,
  activity: { state: 'loading', data: null } as Load<AuditEvent[]>,
})

async function run<K extends keyof typeof sections>(key: K, fetcher: () => Promise<(typeof sections)[K]['data']>) {
  sections[key] = { state: 'loading', data: null } as (typeof sections)[K]
  try {
    sections[key] = { state: 'ready', data: await fetcher() } as (typeof sections)[K]
  } catch {
    sections[key] = { state: 'error', data: null } as (typeof sections)[K]
  }
}

function loadAll() {
  const can = (p: string) => auth.hasPermission(p)
  const tasks: Promise<void>[] = []
  if (can('budget:read')) {
    tasks.push(
      run('allocations', async () => {
        const page = await apiGet<Paged<Allocation>>(`/allocations?take=${ALLOCATION_SAMPLE}`)
        allocationTotal.value = page.total
        return page.items
      }),
    )
    tasks.push(
      run('budgetsPending', async () => (await apiGet<Paged<unknown>>('/budgets?status=PENDING_APPROVAL&take=1')).total),
    )
  }
  if (can('project:read')) {
    tasks.push(run('projects', () => apiGet<Project[]>('/projects')))
  }
  if (can('risk:read')) {
    tasks.push(run('risks', () => apiGet<RiskSummary>('/risk-alerts/summary?status=OPEN')))
  }
  if (can('procurement:read')) {
    tasks.push(run('procurement', () => apiGet<ProcurementRequest[]>('/procurement-requests?status=SUBMITTED')))
  }
  if (can('invoice:read')) {
    tasks.push(run('invoices', () => apiGet<Invoice[]>('/invoices?status=SUBMITTED')))
  }
  if (can('audit:read')) {
    tasks.push(run('activity', async () => (await apiGet<Paged<AuditEvent>>('/audit/events?take=8')).items))
  }
  return Promise.all(tasks)
}

onMounted(() => {
  void loadAll()
})

const hasBudget = computed(() => auth.hasPermission('budget:read'))

const ALLOCATION_SAMPLE = 500
const allocationTotal = ref(0)
const allocationsTruncated = computed(() => allocationTotal.value > ALLOCATION_SAMPLE)

const totals = computed(() => {
  const rows = sections.allocations.data
  if (!rows) return null
  const sum = (key: keyof Allocation) => rows.reduce((acc, r) => acc + Number(r[key]), 0)
  return {
    authorized: sum('authorizedAmount'),
    committed: sum('committedAmount'),
    spent: sum('spentAmount'),
    available: sum('availableAmount'),
    count: rows.length,
  }
})

const utilisation = computed(() => {
  const t = totals.value
  if (!t || t.authorized <= 0) return null
  const pct = (v: number) => Math.min(100, Math.max(0, (v / t.authorized) * 100))
  return { spent: pct(t.spent), committed: pct(t.committed), available: pct(t.available) }
})

const projectCounts = computed(() => {
  const rows = sections.projects.data
  if (!rows) return null
  const order = ['PLANNED', 'IN_PROGRESS', 'COMPLETED', 'SUSPENDED', 'CANCELLED']
  return order.map((status) => ({ status, count: rows.filter((p) => p.status === status).length }))
})

const riskCounts = computed(() => {
  const summary = sections.risks.data
  if (!summary) return null
  return (['CRITICAL', 'HIGH', 'MEDIUM', 'LOW'] as const).map((severity) => ({
    severity,
    count: summary.bySeverity[severity],
  }))
})

const attention = computed(() => {
  const items: Array<{ label: string; count: number; to: string; tone: 'warning' | 'danger' | 'info' }> = []
  if (sections.budgetsPending.state === 'ready') {
    items.push({ label: 'Budgets awaiting approval', count: sections.budgetsPending.data ?? 0, to: '/budgets', tone: 'warning' })
  }
  if (sections.procurement.state === 'ready') {
    items.push({
      label: 'Procurement requests awaiting approval',
      count: sections.procurement.data?.length ?? 0,
      to: '/procurement',
      tone: 'warning',
    })
  }
  if (sections.invoices.state === 'ready') {
    items.push({ label: 'Invoices awaiting verification', count: sections.invoices.data?.length ?? 0, to: '/contracts', tone: 'info' })
  }
  if (sections.risks.state === 'ready') {
    const urgent = (sections.risks.data?.bySeverity.HIGH ?? 0) + (sections.risks.data?.bySeverity.CRITICAL ?? 0)
    items.push({ label: 'Open high or critical risk alerts', count: urgent, to: '/risk-alerts', tone: 'danger' })
  }
  return items
})

function formatDateTime(iso: string) {
  return new Date(iso).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })
}

function eventLabel(type: string) {
  return type
    .toLowerCase()
    .replace(/_/g, ' ')
    .replace(/^\w/, (c) => c.toUpperCase())
}

const anySectionVisible = computed(
  () => hasBudget.value || auth.hasPermission('project:read') || auth.hasPermission('risk:read') || auth.hasPermission('procurement:read') || auth.hasPermission('invoice:read') || auth.hasPermission('audit:read'),
)
</script>

<template>
  <div class="mx-auto max-w-7xl space-y-8 px-4 py-8 sm:px-6">
    <PageHeader
      title="Command centre"
      :subtitle="`Signed in as ${auth.user?.email ?? ''}. Figures reflect the records you are permitted to read.`"
    />

    <EmptyState
      v-if="!anySectionVisible"
      title="Nothing to show yet"
      description="Your role does not include access to the governance data on this page. Use the navigation to reach the areas you work in."
    />

    <!-- Key metrics -->
    <section v-if="hasBudget" aria-labelledby="metrics-heading">
      <h3 id="metrics-heading" class="mb-3 text-sm font-semibold text-slate-800">Budget position</h3>

      <AlertBanner v-if="sections.allocations.state === 'error'" class="mb-3">
        We couldn’t load allocation figures. Your data has not been changed.
        <button type="button" class="ml-2 font-medium underline" @click="loadAll()">
          Retry
        </button>
      </AlertBanner>

      <div v-else-if="sections.allocations.state === 'loading'" class="card p-5">
        <SkeletonRows :rows="2" :columns="4" />
      </div>

      <div v-else-if="totals" class="grid gap-px overflow-hidden rounded-xl border border-slate-200 bg-slate-200 sm:grid-cols-2 xl:grid-cols-4">
        <div class="bg-white p-5">
          <p class="text-xs font-medium uppercase tracking-wide text-slate-500">Authorised</p>
          <p class="num mt-2 text-xl font-semibold text-slate-900">{{ money(totals.authorized) }}</p>
          <p class="mt-1 text-xs text-slate-500">
            {{ allocationsTruncated ? `Summed over the first ${totals.count} of ${allocationTotal}` : `${totals.count} allocation${totals.count === 1 ? '' : 's'}` }}
          </p>
        </div>
        <div class="bg-white p-5">
          <p class="text-xs font-medium uppercase tracking-wide text-slate-500">Committed</p>
          <p class="num mt-2 text-xl font-semibold text-slate-900">{{ money(totals.committed) }}</p>
          <p class="mt-1 text-xs text-slate-500">Earmarked, not yet spent</p>
        </div>
        <div class="bg-white p-5">
          <p class="text-xs font-medium uppercase tracking-wide text-slate-500">Spent</p>
          <p class="num mt-2 text-xl font-semibold text-slate-900">{{ money(totals.spent) }}</p>
          <p class="mt-1 text-xs text-slate-500">Recorded expenditure</p>
        </div>
        <div class="bg-white p-5">
          <p class="text-xs font-medium uppercase tracking-wide text-slate-500">Remaining</p>
          <p class="num mt-2 text-xl font-semibold text-slate-900">{{ money(totals.available) }}</p>
          <p class="mt-1 text-xs text-slate-500">Available to commit</p>
        </div>
      </div>

      <div v-if="utilisation && totals" class="card mt-4 p-5">
        <div class="flex items-baseline justify-between">
          <h4 class="text-sm font-semibold text-slate-800">Allocation utilisation</h4>
          <span class="num text-xs text-slate-500">
            {{ Math.round(((totals.committed + totals.spent) / totals.authorized) * 100) }}% drawn
          </span>
        </div>
        <div
          class="mt-3 flex h-3 overflow-hidden rounded-full bg-slate-100"
          role="img"
          :aria-label="`Spent ${Math.round(utilisation.spent)}%, committed ${Math.round(utilisation.committed)}%, available ${Math.round(utilisation.available)}%`"
        >
          <div class="bg-brand-800" :style="{ width: utilisation.spent + '%' }" />
          <div class="bg-brand-300" :style="{ width: utilisation.committed + '%' }" />
        </div>
        <ul class="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-xs text-slate-600">
          <li class="flex items-center gap-1.5"><span class="h-2 w-2 rounded-full bg-brand-800" />Spent</li>
          <li class="flex items-center gap-1.5"><span class="h-2 w-2 rounded-full bg-brand-300" />Committed</li>
          <li class="flex items-center gap-1.5"><span class="h-2 w-2 rounded-full bg-slate-200" />Available</li>
        </ul>
      </div>
    </section>

    <!-- Attention required -->
    <section v-if="attention.length > 0" aria-labelledby="attention-heading">
      <h3 id="attention-heading" class="mb-3 text-sm font-semibold text-slate-800">Needs your attention</h3>
      <ul class="divide-y divide-slate-100 overflow-hidden rounded-xl border border-slate-200 bg-white">
        <li v-for="item in attention" :key="item.label">
          <RouterLink :to="item.to" class="flex items-center justify-between gap-4 px-5 py-3.5 transition-colors duration-150 hover:bg-slate-50">
            <span class="text-sm text-slate-800">{{ item.label }}</span>
            <span class="flex items-center gap-3">
              <StatusBadge v-if="item.count > 0" :status="item.tone === 'danger' ? 'HIGH' : 'PENDING'" :label="String(item.count)" />
              <span v-else class="text-xs text-slate-500">None</span>
              <span class="text-xs text-brand-700">Open</span>
            </span>
          </RouterLink>
        </li>
      </ul>
    </section>

    <div class="grid gap-6 lg:grid-cols-2">
      <!-- Project status -->
      <section v-if="auth.hasPermission('project:read')" class="card min-w-0 p-5" aria-labelledby="projects-heading">
        <h3 id="projects-heading" class="text-sm font-semibold text-slate-800">Project status</h3>
        <AlertBanner v-if="sections.projects.state === 'error'" class="mt-3">
          We couldn’t load projects. Your data has not been changed.
        </AlertBanner>
        <SkeletonRows v-else-if="sections.projects.state === 'loading'" :rows="3" :columns="2" />
        <div v-else-if="projectCounts && projectCounts.some((p) => p.count > 0)" class="mt-4 space-y-2.5">
          <div v-for="p in projectCounts" :key="p.status" class="flex items-center justify-between text-sm">
            <span class="text-slate-700">{{ p.status.replace('_', ' ').toLowerCase().replace(/^\w/, (c) => c.toUpperCase()) }}</span>
            <span class="num font-medium text-slate-900">{{ p.count }}</span>
          </div>
          <p class="pt-2 text-xs text-slate-500">
            The system records these five states. On track, at risk, and delayed are not tracked yet.
          </p>
        </div>
        <EmptyState v-else title="No projects yet" description="Projects appear here once a contract is activated." />
      </section>

      <!-- Risk overview -->
      <section v-if="auth.hasPermission('risk:read')" class="card min-w-0 p-5" aria-labelledby="risk-heading">
        <h3 id="risk-heading" class="text-sm font-semibold text-slate-800">Open risk alerts</h3>
        <AlertBanner v-if="sections.risks.state === 'error'" class="mt-3">
          We couldn’t load risk alerts. Your data has not been changed.
        </AlertBanner>
        <SkeletonRows v-else-if="sections.risks.state === 'loading'" :rows="4" :columns="2" />
        <div v-else-if="riskCounts" class="mt-4 space-y-2.5">
          <div v-for="r in riskCounts" :key="r.severity" class="flex items-center justify-between text-sm">
            <StatusBadge :status="r.severity" />
            <span class="num font-medium text-slate-900">{{ r.count }}</span>
          </div>
          <p class="pt-2 text-xs text-slate-500">
            Alerts are raised by rule-based checks and need human review. A raised alert is not a finding of wrongdoing.
          </p>
        </div>
      </section>

      <!-- Procurement -->
      <section v-if="auth.hasPermission('procurement:read')" class="card min-w-0 p-5" aria-labelledby="proc-heading">
        <h3 id="proc-heading" class="text-sm font-semibold text-slate-800">Requests awaiting approval</h3>
        <AlertBanner v-if="sections.procurement.state === 'error'" class="mt-3">
          We couldn’t load procurement requests. Your data has not been changed.
        </AlertBanner>
        <SkeletonRows v-else-if="sections.procurement.state === 'loading'" :rows="3" :columns="2" />
        <ul v-else-if="sections.procurement.data && sections.procurement.data.length > 0" class="mt-3 divide-y divide-slate-100">
          <li v-for="r in sections.procurement.data.slice(0, 5)" :key="r.id" class="flex items-center justify-between gap-3 py-2.5 text-sm">
            <span class="truncate text-slate-800">{{ r.title }}</span>
            <span class="num shrink-0 text-slate-600">{{ money(Number(r.estimatedAmount)) }}</span>
          </li>
        </ul>
        <EmptyState v-else title="You’re all caught up" description="No procurement requests are waiting for approval." />
      </section>

      <!-- Recent activity -->
      <section v-if="auth.hasPermission('audit:read')" class="card min-w-0 p-5" aria-labelledby="activity-heading">
        <h3 id="activity-heading" class="text-sm font-semibold text-slate-800">Recent activity</h3>
        <AlertBanner v-if="sections.activity.state === 'error'" class="mt-3">
          We couldn’t load recent activity. Your data has not been changed.
        </AlertBanner>
        <SkeletonRows v-else-if="sections.activity.state === 'loading'" :rows="5" :columns="2" />
        <ol v-else-if="sections.activity.data && sections.activity.data.length > 0" class="mt-3 space-y-3">
          <li v-for="e in sections.activity.data" :key="e.id" class="flex items-start gap-3 text-sm">
            <span class="mt-1.5 h-1.5 w-1.5 flex-none rounded-full bg-brand-600" aria-hidden="true" />
            <div class="min-w-0">
              <p class="text-slate-800">{{ eventLabel(e.eventType) }}</p>
              <p class="text-xs text-slate-500">{{ e.actorEmail ?? 'System' }} · {{ formatDateTime(e.createdAt) }}</p>
            </div>
          </li>
        </ol>
        <EmptyState v-else title="No activity recorded yet" />
      </section>
    </div>
  </div>
</template>
