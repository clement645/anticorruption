<script setup lang="ts">
import { useRouter } from 'vue-router'
import { useAuthStore } from './stores/auth'

const appName = import.meta.env.VITE_APP_NAME ?? 'B-PFMPS'
const auth = useAuthStore()
const router = useRouter()

async function handleLogout() {
  await auth.logout()
  await router.push('/login')
}
</script>

<template>
  <div class="min-h-screen bg-slate-50">
    <header class="border-b border-slate-200 bg-white">
      <div class="mx-auto flex max-w-5xl items-center justify-between px-4 py-4">
        <div class="flex items-center gap-6">
          <span class="text-base font-semibold tracking-tight text-slate-900">{{ appName }}</span>
          <router-link
            to="/transparency"
            class="text-sm text-slate-600 hover:text-slate-900"
          >
            Transparency Portal
          </router-link>
          <router-link
            to="/report-a-concern"
            class="text-sm text-slate-600 hover:text-slate-900"
          >
            Report a Concern
          </router-link>
          <nav v-if="auth.isAuthenticated" class="flex items-center gap-4 text-sm">
            <router-link to="/" class="text-slate-600 hover:text-slate-900">Dashboard</router-link>
            <router-link
              v-if="auth.hasPermission('budget:read')"
              to="/budgets"
              class="text-slate-600 hover:text-slate-900"
            >
              Budgets
            </router-link>
            <router-link
              v-if="auth.hasPermission('procurement:read')"
              to="/procurement"
              class="text-slate-600 hover:text-slate-900"
            >
              Procurement
            </router-link>
            <router-link
              v-if="auth.hasPermission('contract:read')"
              to="/contracts"
              class="text-slate-600 hover:text-slate-900"
            >
              Contracts
            </router-link>
            <router-link
              v-if="auth.hasPermission('project:read')"
              to="/projects"
              class="text-slate-600 hover:text-slate-900"
            >
              Projects
            </router-link>
            <router-link
              v-if="auth.hasPermission('risk:read')"
              to="/risk-alerts"
              class="text-slate-600 hover:text-slate-900"
            >
              Risk Alerts
            </router-link>
            <router-link
              v-if="auth.hasPermission('audit:read')"
              to="/audit"
              class="text-slate-600 hover:text-slate-900"
            >
              Audit Trail
            </router-link>
            <router-link
              v-if="auth.hasPermission('audit:read')"
              to="/auditor-portal"
              class="text-slate-600 hover:text-slate-900"
            >
              Auditor Portal
            </router-link>
            <router-link
              v-if="auth.hasPermission('whistleblower:read')"
              to="/whistleblower-investigations"
              class="text-slate-600 hover:text-slate-900"
            >
              Whistleblower Investigations
            </router-link>
          </nav>
        </div>
        <div class="flex items-center gap-4">
          <span v-if="auth.isAuthenticated" class="text-xs text-slate-500">
            {{ auth.user?.email }} · {{ auth.user?.roles.join(', ') }}
          </span>
          <button
            v-if="auth.isAuthenticated"
            type="button"
            class="text-xs font-medium text-slate-600 hover:text-slate-900"
            @click="handleLogout"
          >
            Sign out
          </button>
        </div>
      </div>
    </header>
    <main>
      <router-view />
    </main>
  </div>
</template>
