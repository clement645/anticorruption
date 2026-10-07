<script setup lang="ts">
import { reactive, ref } from 'vue'
import { useWhistleblowerStore } from '../stores/whistleblower'

const store = useWhistleblowerStore()

type Tab = 'submit' | 'status'
const activeTab = ref<Tab>('submit')

const categories = [
  'CORRUPTION',
  'FRAUD',
  'PROCUREMENT_IRREGULARITY',
  'CONFLICT_OF_INTEREST',
  'ABUSE_OF_OFFICE',
  'OTHER',
]

const submitForm = reactive({ category: 'CORRUPTION', description: '', contact: '' })
const evidenceFile = ref<File | null>(null)
const uploading = ref(false)
const copiedTrackingCode = ref(false)

const trackingCodeInput = ref('')
const replyMessage = ref('')

async function handleSubmit() {
  if (!submitForm.description.trim()) return
  const code = await store.submitReport(submitForm.category, submitForm.description, submitForm.contact)
  if (code && evidenceFile.value) {
    uploading.value = true
    try {
      await store.addEvidence(code, evidenceFile.value)
    } finally {
      uploading.value = false
    }
  }
  submitForm.description = ''
  submitForm.contact = ''
  evidenceFile.value = null
}

function onFileChange(event: Event) {
  const target = event.target as HTMLInputElement
  evidenceFile.value = target.files?.[0] ?? null
}

async function handleCheckStatus() {
  if (!trackingCodeInput.value.trim()) return
  await store.checkStatus(trackingCodeInput.value.trim())
}

async function handleReply() {
  if (!replyMessage.value.trim()) return
  await store.replyAsReporter(trackingCodeInput.value.trim(), replyMessage.value.trim())
  replyMessage.value = ''
}

async function copyTrackingCode() {
  if (!store.submittedTrackingCode) return
  try {
    await navigator.clipboard.writeText(store.submittedTrackingCode)
    copiedTrackingCode.value = true
    setTimeout(() => (copiedTrackingCode.value = false), 2000)
  } catch {
    // Clipboard access can be denied by the browser — the code is already
    // shown on screen for manual copying either way.
  }
}

function formatCategory(category: string): string {
  return category.replaceAll('_', ' ')
}
</script>

<template>
  <section class="mx-auto max-w-2xl px-4 py-10">
    <div class="page-header">
      <h1 class="page-title">Report a Concern</h1>
      <p class="page-subtitle">
        Anonymous by default. No account, no sign-in, and no personal information is required to
        submit or follow up on a report. You'll receive a tracking code — save it, it's the only
        way to check on your report or add more information later.
      </p>
    </div>

    <nav class="mt-6 flex gap-1 border-b border-slate-200 text-sm" aria-label="Report a concern sections">
      <button
        type="button"
        class="tab-pill"
        :class="activeTab === 'submit' ? 'tab-pill-active' : 'tab-pill-inactive'"
        @click="activeTab = 'submit'"
      >
        Submit a report
      </button>
      <button
        type="button"
        class="tab-pill"
        :class="activeTab === 'status' ? 'tab-pill-active' : 'tab-pill-inactive'"
        @click="activeTab = 'status'"
      >
        Check status / add information
      </button>
    </nav>

    <p v-if="store.error" class="mt-4 alert-error">
      {{ store.error }}
    </p>

    <!-- Submit -->
    <div v-if="activeTab === 'submit'" class="mt-6">
      <div v-if="store.submittedTrackingCode" class="rounded-xl border border-emerald-200 bg-emerald-50 p-6">
        <h2 class="text-sm font-medium text-emerald-900">Report submitted</h2>
        <p class="mt-1 text-sm text-emerald-800">
          Your tracking code — save this now, it will not be shown again and cannot be recovered:
        </p>
        <div class="mt-2 flex items-center gap-2">
          <code class="flex-1 rounded-md border border-emerald-300 bg-white px-3 py-2 font-mono text-sm">{{
            store.submittedTrackingCode
          }}</code>
          <button type="button" class="btn btn-secondary btn-sm text-emerald-700" @click="copyTrackingCode">
            {{ copiedTrackingCode ? 'Copied' : 'Copy' }}
          </button>
        </div>
        <button
          type="button"
          class="btn btn-ghost btn-sm mt-3 text-emerald-700"
          @click="store.submittedTrackingCode = null"
        >
          Submit another report
        </button>
      </div>

      <form v-else class="space-y-3" @submit.prevent="handleSubmit">
        <div>
          <label class="field-label">Category</label>
          <select v-model="submitForm.category" aria-label="Category" class="select mt-1">
            <option v-for="c in categories" :key="c" :value="c">{{ formatCategory(c) }}</option>
          </select>
        </div>
        <div>
          <label class="field-label">What happened?</label>
          <textarea
            v-model="submitForm.description"
            required
            minlength="10"
            rows="6"
            placeholder="Describe what you observed, when, and who was involved if known."
            class="input mt-1"
          />
        </div>
        <div>
          <label class="field-label">Supporting evidence (optional)</label>
          <input type="file" aria-label="Supporting evidence (optional)" class="mt-1 text-sm" @change="onFileChange" />
        </div>
        <div>
          <label class="field-label">Contact (optional — only if you want to be reachable)</label>
          <input
            v-model="submitForm.contact"
            placeholder="Email or phone — left blank by default"
            class="input mt-1"
          />
          <p class="mt-1 text-[11px] text-slate-500">
            Encrypted at rest and visible only to the investigator assigned to your report. You
            can safely leave this blank — the tracking code alone is enough to follow up.
          </p>
        </div>
        <button type="submit" :disabled="store.loading || uploading" class="btn btn-primary">
          {{ store.loading || uploading ? 'Submitting…' : 'Submit report' }}
        </button>
      </form>
    </div>

    <!-- Status / follow-up -->
    <div v-if="activeTab === 'status'" class="mt-6">
      <form class="flex gap-2" @submit.prevent="handleCheckStatus">
        <input
          v-model="trackingCodeInput"
          placeholder="WB-…"
          class="input flex-1 font-mono"
        />
        <button type="submit" :disabled="store.loading" class="btn btn-primary btn-sm">Check</button>
      </form>

      <div v-if="store.reportStatus" class="mt-4 card p-4 text-sm">
        <div class="flex items-center justify-between">
          <span class="font-medium text-slate-900">{{ formatCategory(store.reportStatus.category) }}</span>
          <span class="badge badge-neutral">{{ store.reportStatus.status }}</span>
        </div>
        <p class="mt-2 text-slate-600">{{ store.reportStatus.description }}</p>

        <h3 class="mt-3 text-xs font-medium uppercase text-slate-500">Evidence</h3>
        <ul class="mt-1 space-y-1">
          <li v-for="e in store.reportStatus.evidence" :key="e.id" class="text-xs text-slate-600">
            {{ e.fileName }} <span v-if="e.anchored" class="text-emerald-700">(anchored)</span>
          </li>
          <li v-if="store.reportStatus.evidence.length === 0" class="text-xs text-slate-500">None yet.</li>
        </ul>

        <h3 class="mt-3 text-xs font-medium uppercase text-slate-500">Conversation</h3>
        <ul class="mt-1 space-y-2">
          <li v-for="u in store.reportStatus.updates" :key="u.id" class="text-xs">
            <span class="font-medium" :class="u.author === 'INVESTIGATOR' ? 'text-slate-900' : 'text-slate-600'">
              {{ u.author === 'INVESTIGATOR' ? 'Investigator' : 'You' }}:
            </span>
            {{ u.message }}
          </li>
          <li v-if="store.reportStatus.updates.length === 0" class="text-xs text-slate-500">No messages yet.</li>
        </ul>

        <form class="mt-3 flex gap-2" @submit.prevent="handleReply">
          <input v-model="replyMessage" placeholder="Add a reply…" class="input flex-1 px-2 py-1 text-xs" />
          <button type="submit" class="btn btn-secondary btn-sm">Send</button>
        </form>

        <div class="mt-3">
          <label class="field-label">Add more evidence</label>
          <input
            type="file"
            aria-label="Add more evidence"
            class="mt-1 text-xs"
            @change="
              async (e) => {
                const file = (e.target as HTMLInputElement).files?.[0]
                if (file) {
                  await store.addEvidence(trackingCodeInput.trim(), file)
                  await store.checkStatus(trackingCodeInput.trim())
                }
              }
            "
          />
        </div>
      </div>
    </div>
  </section>
</template>
