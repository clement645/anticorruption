<script setup lang="ts">
import { computed } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from './stores/auth'
import StepUpChallengeModal from './components/StepUpChallengeModal.vue'
import AppSidebar from './layouts/AppSidebar.vue'
import AppTopbar from './layouts/AppTopbar.vue'
import CommandPalette from './layouts/CommandPalette.vue'
import { useShell, useShellShortcuts } from './layouts/useShell'
import ToastRegion from './components/ui/ToastRegion.vue'

const appName = import.meta.env.VITE_APP_NAME ?? 'B-PFMPS'
const auth = useAuthStore()
const route = useRoute()
const { drawerOpen } = useShell()

useShellShortcuts(() => auth.isAuthenticated)

const showShell = computed(() => auth.isAuthenticated)
</script>

<template>
  <div v-if="showShell" class="flex min-h-screen bg-slate-50">
    <div
      v-if="drawerOpen"
      class="fixed inset-0 z-30 bg-slate-900/40 lg:hidden"
      aria-hidden="true"
      @click="drawerOpen = false"
    />

    <AppSidebar />

    <div class="flex min-h-screen min-w-0 flex-1 flex-col">
      <AppTopbar />
      <main id="main" class="flex-1" tabindex="-1">
        <router-view :key="route.fullPath" />
      </main>
    </div>

    <CommandPalette />
    <StepUpChallengeModal />
    <ToastRegion />
  </div>

  <!-- Unauthenticated / public shell -->
  <div v-else class="min-h-screen bg-slate-50">
    <div class="h-1 bg-gradient-to-r from-brand-800 via-brand-600 to-accent-500" aria-hidden="true" />
    <header class="border-b border-slate-200 bg-white">
      <div class="mx-auto flex max-w-6xl items-center justify-between px-4 py-4 sm:px-6">
        <router-link to="/" class="flex items-center gap-2.5">
          <div class="flex h-8 w-8 flex-none items-center justify-center rounded-md bg-brand-800 font-serif text-sm font-bold text-white shadow-sm">
            B
          </div>
          <span class="text-base font-semibold tracking-tight text-slate-900">{{ appName }}</span>
        </router-link>
        <nav class="flex items-center gap-5 text-sm">
          <router-link to="/transparency" class="text-slate-600 hover:text-slate-900">Transparency Portal</router-link>
          <router-link to="/report-a-concern" class="text-slate-600 hover:text-slate-900">Report a Concern</router-link>
          <router-link v-if="route.path !== '/login'" to="/login" class="btn btn-primary btn-sm">Sign in</router-link>
        </nav>
      </div>
    </header>
    <main>
      <router-view />
    </main>
  </div>
</template>
