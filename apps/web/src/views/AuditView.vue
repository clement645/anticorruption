<script setup lang="ts">
import { onMounted } from 'vue'
import { useAuditStore } from '../stores/audit'
import { useAuthStore } from '../stores/auth'
import { useBlockchainStore } from '../stores/blockchain'

const audit = useAuditStore()
const auth = useAuthStore()
const blockchain = useBlockchainStore()

onMounted(() => {
  void audit.fetchEvents()
  void audit.verifyChain()
  void blockchain.fetchHealth()
})

function formatEventType(eventType: string): string {
  return eventType.replaceAll('_', ' ')
}

async function handleAnchorNow() {
  await blockchain.triggerAnchor()
  await audit.fetchEvents()
}
</script>

<template>
  <section class="mx-auto max-w-5xl px-4 py-10">
    <div class="page-header">
      <h1 class="page-title">Audit Trail</h1>
      <p class="page-subtitle">
        Append-only, hash-chained, digitally signed record of significant actions.
      </p>
    </div>

    <div class="mt-6 grid grid-cols-1 gap-4 sm:grid-cols-2">
      <div class="card p-6">
        <div class="flex items-center justify-between">
          <h2 class="section-title">Chain Integrity</h2>
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
          <h2 class="section-title">Blockchain Integrity Layer</h2>
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
          </tr>
        </thead>
        <tbody>
          <tr v-if="audit.loading">
            <td colspan="6" class="text-center text-slate-500">Loading…</td>
          </tr>
          <tr v-else-if="audit.error">
            <td colspan="6" class="text-center text-red-700">{{ audit.error }}</td>
          </tr>
          <tr v-else-if="audit.events.length === 0">
            <td colspan="6" class="text-center text-slate-500">No audit events yet.</td>
          </tr>
          <tr v-for="event in audit.events" :key="event.id">
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
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
