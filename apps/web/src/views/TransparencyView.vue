<script setup lang="ts">
import { ref } from 'vue'
import { useTransparencyStore } from '../stores/transparency'

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

function statusColor(status: string): string {
  if (['COMPLETED', 'VERIFIED', 'ACTIVE', 'AWARDED', 'MATCHED'].includes(status)) return 'text-emerald-700'
  if (['CANCELLED', 'REJECTED', 'SUSPENDED', 'BLACKLISTED'].includes(status)) return 'text-red-700'
  return 'text-slate-600'
}
</script>

<template>
  <section class="mx-auto max-w-5xl px-4 py-10">
    <h1 class="text-2xl font-semibold text-slate-900">Citizen Transparency Portal</h1>
    <p class="mt-1 text-sm text-slate-600">
      Public, no sign-in required. Search public projects, tenders, and suppliers, view where
      public budgets are allocated, and independently verify the hash of any piece of published
      evidence.
    </p>

    <nav class="mt-6 flex flex-wrap gap-1 border-b border-slate-200 text-sm">
      <button
        v-for="tab in (['projects', 'tenders', 'suppliers', 'budgets', 'verify'] as Tab[])"
        :key="tab"
        type="button"
        class="rounded-t-md px-3 py-2 capitalize"
        :class="activeTab === tab ? 'border-b-2 border-slate-900 font-medium text-slate-900' : 'text-slate-500 hover:text-slate-800'"
        @click="setTab(tab)"
      >
        {{ tab === 'verify' ? 'Verify a hash' : tab }}
      </button>
    </nav>

    <p v-if="store.error" class="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
      {{ store.error }}
    </p>

    <!-- Projects -->
    <div v-if="activeTab === 'projects'" class="mt-6">
      <form class="flex gap-2" @submit.prevent="store.searchProjects(projectSearch)">
        <input v-model="projectSearch" placeholder="Search projects by name" class="w-72 rounded-md border border-slate-300 px-2 py-1 text-sm" />
        <button type="submit" class="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800">Search</button>
      </form>

      <ul class="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
        <li v-for="p in store.projects" :key="p.id" class="p-3 text-sm">
          <button type="button" class="text-left font-medium text-slate-900 hover:underline" @click="openProject(p.id)">
            {{ p.name }}
          </button>
          <span class="ml-2 text-xs" :class="statusColor(p.status)">{{ p.status }}</span>
          <p class="text-xs text-slate-500">{{ p.organizationName }} · {{ p.location ?? 'location not recorded' }}</p>
        </li>
        <li v-if="store.projects.length === 0" class="p-3 text-sm text-slate-500">No projects found.</li>
      </ul>

      <div v-if="store.projectDetail && selectedProjectId" class="mt-4 rounded-lg border border-slate-200 bg-white p-4 text-sm">
        <h2 class="font-medium text-slate-900">{{ store.projectDetail.name }}</h2>
        <p class="mt-1 text-slate-600">{{ store.projectDetail.description }}</p>
        <p class="mt-2 text-xs text-slate-500">
          {{ store.projectDetail.startDate.slice(0, 10) }} → {{ store.projectDetail.plannedEndDate.slice(0, 10) }}
          <template v-if="store.projectDetail.actualEndDate"> (completed {{ store.projectDetail.actualEndDate.slice(0, 10) }})</template>
        </p>

        <h3 class="mt-3 text-xs font-medium uppercase text-slate-500">Milestones</h3>
        <ul class="mt-1 space-y-1">
          <li v-for="m in store.projectDetail.milestones" :key="m.sequenceNumber" class="text-xs">
            #{{ m.sequenceNumber }} {{ m.title }} — <span :class="statusColor(m.status)">{{ m.status }}</span>
            ({{ m.plannedAmount }}, due {{ m.plannedDate.slice(0, 10) }})
          </li>
        </ul>

        <h3 class="mt-3 text-xs font-medium uppercase text-slate-500">Published evidence</h3>
        <ul class="mt-1 space-y-1">
          <li v-for="e in store.projectDetail.evidence" :key="e.id" class="text-xs">
            {{ e.fileName }} — <span class="font-mono">{{ e.fileHash.slice(0, 16) }}…</span>
            <span v-if="e.anchored" class="text-emerald-700">(anchored)</span>
          </li>
          <li v-if="store.projectDetail.evidence.length === 0" class="text-xs text-slate-400">No evidence published yet.</li>
        </ul>
      </div>
    </div>

    <!-- Tenders -->
    <div v-if="activeTab === 'tenders'" class="mt-6">
      <form class="flex gap-2" @submit.prevent="store.searchTenders(tenderSearch)">
        <input v-model="tenderSearch" placeholder="Search tenders by title" class="w-72 rounded-md border border-slate-300 px-2 py-1 text-sm" />
        <button type="submit" class="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800">Search</button>
      </form>
      <p class="mt-1 text-[11px] text-slate-400">Only published tenders appear here — drafts are internal.</p>

      <ul class="mt-4 divide-y divide-slate-100 rounded-lg border border-slate-200 bg-white">
        <li v-for="t in store.tenders" :key="t.id" class="p-3 text-sm">
          <button type="button" class="text-left font-medium text-slate-900 hover:underline" @click="openTender(t.id)">
            {{ t.title }}
          </button>
          <span class="ml-2 text-xs" :class="statusColor(t.status)">{{ t.status }}</span>
          <p class="text-xs text-slate-500">{{ t.tenderNumber }} · closes {{ t.closingDate.slice(0, 10) }}</p>
        </li>
        <li v-if="store.tenders.length === 0" class="p-3 text-sm text-slate-500">No tenders found.</li>
      </ul>

      <div v-if="store.tenderDetail && selectedTenderId" class="mt-4 rounded-lg border border-slate-200 bg-white p-4 text-sm">
        <h2 class="font-medium text-slate-900">{{ store.tenderDetail.title }}</h2>
        <p class="mt-1 text-slate-600">{{ store.tenderDetail.description }}</p>
        <h3 class="mt-3 text-xs font-medium uppercase text-slate-500">Lots</h3>
        <ul class="mt-1 space-y-2">
          <li v-for="lot in store.tenderDetail.lots" :key="lot.lotNumber" class="text-xs">
            <span class="font-medium">{{ lot.lotNumber }}</span> — {{ lot.description }} (est. {{ lot.estimatedAmount }})
            <div v-if="lot.award" class="mt-0.5 text-emerald-700">
              Awarded to {{ lot.award.supplierName }} for {{ lot.award.awardedAmount }}
            </div>
            <div v-else class="mt-0.5 text-slate-400">Not yet awarded</div>
          </li>
        </ul>
      </div>
    </div>

    <!-- Suppliers -->
    <div v-if="activeTab === 'suppliers'" class="mt-6">
      <form class="flex gap-2" @submit.prevent="store.searchSuppliers(supplierSearch)">
        <input v-model="supplierSearch" placeholder="Search suppliers by name" class="w-72 rounded-md border border-slate-300 px-2 py-1 text-sm" />
        <button type="submit" class="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800">Search</button>
      </form>

      <table class="mt-4 w-full rounded-lg border border-slate-200 bg-white text-xs">
        <thead>
          <tr class="border-b border-slate-100 text-left text-slate-500">
            <th class="px-3 py-2">Name</th>
            <th class="px-3 py-2">Registration #</th>
            <th class="px-3 py-2">County</th>
            <th class="px-3 py-2">Status</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="s in store.suppliers" :key="s.id" class="border-b border-slate-50">
            <td class="px-3 py-2">{{ s.name }}</td>
            <td class="px-3 py-2 font-mono">{{ s.registrationNumber }}</td>
            <td class="px-3 py-2">{{ s.county ?? '—' }}</td>
            <td class="px-3 py-2" :class="statusColor(s.status)">{{ s.status }}</td>
          </tr>
          <tr v-if="store.suppliers.length === 0">
            <td colspan="4" class="px-3 py-6 text-center text-slate-500">No suppliers found.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Budgets -->
    <div v-if="activeTab === 'budgets'" class="mt-6">
      <table class="w-full rounded-lg border border-slate-200 bg-white text-xs">
        <thead>
          <tr class="border-b border-slate-100 text-left text-slate-500">
            <th class="px-3 py-2">Organization</th>
            <th class="px-3 py-2">Fiscal year</th>
            <th class="px-3 py-2">Vote</th>
            <th class="px-3 py-2">Authorized</th>
            <th class="px-3 py-2">Committed</th>
            <th class="px-3 py-2">Spent</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="(b, i) in store.budgetLines" :key="i" class="border-b border-slate-50">
            <td class="px-3 py-2">{{ b.organizationName }}</td>
            <td class="px-3 py-2">{{ b.fiscalYearName }}</td>
            <td class="px-3 py-2">{{ b.voteCode }} — {{ b.voteName }}</td>
            <td class="px-3 py-2">{{ b.authorizedAmount }}</td>
            <td class="px-3 py-2">{{ b.committedAmount }}</td>
            <td class="px-3 py-2">{{ b.spentAmount }}</td>
          </tr>
          <tr v-if="store.budgetLines.length === 0">
            <td colspan="6" class="px-3 py-6 text-center text-slate-500">No public budget data yet.</td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Verify a hash -->
    <div v-if="activeTab === 'verify'" class="mt-6 rounded-lg border border-slate-200 bg-white p-6">
      <h2 class="text-sm font-medium text-slate-900">Verify a piece of published evidence</h2>
      <p class="mt-1 text-xs text-slate-500">
        Paste the SHA-256 hash of a file (a project photo, report, etc.) to check whether it
        matches an officially recorded piece of evidence, whether it's anchored on the blockchain
        integrity layer, and whether its audit trail is still cryptographically intact.
      </p>
      <form class="mt-3 flex gap-2" @submit.prevent="handleVerify">
        <input
          v-model="hashInput"
          placeholder="64-character SHA-256 hex digest"
          class="flex-1 rounded-md border border-slate-300 px-2 py-1 font-mono text-sm"
        />
        <button type="submit" :disabled="store.loading" class="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50">
          {{ store.loading ? 'Checking…' : 'Verify' }}
        </button>
      </form>

      <div v-if="store.verification" class="mt-4 rounded-md border p-3 text-sm" :class="store.verification.found ? 'border-slate-200' : 'border-amber-200 bg-amber-50'">
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
</template>
