<script setup lang="ts">
import { onMounted } from 'vue'
import { useHealthStore } from '../stores/health'
import { useAuthStore } from '../stores/auth'

const health = useHealthStore()
const auth = useAuthStore()

onMounted(() => {
  void health.checkHealth()
})
</script>

<template>
  <section class="mx-auto max-w-3xl px-4 py-10">
    <h1 class="text-2xl font-semibold text-slate-900">
      Welcome{{ auth.user ? `, ${auth.user.email}` : '' }}
    </h1>
    <p class="mt-1 text-sm text-slate-600">
      Roles: {{ auth.user?.roles.join(', ') || '—' }} · Permissions:
      {{ auth.user?.permissions.join(', ') || 'none granted yet' }}
    </p>

    <h2 class="mt-8 text-lg font-semibold text-slate-900">System Status</h2>
    <p class="mt-1 text-sm text-slate-600">
      Live connectivity check between this frontend shell and the B-PFMPS API.
    </p>

    <div class="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <div v-if="health.loading" class="text-sm text-slate-500">Checking system status…</div>

      <div v-else-if="health.error" class="flex items-start gap-3">
        <span class="mt-1 h-2.5 w-2.5 flex-none rounded-full bg-red-500" aria-hidden="true" />
        <div>
          <p class="font-medium text-red-700">API unreachable</p>
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

      <button
        type="button"
        class="mt-4 rounded-md border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
        :disabled="health.loading"
        @click="health.checkHealth()"
      >
        Recheck
      </button>
    </div>
  </section>
</template>
