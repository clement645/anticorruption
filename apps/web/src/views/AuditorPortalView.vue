<script setup lang="ts">
import { reactive } from 'vue'
import { useAuditStore } from '../stores/audit'

const audit = useAuditStore()

const searchForm = reactive({ resourceType: '', resourceId: '' })

const commonResourceTypes = [
  'Contract',
  'PurchaseOrder',
  'Invoice',
  'PaymentRequest',
  'Payment',
  'Project',
  'Milestone',
  'Inspection',
  'ProjectEvidence',
  'Award',
  'Tender',
  'Supplier',
  'Budget',
  'Allocation',
  'User',
]

async function handleReconstruct() {
  if (!searchForm.resourceType || !searchForm.resourceId) return
  await audit.reconstruct(searchForm.resourceType.trim(), searchForm.resourceId.trim())
}

function formatEventType(eventType: string): string {
  return eventType.replaceAll('_', ' ')
}
</script>

<template>
  <section class="mx-auto max-w-5xl px-4 py-10">
    <h1 class="text-2xl font-semibold text-slate-900">Auditor Portal</h1>
    <p class="mt-1 text-sm text-slate-600">
      Transaction reconstruction: the full, independently re-verified audit history of any one
      resource in the system, plus its blockchain anchor status — not a raw event dump, a
      forensic case file.
    </p>

    <div class="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 class="text-sm font-medium text-slate-900">Reconstruct a resource's history</h2>
      <form class="mt-3 flex flex-wrap items-end gap-2" @submit.prevent="handleReconstruct">
        <div>
          <label class="block text-xs text-slate-500">Resource type</label>
          <input
            v-model="searchForm.resourceType"
            required
            list="resource-types"
            placeholder="e.g. Contract"
            class="w-48 rounded-md border border-slate-300 px-2 py-1 text-sm"
          />
          <datalist id="resource-types">
            <option v-for="rt in commonResourceTypes" :key="rt" :value="rt" />
          </datalist>
        </div>
        <div>
          <label class="block text-xs text-slate-500">Resource ID</label>
          <input
            v-model="searchForm.resourceId"
            required
            placeholder="UUID"
            class="w-80 rounded-md border border-slate-300 px-2 py-1 text-sm"
          />
        </div>
        <button
          type="submit"
          :disabled="audit.reconstructing"
          class="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
        >
          {{ audit.reconstructing ? 'Reconstructing…' : 'Reconstruct' }}
        </button>
      </form>
      <p class="mt-2 text-[11px] text-slate-400">
        `resourceType`/`resourceId` are plain identifiers recorded on every audit event — not a
        foreign key into any one table — so any tracked resource in the system can be looked up
        here regardless of which module it belongs to.
      </p>
    </div>

    <p v-if="audit.reconstructError" class="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
      {{ audit.reconstructError }}
    </p>

    <div v-if="audit.reconstruction" class="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <div class="flex items-center justify-between">
        <h2 class="text-sm font-medium text-slate-900">
          {{ audit.reconstruction.resourceType }} — {{ audit.reconstruction.resourceId.slice(0, 8) }}…
        </h2>
        <span
          class="inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-xs font-medium"
          :class="audit.reconstruction.fullyVerified ? 'bg-emerald-50 text-emerald-700' : 'bg-red-50 text-red-700'"
        >
          <span
            class="h-2 w-2 rounded-full"
            :class="audit.reconstruction.fullyVerified ? 'bg-emerald-500' : 'bg-red-500'"
            aria-hidden="true"
          />
          {{ audit.reconstruction.fullyVerified ? 'Fully verified' : 'Integrity failure detected' }}
        </span>
      </div>
      <p class="mt-1 text-xs text-slate-500">{{ audit.reconstruction.totalEvents }} event(s) found</p>

      <p v-if="audit.reconstruction.totalEvents === 0" class="mt-4 text-sm text-slate-500">
        No audit events found for this resource — check the type and ID, or this resource simply
        has no recorded history.
      </p>

      <ol v-else class="mt-4 space-y-3">
        <li
          v-for="entry in audit.reconstruction.events"
          :key="entry.event.id"
          class="rounded-md border p-3 text-xs"
          :class="entry.verified ? 'border-slate-100' : 'border-red-300 bg-red-50'"
        >
          <div class="flex items-center justify-between">
            <span class="font-medium text-slate-900">{{ formatEventType(entry.event.eventType) }}</span>
            <span class="text-slate-400">{{ new Date(entry.event.createdAt).toLocaleString() }}</span>
          </div>
          <p class="mt-1 text-slate-500">
            Sequence {{ entry.event.sequence }} · actor {{ entry.event.actorEmail ?? '—' }}
          </p>

          <div class="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
            <span :class="entry.checks.payloadHashValid ? 'text-emerald-700' : 'text-red-700'">
              {{ entry.checks.payloadHashValid ? '✓' : '✗' }} payload hash
            </span>
            <span :class="entry.checks.chainLinkValid ? 'text-emerald-700' : 'text-red-700'">
              {{ entry.checks.chainLinkValid ? '✓' : '✗' }} chain link
            </span>
            <span :class="entry.checks.currentHashValid ? 'text-emerald-700' : 'text-red-700'">
              {{ entry.checks.currentHashValid ? '✓' : '✗' }} current hash
            </span>
            <span :class="entry.checks.signatureValid ? 'text-emerald-700' : 'text-red-700'">
              {{ entry.checks.signatureValid ? '✓' : '✗' }} signature
            </span>
            <span :class="entry.blockchainAnchor.anchored ? 'text-emerald-700' : 'text-slate-400'">
              {{ entry.blockchainAnchor.anchored ? '✓' : '—' }} blockchain anchor
            </span>
          </div>
        </li>
      </ol>
    </div>
  </section>
</template>
