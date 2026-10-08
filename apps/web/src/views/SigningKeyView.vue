<script setup lang="ts">
import { computed, onMounted, ref } from 'vue'
import { KeyRound, ShieldCheck, AlertTriangle, CheckCircle2, Loader2 } from '@lucide/vue'
import { useAuthStore } from '../stores/auth'
import { useSigningKeyStore } from '../stores/signingKey'
import { loadSigningKey } from '../lib/signing'
import PageHeader from '../components/ui/PageHeader.vue'
import AlertBanner from '../components/ui/AlertBanner.vue'
import ConfirmDialog from '../components/ui/ConfirmDialog.vue'

const auth = useAuthStore()
const signingKey = useSigningKeyStore()

const enrolling = ref(false)
const confirmRotate = ref(false)

onMounted(async () => {
  await signingKey.fetchStatus()
})

const hasLocalKey = computed(() =>
  auth.user ? Boolean(loadSigningKey(auth.user.sub)) : false,
)

async function handleEnroll() {
  if (!auth.user) return
  enrolling.value = true
  try {
    await signingKey.enroll(auth.user.sub)
    confirmRotate.value = false
  } finally {
    enrolling.value = false
  }
}
</script>

<template>
  <section class="mx-auto max-w-2xl px-4 py-8 sm:px-6">
    <PageHeader
      title="Signing key"
      subtitle="Your personal cryptographic key for authorizing high-stakes actions (like budget approvals) — a record only you could have produced."
    />

    <div class="mt-6 card p-6">
      <div v-if="signingKey.loading && !signingKey.status" class="text-sm text-slate-500">
        <Loader2 class="h-5 w-5 animate-spin" />
      </div>

      <template v-else>
        <div v-if="signingKey.status?.enrolled && hasLocalKey" class="flex items-start gap-3">
          <CheckCircle2 class="mt-0.5 h-5 w-5 flex-none text-emerald-600" />
          <div>
            <p class="text-sm font-medium text-slate-900">Signing key active on this device</p>
            <p class="mt-1 text-xs text-slate-500">
              Key ID: <span class="font-mono">{{ signingKey.status.keyId }}</span><br />
              Enrolled {{ signingKey.status.createdAt ? new Date(signingKey.status.createdAt).toLocaleString() : '' }}
            </p>
          </div>
        </div>

        <div
          v-else-if="signingKey.status?.enrolled && !hasLocalKey"
          class="flex items-start gap-3"
        >
          <AlertTriangle class="mt-0.5 h-5 w-5 flex-none text-amber-500" />
          <div>
            <p class="text-sm font-medium text-slate-900">
              A key is enrolled, but not on this device
            </p>
            <p class="mt-1 text-xs text-slate-500">
              You enrolled a signing key from another browser or device. Generating a new one
              here will replace it — the old one will stop working for new signatures, though
              anything already signed with it stays verifiable.
            </p>
          </div>
        </div>

        <div v-else class="flex items-start gap-3">
          <KeyRound class="mt-0.5 h-5 w-5 flex-none text-slate-500" />
          <div>
            <p class="text-sm font-medium text-slate-900">No signing key enrolled yet</p>
            <p class="mt-1 text-xs text-slate-500">
              Required before you can approve budgets or take other actions that require a
              personal digital signature.
            </p>
          </div>
        </div>

        <AlertBanner v-if="signingKey.error" class="mt-4">{{ signingKey.error }}</AlertBanner>

        <div class="mt-5">
          <button
            v-if="!signingKey.status?.enrolled"
            type="button"
            class="btn btn-primary"
            :disabled="enrolling"
            @click="handleEnroll"
          >
            <Loader2 v-if="enrolling" class="h-4 w-4 animate-spin" />
            <KeyRound v-else class="h-4 w-4" />
            Generate signing key
          </button>

          <button v-else type="button" class="btn btn-secondary" @click="confirmRotate = true">
            Generate new key
          </button>
        </div>
      </template>
    </div>

    <ConfirmDialog
      :open="confirmRotate"
      title="Replace your signing key?"
      message="The key currently enrolled will stop working for new signatures — anything already signed with it stays verifiable. This cannot be undone from this screen."
      confirm-label="Replace key"
      tone="danger"
      :busy="enrolling"
      @confirm="handleEnroll"
      @cancel="confirmRotate = false"
    />

    <div class="mt-4 flex items-start gap-2 text-xs text-slate-500">
      <ShieldCheck class="mt-0.5 h-4 w-4 flex-none" />
      <p>
        The private half of this key is generated in your browser and never sent anywhere —
        only the public half is uploaded. This is a prototype: production deployments should
        replace browser storage with a hardware token or WebAuthn-backed key. See SECURITY.md.
      </p>
    </div>
  </section>
</template>
