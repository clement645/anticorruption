<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useAuthStore } from '../stores/auth'
import { useRiskStore } from '../stores/risk'

const auth = useAuthStore()
const risk = useRiskStore()

const canReview = auth.hasPermission('risk:review')
const canManage = auth.hasPermission('risk:manage')

const filters = reactive({ status: '', severity: '', detectorType: '' })
const expandedId = ref<string | null>(null)
const notesByAlert = reactive<Record<string, string>>({})

const scanForm = reactive({
  kind: 'suppliers' as 'suppliers' | 'tenders' | 'organizations',
  resourceId: '',
})

async function applyFilters() {
  await risk.fetchAlerts({
    status: filters.status || undefined,
    severity: filters.severity || undefined,
    detectorType: filters.detectorType || undefined,
  })
}

function toggleEvidence(id: string) {
  expandedId.value = expandedId.value === id ? null : id
}

async function handleReview(alertId: string, status: 'UNDER_REVIEW' | 'CONFIRMED' | 'DISMISSED') {
  await risk.review(alertId, status, notesByAlert[alertId] || undefined)
  delete notesByAlert[alertId]
}

async function handleScan() {
  if (!scanForm.resourceId) return
  if (scanForm.kind === 'suppliers') await risk.scanSupplier(scanForm.resourceId)
  else if (scanForm.kind === 'tenders') await risk.scanTender(scanForm.resourceId)
  else await risk.scanOrganization(scanForm.resourceId)
  scanForm.resourceId = ''
}

onMounted(() => {
  risk.fetchAlerts()
})
</script>

<template>
  <section class="mx-auto max-w-5xl px-4 py-10">
    <h1 class="text-2xl font-semibold text-slate-900">AI Risk Engine</h1>
    <p class="mt-1 text-sm text-slate-600">
      Deterministic/statistical detector findings — advisory only. Nothing here blocks a transaction; a human
      always reviews before any action follows.
    </p>

    <p v-if="risk.error" class="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
      {{ risk.error }}
    </p>

    <div class="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <div class="flex flex-wrap items-end gap-2">
        <select v-model="filters.status" class="rounded-md border border-slate-300 px-2 py-1 text-sm">
          <option value="">All statuses</option>
          <option value="OPEN">Open</option>
          <option value="UNDER_REVIEW">Under review</option>
          <option value="CONFIRMED">Confirmed</option>
          <option value="DISMISSED">Dismissed</option>
        </select>
        <select v-model="filters.severity" class="rounded-md border border-slate-300 px-2 py-1 text-sm">
          <option value="">All severities</option>
          <option value="LOW">Low</option>
          <option value="MEDIUM">Medium</option>
          <option value="HIGH">High</option>
          <option value="CRITICAL">Critical</option>
        </select>
        <select v-model="filters.detectorType" class="rounded-md border border-slate-300 px-2 py-1 text-sm">
          <option value="">All detectors</option>
          <option value="PRICE_ANOMALY">Price anomaly</option>
          <option value="BID_COLLUSION">Bid collusion</option>
          <option value="SPLIT_PROCUREMENT">Split procurement</option>
          <option value="SUPPLIER_RISK">Supplier risk</option>
        </select>
        <button
          type="button"
          class="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
          @click="applyFilters"
        >
          Apply filters
        </button>
      </div>

      <table class="mt-4 w-full text-xs">
        <thead>
          <tr class="text-left text-slate-500">
            <th class="pr-2">Severity</th>
            <th class="pr-2">Detector</th>
            <th class="pr-2">Title</th>
            <th class="pr-2">Resource</th>
            <th class="pr-2">Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <template v-for="alert in risk.alerts" :key="alert.id">
            <tr class="border-t border-slate-100">
              <td class="py-1 pr-2">
                <span
                  class="rounded-full px-2 py-0.5 font-medium"
                  :class="{
                    'bg-emerald-100 text-emerald-800': alert.severity === 'LOW',
                    'bg-amber-100 text-amber-800': alert.severity === 'MEDIUM',
                    'bg-orange-100 text-orange-800': alert.severity === 'HIGH',
                    'bg-red-100 text-red-800': alert.severity === 'CRITICAL',
                  }"
                >
                  {{ alert.severity }}
                </span>
              </td>
              <td class="py-1 pr-2">{{ alert.detectorType }}</td>
              <td class="py-1 pr-2">{{ alert.title }}</td>
              <td class="py-1 pr-2 text-slate-500">{{ alert.resourceType }} {{ alert.resourceId.slice(0, 8) }}…</td>
              <td class="py-1 pr-2">{{ alert.status }}</td>
              <td class="py-1">
                <button class="underline" @click="toggleEvidence(alert.id)">
                  {{ expandedId === alert.id ? 'Hide' : 'Details' }}
                </button>
              </td>
            </tr>
            <tr v-if="expandedId === alert.id" class="border-t border-slate-100 bg-slate-50">
              <td colspan="6" class="p-3">
                <p class="text-slate-600">{{ alert.description }}</p>
                <pre class="mt-2 overflow-x-auto rounded bg-white p-2 text-[11px] text-slate-600">{{
                  JSON.stringify(alert.evidence, null, 2)
                }}</pre>
                <div v-if="alert.reviewedById" class="mt-2 text-slate-500">
                  Reviewed {{ new Date(alert.reviewedAt!).toLocaleString() }}
                  <span v-if="alert.reviewNotes"> — "{{ alert.reviewNotes }}"</span>
                </div>
                <div v-if="canReview && alert.status !== 'CONFIRMED' && alert.status !== 'DISMISSED'" class="mt-2 flex items-center gap-2">
                  <input
                    v-model="notesByAlert[alert.id]"
                    placeholder="Review notes"
                    class="w-56 rounded border border-slate-300 px-2 py-1"
                  />
                  <button
                    v-if="alert.status === 'OPEN'"
                    class="rounded border border-slate-300 px-2 py-1 hover:bg-white"
                    @click="handleReview(alert.id, 'UNDER_REVIEW')"
                  >
                    Mark under review
                  </button>
                  <button
                    class="rounded border border-red-300 px-2 py-1 text-red-700 hover:bg-red-50"
                    @click="handleReview(alert.id, 'CONFIRMED')"
                  >
                    Confirm
                  </button>
                  <button
                    class="rounded border border-slate-300 px-2 py-1 hover:bg-white"
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
      <p v-if="risk.alerts.length === 0" class="mt-3 text-xs text-slate-400">No alerts match these filters.</p>
    </div>

    <div v-if="canManage" class="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 class="text-sm font-medium text-slate-900">Manual re-scan</h2>
      <p class="mt-1 text-xs text-slate-500">
        Re-run a detector on demand against a specific tender, organization, or supplier by ID.
      </p>
      <form class="mt-3 flex flex-wrap items-end gap-2" @submit.prevent="handleScan">
        <select v-model="scanForm.kind" class="rounded-md border border-slate-300 px-2 py-1 text-sm">
          <option value="suppliers">Supplier risk</option>
          <option value="tenders">Tender (price anomaly + collusion)</option>
          <option value="organizations">Organization (split procurement)</option>
        </select>
        <input
          v-model="scanForm.resourceId"
          required
          placeholder="Resource ID"
          class="w-72 rounded-md border border-slate-300 px-2 py-1 text-sm"
        />
        <button type="submit" class="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800">
          Run scan
        </button>
      </form>
    </div>
  </section>
</template>
