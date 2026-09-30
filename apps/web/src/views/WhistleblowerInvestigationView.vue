<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useWhistleblowerStore } from '../stores/whistleblower'

const store = useWhistleblowerStore()
const selectedId = ref<string | null>(null)
const statusFilter = ref('')
const updateMessage = ref('')

onMounted(() => {
  void store.fetchReports()
})

async function applyFilter() {
  await store.fetchReports(statusFilter.value || undefined)
}

async function open(id: string) {
  selectedId.value = id
  await store.fetchReportDetail(id)
}

async function handleAssign() {
  if (!selectedId.value) return
  await store.assignToSelf(selectedId.value)
}

async function handleChangeStatus(status: string) {
  if (!selectedId.value) return
  await store.changeStatus(selectedId.value, status)
}

async function handlePostUpdate() {
  if (!selectedId.value || !updateMessage.value.trim()) return
  await store.postInvestigatorUpdate(selectedId.value, updateMessage.value.trim())
  updateMessage.value = ''
}

function formatCategory(category: string): string {
  return category.replaceAll('_', ' ')
}

function nextStatuses(current: string): string[] {
  if (current === 'SUBMITTED') return ['UNDER_REVIEW']
  if (current === 'UNDER_REVIEW') return ['SUBSTANTIATED', 'UNSUBSTANTIATED']
  return []
}
</script>

<template>
  <section class="mx-auto max-w-5xl px-4 py-10">
    <div class="page-header">
      <h1 class="page-title">Whistleblower Investigations</h1>
      <p class="page-subtitle">
        Restricted to Auditor / Internal Auditor — the reporter's identity is never collected
        unless they chose to leave contact information.
      </p>
    </div>

    <p v-if="store.error" class="mt-4 alert-error">
      {{ store.error }}
    </p>

    <div class="mt-6 grid grid-cols-1 gap-6 md:grid-cols-2">
      <div class="card p-4">
        <div class="flex items-center justify-between">
          <h2 class="section-title">Reports</h2>
          <select v-model="statusFilter" class="select w-auto px-2 py-1 text-xs" @change="applyFilter">
            <option value="">All statuses</option>
            <option value="SUBMITTED">Submitted</option>
            <option value="UNDER_REVIEW">Under review</option>
            <option value="SUBSTANTIATED">Substantiated</option>
            <option value="UNSUBSTANTIATED">Unsubstantiated</option>
          </select>
        </div>
        <ul class="mt-3 divide-y divide-slate-100">
          <li v-for="r in store.reports" :key="r.id" class="py-2">
            <button
              type="button"
              class="w-full text-left text-xs hover:bg-slate-50"
              :class="{ 'font-medium': selectedId === r.id }"
              @click="open(r.id)"
            >
              <div class="flex items-center justify-between">
                <span>{{ formatCategory(r.category) }}</span>
                <span
                  class="badge"
                  :class="{
                    'badge-neutral': r.status === 'SUBMITTED',
                    'badge-warning': r.status === 'UNDER_REVIEW',
                    'badge-success': r.status === 'SUBSTANTIATED',
                    'badge-danger': r.status === 'UNSUBSTANTIATED',
                  }"
                >
                  {{ r.status }}
                </span>
              </div>
              <p class="mt-1 line-clamp-2 text-slate-500">{{ r.description }}</p>
            </button>
          </li>
          <li v-if="store.reports.length === 0" class="py-6 text-center text-xs text-slate-400">
            No reports.
          </li>
        </ul>
      </div>

      <div v-if="store.reportDetail" class="card p-4 text-sm">
        <div class="flex items-center justify-between">
          <h2 class="section-title">{{ formatCategory(store.reportDetail.category) }}</h2>
          <span
            class="badge"
            :class="{
              'badge-neutral': store.reportDetail.status === 'SUBMITTED',
              'badge-warning': store.reportDetail.status === 'UNDER_REVIEW',
              'badge-success': store.reportDetail.status === 'SUBSTANTIATED',
              'badge-danger': store.reportDetail.status === 'UNSUBSTANTIATED',
            }"
          >
            {{ store.reportDetail.status }}
          </span>
        </div>
        <p class="mt-2 text-slate-600">{{ store.reportDetail.description }}</p>
        <p v-if="store.reportDetail.contact" class="mt-2 text-xs text-slate-500">
          Contact left by reporter: <span class="font-medium">{{ store.reportDetail.contact }}</span>
        </p>

        <div class="mt-3 flex flex-wrap items-center gap-2">
          <button
            v-if="!store.reportDetail.assignedToId"
            type="button"
            class="btn btn-secondary btn-sm"
            @click="handleAssign"
          >
            Assign to me
          </button>
          <button
            v-for="s in nextStatuses(store.reportDetail.status)"
            :key="s"
            type="button"
            class="btn btn-secondary btn-sm"
            @click="handleChangeStatus(s)"
          >
            Mark {{ s.toLowerCase().replaceAll('_', ' ') }}
          </button>
        </div>

        <h3 class="mt-4 text-xs font-medium uppercase text-slate-500">Evidence</h3>
        <ul class="mt-1 space-y-1">
          <li v-for="e in store.reportDetail.evidence" :key="e.id" class="text-xs text-slate-600">
            {{ e.fileName }} — <span class="font-mono">{{ e.fileHash.slice(0, 12) }}…</span>
            <span v-if="e.anchored" class="text-emerald-700">(anchored)</span>
          </li>
          <li v-if="store.reportDetail.evidence.length === 0" class="text-xs text-slate-400">None.</li>
        </ul>

        <h3 class="mt-4 text-xs font-medium uppercase text-slate-500">Conversation</h3>
        <ul class="mt-1 space-y-2">
          <li v-for="u in store.reportDetail.updates" :key="u.id" class="text-xs">
            <span class="font-medium" :class="u.author === 'INVESTIGATOR' ? 'text-slate-900' : 'text-slate-600'">
              {{ u.author === 'INVESTIGATOR' ? 'You' : 'Reporter' }}:
            </span>
            {{ u.message }}
          </li>
          <li v-if="store.reportDetail.updates.length === 0" class="text-xs text-slate-400">No messages yet.</li>
        </ul>
        <form class="mt-3 flex gap-2" @submit.prevent="handlePostUpdate">
          <input v-model="updateMessage" placeholder="Ask a follow-up question…" class="input flex-1 px-2 py-1 text-xs" />
          <button type="submit" class="btn btn-secondary btn-sm">Send</button>
        </form>
      </div>
      <div v-else class="rounded-xl border border-dashed border-slate-200 p-6 text-center text-xs text-slate-400">
        Select a report to view details.
      </div>
    </div>
  </section>
</template>
