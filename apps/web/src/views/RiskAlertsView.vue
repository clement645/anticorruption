<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { ChevronLeft, ChevronRight } from '@lucide/vue'
import { useAuthStore } from '../stores/auth'
import { useRiskStore } from '../stores/risk'
import PageHeader from '../components/ui/PageHeader.vue'
import StatusBadge from '../components/ui/StatusBadge.vue'
import AlertBanner from '../components/ui/AlertBanner.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import SkeletonRows from '../components/ui/SkeletonRows.vue'
import { notify } from '../components/ui/toast'

const auth = useAuthStore()
const risk = useRiskStore()

const canReview = auth.hasPermission('risk:review')
const canManage = auth.hasPermission('risk:manage')

const PAGE_SIZE = 25
const page = ref(0)
const filters = reactive({ status: '', severity: '', detectorType: '' })
const expandedId = ref<string | null>(null)
const notesByAlert = reactive<Record<string, string>>({})

const scanForm = reactive({
  kind: 'suppliers' as 'suppliers' | 'tenders' | 'organizations',
  resourceId: '',
})

const totalPages = computed(() => Math.max(1, Math.ceil(risk.total / PAGE_SIZE)))
const rangeStart = computed(() => (risk.total === 0 ? 0 : page.value * PAGE_SIZE + 1))
const rangeEnd = computed(() => Math.min(risk.total, (page.value + 1) * PAGE_SIZE))

function currentQuery() {
  return {
    status: filters.status || undefined,
    severity: filters.severity || undefined,
    detectorType: filters.detectorType || undefined,
    skip: page.value * PAGE_SIZE,
    take: PAGE_SIZE,
  }
}

function reload() {
  void risk.fetchAlerts(currentQuery())
}

function applyFilters() {
  page.value = 0
  reload()
}

function goToPage(next: number) {
  page.value = next
  reload()
}

function toggleEvidence(id: string) {
  expandedId.value = expandedId.value === id ? null : id
}

async function handleReview(alertId: string, status: 'UNDER_REVIEW' | 'CONFIRMED' | 'DISMISSED') {
  await risk.review(alertId, status, notesByAlert[alertId] || undefined)
  if (!risk.error) {
    delete notesByAlert[alertId]
    notify(status === 'UNDER_REVIEW' ? 'Marked under review.' : status === 'CONFIRMED' ? 'Alert confirmed.' : 'Alert dismissed.')
  }
}

async function handleScan() {
  if (!scanForm.resourceId) return
  if (scanForm.kind === 'suppliers') await risk.scanSupplier(scanForm.resourceId)
  else if (scanForm.kind === 'tenders') await risk.scanTender(scanForm.resourceId)
  else await risk.scanOrganization(scanForm.resourceId)
  if (!risk.error) {
    notify('Scan complete.')
    scanForm.resourceId = ''
  }
}

onMounted(() => {
  void risk.fetchAlerts(currentQuery())
})
</script>

<template>
  <section class="mx-auto max-w-5xl px-4 py-10">
    <PageHeader
      title="AI risk engine"
      subtitle="Deterministic/statistical detector findings — advisory only. Nothing here blocks a transaction; a human always reviews before any action follows."
    />

    <AlertBanner v-if="risk.error" class="mt-4">{{ risk.error }}</AlertBanner>

    <div class="mt-6 table-shell">
      <div class="flex flex-wrap items-end gap-2 p-4">
        <select v-model="filters.status" class="select w-auto max-w-full" aria-label="Filter by status">
          <option value="">All statuses</option>
          <option value="OPEN">Open</option>
          <option value="UNDER_REVIEW">Under review</option>
          <option value="CONFIRMED">Confirmed</option>
          <option value="DISMISSED">Dismissed</option>
        </select>
        <select v-model="filters.severity" class="select w-auto max-w-full" aria-label="Filter by severity">
          <option value="">All severities</option>
          <option value="LOW">Low</option>
          <option value="MEDIUM">Medium</option>
          <option value="HIGH">High</option>
          <option value="CRITICAL">Critical</option>
        </select>
        <select v-model="filters.detectorType" class="select w-auto max-w-full" aria-label="Filter by detector">
          <option value="">All detectors</option>
          <option value="PRICE_ANOMALY">Price anomaly</option>
          <option value="BID_COLLUSION">Bid collusion</option>
          <option value="SPLIT_PROCUREMENT">Split procurement</option>
          <option value="SUPPLIER_RISK">Supplier risk</option>
        </select>
        <button type="button" class="btn btn-primary btn-sm" @click="applyFilters">Apply filters</button>
      </div>

      <table class="table-base">
        <thead>
          <tr>
            <th>Severity</th>
            <th>Detector</th>
            <th>Title</th>
            <th>Resource</th>
            <th>Status</th>
            <th><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="risk.loading">
            <td colspan="6" class="p-0"><SkeletonRows :rows="5" :columns="5" /></td>
          </tr>
          <tr v-else-if="risk.alerts.length === 0">
            <td colspan="6" class="p-0"><EmptyState title="No alerts match these filters" /></td>
          </tr>
          <template v-for="alert in risk.alerts" :key="alert.id">
            <tr>
              <td><StatusBadge :status="alert.severity" /></td>
              <td class="text-slate-600">{{ alert.detectorType }}</td>
              <td class="font-medium text-slate-900">{{ alert.title }}</td>
              <td class="text-slate-500">{{ alert.resourceType }} {{ alert.resourceId.slice(0, 8) }}…</td>
              <td><StatusBadge :status="alert.status" /></td>
              <td>
                <button type="button" class="btn btn-ghost btn-sm" @click="toggleEvidence(alert.id)">
                  {{ expandedId === alert.id ? 'Hide' : 'Details' }}
                </button>
              </td>
            </tr>
            <tr v-if="expandedId === alert.id" class="bg-slate-50/60">
              <td colspan="6" class="text-xs">
                <p class="text-slate-600">{{ alert.description }}</p>
                <pre class="mt-2 overflow-x-auto rounded-lg bg-white p-2 text-[11px] text-slate-600">{{
                  JSON.stringify(alert.evidence, null, 2)
                }}</pre>
                <div v-if="alert.reviewedById" class="mt-2 text-slate-500">
                  Reviewed {{ new Date(alert.reviewedAt!).toLocaleString() }}
                  <span v-if="alert.reviewNotes"> — "{{ alert.reviewNotes }}"</span>
                </div>
                <div v-if="canReview && alert.status !== 'CONFIRMED' && alert.status !== 'DISMISSED'" class="mt-2 flex items-center gap-2">
                  <label class="sr-only" :for="`notes-${alert.id}`">Review notes</label>
                  <input
                    :id="`notes-${alert.id}`"
                    v-model="notesByAlert[alert.id]"
                    placeholder="Review notes"
                    class="input w-56 px-2 py-1 text-xs"
                  />
                  <button
                    v-if="alert.status === 'OPEN'"
                    class="btn btn-secondary btn-sm"
                    @click="handleReview(alert.id, 'UNDER_REVIEW')"
                  >
                    Mark under review
                  </button>
                  <button
                    class="btn btn-secondary btn-sm text-red-700"
                    @click="handleReview(alert.id, 'CONFIRMED')"
                  >
                    Confirm
                  </button>
                  <button
                    class="btn btn-secondary btn-sm"
                    @click="handleReview(alert.id, 'DISMISSED')"
                  >
                    Dismiss
                  </button>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>

      <div v-if="risk.total > 0" class="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-sm text-slate-600">
        <p>Showing {{ rangeStart }}–{{ rangeEnd }} of {{ risk.total }}</p>
        <div class="flex gap-2">
          <button type="button" class="btn btn-secondary btn-sm" :disabled="page === 0 || risk.loading" @click="goToPage(page - 1)">
            <ChevronLeft class="h-3.5 w-3.5" />
            Previous
          </button>
          <button
            type="button"
            class="btn btn-secondary btn-sm"
            :disabled="page >= totalPages - 1 || risk.loading"
            @click="goToPage(page + 1)"
          >
            Next
            <ChevronRight class="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>

    <div v-if="canManage" class="mt-6 card p-6">
      <h2 class="section-title">Manual re-scan</h2>
      <p class="mt-1 text-xs text-slate-500">
        Re-run a detector on demand against a specific tender, organization, or supplier by ID.
      </p>
      <form class="mt-3 flex flex-wrap items-end gap-2" @submit.prevent="handleScan">
        <div>
          <label class="field-label" for="scan-kind">Scan type</label>
          <select id="scan-kind" v-model="scanForm.kind" class="select mt-1 w-auto">
            <option value="suppliers">Supplier risk</option>
            <option value="tenders">Tender (price anomaly + collusion)</option>
            <option value="organizations">Organization (split procurement)</option>
          </select>
        </div>
        <div>
          <label class="field-label" for="scan-resource-id">Resource ID</label>
          <input id="scan-resource-id" v-model="scanForm.resourceId" required placeholder="Resource ID" class="input mt-1 w-72" />
        </div>
        <button type="submit" class="btn btn-primary btn-sm">Run scan</button>
      </form>
    </div>
  </section>
</template>
