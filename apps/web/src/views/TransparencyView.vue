<script setup lang="ts">
import { ref } from 'vue'
import { useTransparencyStore } from '../stores/transparency'
import StatusBadge from '../components/ui/StatusBadge.vue'
import AlertBanner from '../components/ui/AlertBanner.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import SkeletonRows from '../components/ui/SkeletonRows.vue'

const store = useTransparencyStore()

type Tab = 'projects' | 'tenders' | 'suppliers' | 'budgets' | 'verify'
const activeTab = ref<Tab>('projects')

const projectSearch = ref('')
const tenderSearch = ref('')
const supplierSearch = ref('')
const hashInput = ref('')
const selectedProjectId = ref<string | null>(null)
const selectedTenderId = ref<string | null>(null)

async function setTab(tab: Tab) {
  activeTab.value = tab
  if (tab === 'projects' && store.projects.length === 0) await store.searchProjects()
  if (tab === 'tenders' && store.tenders.length === 0) await store.searchTenders()
  if (tab === 'suppliers' && store.suppliers.length === 0) await store.searchSuppliers()
  if (tab === 'budgets' && store.budgetLines.length === 0) await store.fetchBudgetLines()
}
void setTab('projects')

async function openProject(id: string) {
  selectedProjectId.value = id
  await store.fetchProjectDetail(id)
}
async function openTender(id: string) {
  selectedTenderId.value = id
  await store.fetchTenderDetail(id)
}
async function handleVerify() {
  if (!hashInput.value.trim()) return
  await store.verifyHash(hashInput.value.trim())
}
</script>

<template>
  <div>
    <div class="relative overflow-hidden bg-brand-900">
      <div
        class="pointer-events-none absolute inset-0 opacity-[0.06]"
        style="background-image: radial-gradient(circle at 1px 1px, white 1px, transparent 0); background-size: 28px 28px"
        aria-hidden="true"
      />
      <div class="relative mx-auto max-w-5xl px-4 py-12 sm:px-6">
        <p class="text-[11px] font-medium uppercase tracking-wider text-accent-300">Public &middot; No sign-in required</p>
        <h1 class="mt-2 font-serif text-3xl font-semibold text-white sm:text-4xl">Citizen Transparency Portal</h1>
        <p class="mt-3 max-w-2xl text-sm leading-relaxed text-brand-200">
          Search public projects, tenders, and suppliers, view where public budgets are allocated, and
          independently verify the hash of any piece of published evidence — every figure here is drawn
          live from the same system officials use.
        </p>
      </div>
    </div>

    <section class="mx-auto max-w-5xl px-4 py-10 sm:px-6">
      <nav class="flex flex-wrap gap-1 border-b border-slate-200 text-sm" aria-label="Transparency portal sections">
        <button
          v-for="tab in (['projects', 'tenders', 'suppliers', 'budgets', 'verify'] as Tab[])"
          :key="tab"
          type="button"
          class="tab-pill"
          :class="activeTab === tab ? 'tab-pill-active' : 'tab-pill-inactive'"
          @click="setTab(tab)"
        >
          {{ tab === 'verify' ? 'Verify a hash' : tab }}
        </button>
      </nav>

      <AlertBanner v-if="store.error" class="mt-4">{{ store.error }}</AlertBanner>

    <!-- Projects -->
    <div v-if="activeTab === 'projects'" class="mt-6">
      <form class="flex gap-2" @submit.prevent="store.searchProjects(projectSearch)">
        <input v-model="projectSearch" placeholder="Search projects by name" class="input w-72" />
        <button type="submit" class="btn btn-primary btn-sm">Search</button>
      </form>

      <SkeletonRows v-if="store.loading" :rows="3" :columns="2" class="mt-4 card" />
      <EmptyState v-else-if="store.projects.length === 0" class="mt-4 card" title="No projects found" />
      <ul v-else class="mt-4 divide-y divide-slate-100 card">
        <li v-for="p in store.projects" :key="p.id" class="p-3 text-sm">
          <button type="button" class="text-left font-medium text-slate-900 hover:underline" @click="openProject(p.id)">
            {{ p.name }}
          </button>
          <StatusBadge class="ml-2" :status="p.status" />
          <p class="mt-0.5 text-xs text-slate-500">{{ p.organizationName }} · {{ p.location ?? 'location not recorded' }}</p>
        </li>
      </ul>

      <div v-if="store.projectDetail && selectedProjectId" class="mt-4 card p-4 text-sm">
        <h2 class="font-medium text-slate-900">{{ store.projectDetail.name }}</h2>
        <p class="mt-1 text-slate-600">{{ store.projectDetail.description }}</p>
        <p class="mt-2 text-xs text-slate-500">
          {{ store.projectDetail.startDate.slice(0, 10) }} → {{ store.projectDetail.plannedEndDate.slice(0, 10) }}
          <template v-if="store.projectDetail.actualEndDate"> (completed {{ store.projectDetail.actualEndDate.slice(0, 10) }})</template>
        </p>

        <h3 class="mt-3 text-xs font-medium uppercase text-slate-500">Milestones</h3>
        <ul class="mt-1 space-y-1.5">
          <li v-for="m in store.projectDetail.milestones" :key="m.sequenceNumber" class="flex flex-wrap items-center gap-1.5 text-xs">
            <span>#{{ m.sequenceNumber }} {{ m.title }}</span>
            <StatusBadge :status="m.status" />
            <span class="text-slate-500">({{ m.plannedAmount }}, due {{ m.plannedDate.slice(0, 10) }})</span>
          </li>
        </ul>

        <h3 class="mt-3 text-xs font-medium uppercase text-slate-500">Published evidence</h3>
        <ul class="mt-1 space-y-1">
          <li v-for="e in store.projectDetail.evidence" :key="e.id" class="text-xs">
            {{ e.fileName }} — <span class="font-mono">{{ e.fileHash.slice(0, 16) }}…</span>
            <span v-if="e.anchored" class="text-emerald-700">(anchored)</span>
          </li>
          <li v-if="store.projectDetail.evidence.length === 0" class="text-xs text-slate-500">No evidence published yet.</li>
        </ul>
      </div>
    </div>

    <!-- Tenders -->
    <div v-if="activeTab === 'tenders'" class="mt-6">
      <form class="flex gap-2" @submit.prevent="store.searchTenders(tenderSearch)">
        <input v-model="tenderSearch" placeholder="Search tenders by title" class="input w-72" />
        <button type="submit" class="btn btn-primary btn-sm">Search</button>
      </form>
      <p class="mt-1 text-[11px] text-slate-500">Only published tenders appear here — drafts are internal.</p>

      <SkeletonRows v-if="store.loading" :rows="3" :columns="2" class="mt-4 card" />
      <EmptyState v-else-if="store.tenders.length === 0" class="mt-4 card" title="No tenders found" />
      <ul v-else class="mt-4 divide-y divide-slate-100 card">
        <li v-for="t in store.tenders" :key="t.id" class="p-3 text-sm">
          <button type="button" class="text-left font-medium text-slate-900 hover:underline" @click="openTender(t.id)">
            {{ t.title }}
          </button>
          <StatusBadge class="ml-2" :status="t.status" />
          <p class="mt-0.5 text-xs text-slate-500">{{ t.tenderNumber }} · closes {{ t.closingDate.slice(0, 10) }}</p>
        </li>
      </ul>

      <div v-if="store.tenderDetail && selectedTenderId" class="mt-4 card p-4 text-sm">
        <h2 class="font-medium text-slate-900">{{ store.tenderDetail.title }}</h2>
        <p class="mt-1 text-slate-600">{{ store.tenderDetail.description }}</p>
        <h3 class="mt-3 text-xs font-medium uppercase text-slate-500">Lots</h3>
        <ul class="mt-1 space-y-2">
          <li v-for="lot in store.tenderDetail.lots" :key="lot.lotNumber" class="text-xs">
            <span class="font-medium">{{ lot.lotNumber }}</span> — {{ lot.description }} (est. {{ lot.estimatedAmount }})
            <div v-if="lot.award" class="mt-0.5 text-emerald-700">
              Awarded to {{ lot.award.supplierName }} for {{ lot.award.awardedAmount }}
            </div>
            <div v-else class="mt-0.5 text-slate-500">Not yet awarded</div>
          </li>
        </ul>
      </div>
    </div>

    <!-- Suppliers -->
    <div v-if="activeTab === 'suppliers'" class="mt-6">
      <form class="flex gap-2" @submit.prevent="store.searchSuppliers(supplierSearch)">
        <input v-model="supplierSearch" placeholder="Search suppliers by name" class="input w-72" />
        <button type="submit" class="btn btn-primary btn-sm">Search</button>
      </form>

      <div class="mt-4 table-shell">
        <table class="table-base text-xs">
          <thead>
            <tr>
              <th>Name</th>
              <th>Registration #</th>
              <th>County</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="store.loading">
              <td colspan="4" class="p-0"><SkeletonRows :rows="3" :columns="4" /></td>
            </tr>
            <tr v-else-if="store.suppliers.length === 0">
              <td colspan="4" class="p-0"><EmptyState title="No suppliers found" /></td>
            </tr>
            <tr v-for="s in store.suppliers" :key="s.id">
              <td>{{ s.name }}</td>
              <td class="font-mono">{{ s.registrationNumber }}</td>
              <td>{{ s.county ?? '—' }}</td>
              <td><StatusBadge :status="s.status" /></td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Budgets -->
    <div v-if="activeTab === 'budgets'" class="mt-6">
      <div class="table-shell">
        <table class="table-base text-xs">
          <thead>
            <tr>
              <th>Organization</th>
              <th>Fiscal year</th>
              <th>Vote</th>
              <th>Authorized</th>
              <th>Committed</th>
              <th>Spent</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="store.loading">
              <td colspan="6" class="p-0"><SkeletonRows :rows="3" :columns="6" /></td>
            </tr>
            <tr v-else-if="store.budgetLines.length === 0">
              <td colspan="6" class="p-0"><EmptyState title="No public budget data yet" /></td>
            </tr>
            <tr v-for="(b, i) in store.budgetLines" :key="i">
              <td>{{ b.organizationName }}</td>
              <td>{{ b.fiscalYearName }}</td>
              <td>{{ b.voteCode }} — {{ b.voteName }}</td>
              <td>{{ b.authorizedAmount }}</td>
              <td>{{ b.committedAmount }}</td>
              <td>{{ b.spentAmount }}</td>
            </tr>
          </tbody>
        </table>
      </div>
    </div>

    <!-- Verify a hash -->
    <div v-if="activeTab === 'verify'" class="mt-6 card p-6">
      <h2 class="section-title">Verify a piece of published evidence</h2>
      <p class="mt-1 text-xs text-slate-500">
        Paste the SHA-256 hash of a file (a project photo, report, etc.) to check whether it
        matches an officially recorded piece of evidence, whether it's anchored on the blockchain
        integrity layer, and whether its audit trail is still cryptographically intact.
      </p>
      <form class="mt-3 flex gap-2" @submit.prevent="handleVerify">
        <input
          v-model="hashInput"
          placeholder="64-character SHA-256 hex digest"
          class="input flex-1 font-mono"
        />
        <button type="submit" :disabled="store.loading" class="btn btn-primary btn-sm">
          {{ store.loading ? 'Checking…' : 'Verify' }}
        </button>
      </form>

      <div v-if="store.verification" class="mt-4 rounded-lg border p-3 text-sm" :class="store.verification.found ? 'border-slate-200' : 'border-amber-200 bg-amber-50'">
        <template v-if="!store.verification.found">
          <p class="text-amber-800">No matching evidence found for this hash.</p>
        </template>
        <template v-else>
          <p class="font-medium text-slate-900">{{ store.verification.fileName }}</p>
          <p class="text-xs text-slate-500">
            Project: {{ store.verification.projectName }}
            <template v-if="store.verification.milestoneTitle"> · Milestone: {{ store.verification.milestoneTitle }}</template>
          </p>
          <p class="mt-2 flex items-center gap-1.5 text-xs">
            <span class="h-2 w-2 rounded-full" :class="store.verification.anchored ? 'bg-emerald-500' : 'bg-slate-300'" aria-hidden="true" />
            {{ store.verification.anchored ? 'Anchored on the blockchain integrity layer' : 'Not yet anchored' }}
          </p>
          <p class="mt-1 flex items-center gap-1.5 text-xs">
            <span
              class="h-2 w-2 rounded-full"
              :class="store.verification.chainIntact === false ? 'bg-red-500' : 'bg-emerald-500'"
              aria-hidden="true"
            />
            <template v-if="store.verification.chainIntact === false">Integrity check failed — the audit record does not match</template>
            <template v-else-if="store.verification.chainIntact === true">Audit trail cryptographically intact</template>
            <template v-else>Audit trail record not available for this item</template>
          </p>
        </template>
      </div>
    </div>
    </section>
  </div>
</template>
