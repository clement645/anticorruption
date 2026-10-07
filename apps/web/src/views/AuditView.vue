<script setup lang="ts">
import { onMounted, ref } from 'vue'
import { useAuditStore } from '../stores/audit'
import { useAuthStore } from '../stores/auth'
import { useBlockchainStore } from '../stores/blockchain'
import PageHeader from '../components/ui/PageHeader.vue'
import AlertBanner from '../components/ui/AlertBanner.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import SkeletonRows from '../components/ui/SkeletonRows.vue'
import { notify } from '../components/ui/toast'

const audit = useAuditStore()
const auth = useAuthStore()
const blockchain = useBlockchainStore()

const expandedEventId = ref<string | null>(null)

onMounted(() => {
  void audit.fetchEvents()
  void audit.verifyChain()
  void blockchain.fetchHealth()
})

function formatEventType(eventType: string): string {
  return eventType.replaceAll('_', ' ')
}

async function handleAnchorNow() {
  blockchain.error = null
  await blockchain.triggerAnchor()
  if (!blockchain.error) {
    notify(
      blockchain.lastRun?.anchoredCount
        ? `Anchored ${blockchain.lastRun.anchoredCount} event(s).`
        : 'Nothing pending — all events were already anchored.',
    )
    await audit.fetchEvents()
  }
}

async function toggleVerify(eventId: string) {
  if (expandedEventId.value === eventId) {
    expandedEventId.value = null
    return
  }
  expandedEventId.value = eventId
  if (!audit.eventVerifications[eventId]) {
    await audit.verifyEvent(eventId)
  }
}
</script>

<template>
  <section class="mx-auto max-w-5xl px-4 py-10">
    <PageHeader title="Audit trail" subtitle="Append-only, hash-chained, digitally signed record of significant actions." />

    <div class="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div class="card p-6">
        <div class="flex items-center justify-between">
          <h2 class="section-title">Chain integrity</h2>
          <button
            type="button"
            class="btn btn-secondary btn-sm"
            :disabled="audit.verifying"
            @click="audit.verifyChain()"
          >
            {{ audit.verifying ? 'Verifying…' : 'Re-verify chain' }}
          </button>
        </div>

        <div v-if="audit.verifyError" class="mt-3 text-sm text-red-700">
          {{ audit.verifyError }}
        </div>
        <div v-else-if="audit.verification" class="mt-3 flex items-start gap-2">
          <span
            class="mt-1 h-2.5 w-2.5 flex-none rounded-full"
            :class="audit.verification.valid ? 'bg-emerald-500' : 'bg-red-500'"
            aria-hidden="true"
          />
          <div>
            <span class="text-sm font-medium text-slate-900">
              {{ audit.verification.valid ? 'Chain intact' : 'Chain integrity failure detected' }}
            </span>
            <p class="text-xs text-slate-500">
              {{ audit.verification.totalChecked }} event{{
                audit.verification.totalChecked === 1 ? '' : 's'
              }}
              checked<template v-if="!audit.verification.valid">
                — broken at sequence {{ audit.verification.brokenAtSequence }} ({{
                  audit.verification.reason
                }})</template
              >
            </p>
          </div>
        </div>
      </div>

      <div class="card p-6">
        <div class="flex items-center justify-between">
          <h2 class="section-title">Blockchain integrity layer</h2>
          <button
            v-if="auth.hasPermission('blockchain:anchor')"
            type="button"
            class="btn btn-secondary btn-sm"
            :disabled="blockchain.anchoring"
            @click="handleAnchorNow"
          >
            {{ blockchain.anchoring ? 'Anchoring…' : 'Anchor now' }}
          </button>
        </div>

        <div v-if="blockchain.error" class="mt-3 text-sm text-red-700">{{ blockchain.error }}</div>
        <div v-else-if="blockchain.health" class="mt-3 flex items-start gap-2">
          <span
            class="mt-1 h-2.5 w-2.5 flex-none rounded-full"
            :class="blockchain.health.healthy ? 'bg-emerald-500' : 'bg-red-500'"
            aria-hidden="true"
          />
          <div>
            <span class="text-sm font-medium text-slate-900">
              {{ blockchain.health.adapter }} adapter — {{ blockchain.health.healthy ? 'healthy' : 'unhealthy' }}
            </span>
            <p class="text-xs text-slate-500">
              {{ blockchain.health.details?.totalBlocks ?? 0 }} block(s),
              {{ blockchain.health.details?.totalTransactions ?? 0 }} transaction(s)
            </p>
            <p v-if="blockchain.lastRun" class="mt-1 text-xs text-slate-500">
              Last run anchored {{ blockchain.lastRun.anchoredCount }} event(s)
            </p>
          </div>
        </div>
      </div>
    </div>

    <AlertBanner v-if="audit.error" class="mt-6">{{ audit.error }}</AlertBanner>

    <div class="mt-6 table-shell">
      <table class="table-base">
        <thead>
          <tr>
            <th>Seq</th>
            <th>Event</th>
            <th>Actor</th>
            <th>Resource</th>
            <th>Anchored</th>
            <th>When</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="audit.loading && audit.events.length === 0">
            <td colspan="7" class="p-0"><SkeletonRows :rows="5" :columns="6" /></td>
          </tr>
          <tr v-else-if="!audit.error && audit.events.length === 0">
            <td colspan="7" class="p-0"><EmptyState title="No audit events yet" /></td>
          </tr>
          <template v-for="event in audit.events" :key="event.id">
            <tr>
              <td class="text-slate-500">{{ event.sequence }}</td>
              <td class="font-medium text-slate-900">
                {{ formatEventType(event.eventType) }}
              </td>
              <td class="text-slate-600">{{ event.actorEmail ?? '—' }}</td>
              <td class="text-slate-600">
                {{ event.resourceType ?? '—' }}<template v-if="event.resourceId"
                  >&nbsp;({{ event.resourceId.slice(0, 8) }}…)</template
                >
              </td>
              <td>
                <span
                  class="inline-block h-2 w-2 rounded-full"
                  :class="event.blockchainTxRef ? 'bg-emerald-500' : 'bg-slate-300'"
                  :title="event.blockchainTxRef ?? 'Not yet anchored'"
                  aria-hidden="true"
                />
              </td>
              <td class="text-slate-500">{{ new Date(event.createdAt).toLocaleString() }}</td>
              <td>
                <button type="button" class="btn btn-ghost btn-sm" @click="toggleVerify(event.id)">
                  {{ expandedEventId === event.id ? 'Hide' : 'Verify' }}
                </button>
              </td>
            </tr>
            <tr v-if="expandedEventId === event.id">
              <td colspan="7" class="bg-slate-50/60 text-xs">
                <div v-if="audit.verifyingEventId === event.id" class="text-slate-500">Verifying…</div>
                <div v-else-if="audit.verifyEventErrors[event.id]" class="text-red-700">
                  {{ audit.verifyEventErrors[event.id] }}
                </div>
                <div v-else-if="audit.eventVerifications[event.id]" class="flex flex-wrap items-center gap-x-4 gap-y-1">
                  <span class="font-medium" :class="audit.eventVerifications[event.id].verified ? 'text-emerald-700' : 'text-red-700'">
                    {{ audit.eventVerifications[event.id].verified ? 'Independently verified' : 'Verification failed' }}
                  </span>
                  <span :class="audit.eventVerifications[event.id].checks.payloadHashValid ? 'text-emerald-700' : 'text-red-700'">
                    {{ audit.eventVerifications[event.id].checks.payloadHashValid ? '✓' : '✗' }} payload hash
                  </span>
                  <span :class="audit.eventVerifications[event.id].checks.chainLinkValid ? 'text-emerald-700' : 'text-red-700'">
                    {{ audit.eventVerifications[event.id].checks.chainLinkValid ? '✓' : '✗' }} chain link
                  </span>
                  <span :class="audit.eventVerifications[event.id].checks.currentHashValid ? 'text-emerald-700' : 'text-red-700'">
                    {{ audit.eventVerifications[event.id].checks.currentHashValid ? '✓' : '✗' }} current hash
                  </span>
                  <span :class="audit.eventVerifications[event.id].checks.signatureValid ? 'text-emerald-700' : 'text-red-700'">
                    {{ audit.eventVerifications[event.id].checks.signatureValid ? '✓' : '✗' }} signature
                  </span>
                  <span :class="audit.eventVerifications[event.id].blockchainAnchor.anchored ? 'text-emerald-700' : 'text-slate-400'">
                    {{ audit.eventVerifications[event.id].blockchainAnchor.anchored ? '✓' : '—' }} blockchain anchor
                  </span>
                </div>
              </td>
            </tr>
          </template>
        </tbody>
      </table>
      <div v-if="audit.events.length > 0" class="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
        <span>Showing {{ audit.events.length }} of {{ audit.total }}</span>
        <button
          v-if="audit.events.length < audit.total"
          type="button"
          class="btn btn-ghost btn-sm"
          :disabled="audit.loading"
          @click="audit.fetchEvents({ more: true })"
        >
          {{ audit.loading ? 'Loading…' : 'Load more' }}
        </button>
      </div>
    </div>
  </section>
</template>
