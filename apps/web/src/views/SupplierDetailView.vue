<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useSupplierStore } from '../stores/supplier'
import { ApiError } from '../api/client'
import PageHeader from '../components/ui/PageHeader.vue'
import StatusBadge from '../components/ui/StatusBadge.vue'
import AlertBanner from '../components/ui/AlertBanner.vue'
import ConfirmDialog from '../components/ui/ConfirmDialog.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import { notify } from '../components/ui/toast'

const route = useRoute()
const auth = useAuthStore()
const supplier = useSupplierStore()

const supplierId = route.params.id as string

const canReadSensitive = auth.hasPermission('supplier:read_sensitive')
const canManage = auth.hasPermission('supplier:manage')
const canVerify = auth.hasPermission('supplier:verify')

const profileForm = reactive({
  businessType: '',
  taxIdentifier: '',
  physicalAddress: '',
  county: '',
  contactPersonName: '',
  email: '',
  phone: '',
})

const ownerForm = reactive({
  fullName: '',
  nationalIdOrPassport: '',
  ownershipPercentage: 0,
  isPoliticallyExposedPerson: false,
  position: '',
})

const documentForm = reactive({
  documentType: 'REGISTRATION_CERTIFICATE',
  file: null as File | null,
})
const rejectReasonByDoc = reactive<Record<string, string>>({})

const riskForm = reactive({
  riskLevel: 'LOW',
  score: 0,
  factorsCsv: '',
  notes: '',
})

const uploading = ref(false)

onMounted(async () => {
  await supplier.fetchProfile(supplierId)
  if (profileForm) {
    profileForm.businessType = supplier.profile?.businessType ?? ''
    profileForm.taxIdentifier = supplier.profile?.taxIdentifier ?? ''
    profileForm.physicalAddress = supplier.profile?.physicalAddress ?? ''
    profileForm.county = supplier.profile?.county ?? ''
    profileForm.contactPersonName = supplier.profile?.contactPersonName ?? ''
    profileForm.email = supplier.profile?.email ?? ''
    profileForm.phone = supplier.profile?.phone ?? ''
  }
  if (canReadSensitive) {
    await Promise.all([
      supplier.fetchOwners(supplierId),
      supplier.fetchDocuments(supplierId),
      supplier.fetchCurrentRisk(supplierId),
      supplier.fetchRiskHistory(supplierId),
    ])
  }
})

async function handleUpdateProfile() {
  const patch: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(profileForm)) {
    if (value !== '') patch[key] = value
  }
  await supplier.updateProfile(supplierId, patch)
}

async function handleAddOwner() {
  await supplier.addOwner(
    supplierId,
    ownerForm.fullName,
    ownerForm.nationalIdOrPassport,
    ownerForm.ownershipPercentage,
    ownerForm.isPoliticallyExposedPerson,
    ownerForm.position || undefined,
  )
  ownerForm.fullName = ''
  ownerForm.nationalIdOrPassport = ''
  ownerForm.ownershipPercentage = 0
  ownerForm.isPoliticallyExposedPerson = false
  ownerForm.position = ''
}

function onFileChange(event: Event) {
  const target = event.target as HTMLInputElement
  documentForm.file = target.files?.[0] ?? null
}

function fileToBase64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => {
      const result = reader.result as string
      resolve(result.split(',')[1] ?? '')
    }
    reader.onerror = reject
    reader.readAsDataURL(file)
  })
}

async function handleUploadDocument() {
  if (!documentForm.file) return
  uploading.value = true
  try {
    const base64 = await fileToBase64(documentForm.file)
    await supplier.uploadDocument(
      supplierId,
      documentForm.documentType,
      documentForm.file.name,
      documentForm.file.type || 'application/octet-stream',
      base64,
    )
    documentForm.file = null
  } finally {
    uploading.value = false
  }
}

async function handleRejectDocument(documentId: string) {
  const reason = rejectReasonByDoc[documentId] || 'Rejected'
  await supplier.rejectDocument(supplierId, documentId, reason)
  delete rejectReasonByDoc[documentId]
}

async function handleRecordRisk() {
  const factors = riskForm.factorsCsv
    .split(',')
    .map((f) => f.trim())
    .filter(Boolean)
  await supplier.recordRiskAssessment(
    supplierId,
    riskForm.riskLevel,
    riskForm.score,
    factors,
    riskForm.notes || undefined,
  )
  riskForm.factorsCsv = ''
  riskForm.notes = ''
}

// Suspend and blacklist both interrupt a supplier's ability to win further
// work — reactivate only reverses that, so it stays a single click.
type PendingSupplierAction = 'suspend' | 'blacklist' | null
const pendingAction = ref<PendingSupplierAction>(null)
const actionBusy = ref(false)

const confirmTitle = computed(() =>
  pendingAction.value === 'suspend' ? 'Suspend this supplier?' : 'Blacklist this supplier?',
)
const confirmMessage = computed(() => {
  if (!supplier.profile) return ''
  if (pendingAction.value === 'suspend') {
    return `${supplier.profile.name} will not be eligible for new tenders or awards until reactivated.`
  }
  if (pendingAction.value === 'blacklist') {
    return `${supplier.profile.name} will be permanently barred from future tenders and awards. This is a serious action — only reverse it by contacting an administrator.`
  }
  return ''
})

async function confirmAction() {
  if (!pendingAction.value) return
  actionBusy.value = true
  supplier.error = null
  try {
    if (pendingAction.value === 'suspend') {
      await supplier.suspend(supplierId)
      notify('Supplier suspended.')
    } else {
      await supplier.blacklist(supplierId)
      notify('Supplier blacklisted.')
    }
    pendingAction.value = null
  } catch (err) {
    supplier.error = err instanceof ApiError ? err.message : 'That action did not complete. Nothing was changed.'
  } finally {
    actionBusy.value = false
  }
}

async function handleReactivate() {
  supplier.error = null
  try {
    await supplier.reactivate(supplierId)
    notify('Supplier reactivated.')
  } catch (err) {
    supplier.error = err instanceof ApiError ? err.message : 'Unable to reactivate the supplier.'
  }
}
</script>

<template>
  <section class="mx-auto max-w-4xl px-4 py-10">
    <router-link to="/procurement" class="text-xs text-slate-500 hover:text-slate-900">&larr; Back to Procurement</router-link>

    <AlertBanner v-if="supplier.error" class="mt-4">{{ supplier.error }}</AlertBanner>

    <div v-if="supplier.profile" class="mt-2">
      <PageHeader :title="supplier.profile.name" :subtitle="`Registration No. ${supplier.profile.registrationNumber}`">
        <template #actions>
          <StatusBadge :status="supplier.profile.status" />
        </template>
      </PageHeader>

      <!-- Profile -->
      <div class="mt-6 card p-6">
        <h2 class="section-title">Profile</h2>
        <dl class="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600">
          <dt class="text-slate-500">Business type</dt>
          <dd>{{ supplier.profile.businessType ?? '—' }}</dd>
          <dt class="text-slate-500">Tax identifier</dt>
          <dd>{{ supplier.profile.taxIdentifier ?? '—' }}</dd>
          <dt class="text-slate-500">County</dt>
          <dd>{{ supplier.profile.county ?? '—' }}</dd>
          <dt class="text-slate-500">Physical address</dt>
          <dd>{{ supplier.profile.physicalAddress ?? '—' }}</dd>
          <dt class="text-slate-500">Contact person</dt>
          <dd>{{ supplier.profile.contactPersonName ?? '—' }}</dd>
          <dt class="text-slate-500">Email</dt>
          <dd>{{ supplier.profile.email ?? '—' }}</dd>
        </dl>

        <template v-if="canManage">
          <form class="mt-4 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3" @submit.prevent="handleUpdateProfile">
            <select v-model="profileForm.businessType" aria-label="Business type" class="select">
              <option value="">Business type…</option>
              <option value="SOLE_PROPRIETORSHIP">Sole proprietorship</option>
              <option value="PARTNERSHIP">Partnership</option>
              <option value="LIMITED_COMPANY">Limited company</option>
              <option value="COOPERATIVE">Cooperative</option>
              <option value="NGO">NGO</option>
              <option value="OTHER">Other</option>
            </select>
            <input v-model="profileForm.taxIdentifier" placeholder="Tax identifier (KRA PIN)" class="input" />
            <input v-model="profileForm.county" placeholder="County" class="input" />
            <input v-model="profileForm.physicalAddress" placeholder="Physical address" class="input" />
            <input v-model="profileForm.contactPersonName" placeholder="Contact person" class="input" />
            <input v-model="profileForm.email" placeholder="Email" class="input" />
            <button type="submit" class="btn btn-primary col-span-2">Save profile</button>
          </form>

          <div class="mt-3 flex gap-2 border-t border-slate-100 pt-3">
            <button
              v-if="supplier.profile.status === 'ACTIVE'"
              class="btn btn-secondary btn-sm text-amber-800"
              @click="pendingAction = 'suspend'"
            >
              Suspend
            </button>
            <button
              v-if="supplier.profile.status === 'SUSPENDED'"
              class="btn btn-secondary btn-sm text-emerald-800"
              @click="handleReactivate"
            >
              Reactivate
            </button>
            <button
              v-if="supplier.profile.status !== 'BLACKLISTED'"
              class="btn btn-danger btn-sm"
              @click="pendingAction = 'blacklist'"
            >
              Blacklist
            </button>
          </div>
        </template>
      </div>

      <!-- Beneficial owners -->
      <div v-if="canReadSensitive" class="mt-6 card p-6">
        <h2 class="section-title">Beneficial Owners</h2>
        <div class="overflow-x-auto">
        <table class="mt-2 w-full text-xs">
          <thead>
            <tr class="text-left text-slate-500">
              <th class="pr-2">Name</th>
              <th class="pr-2">ID/Passport</th>
              <th class="pr-2">Ownership</th>
              <th class="pr-2">PEP</th>
              <th><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="supplier.owners.length === 0">
              <td colspan="5" class="p-0"><EmptyState title="No beneficial owners recorded yet" /></td>
            </tr>
            <tr v-for="owner in supplier.owners" :key="owner.id" class="border-t border-slate-100">
              <td class="py-1 pr-2">{{ owner.fullName }}</td>
              <td class="py-1 pr-2">{{ owner.nationalIdOrPassport }}</td>
              <td class="py-1 pr-2">{{ owner.ownershipPercentage }}%</td>
              <td class="py-1 pr-2">
                <span
                  v-if="owner.isPoliticallyExposedPerson"
                  class="inline-flex items-center rounded-full bg-warning-soft px-2 py-0.5 text-xs font-medium text-warning ring-1 ring-inset ring-warning/25"
                >
                  PEP
                </span>
              </td>
              <td class="py-1">
                <button v-if="canManage" class="btn btn-ghost btn-sm text-red-700" @click="supplier.removeOwner(supplierId, owner.id)">
                  Remove
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        </div>
        <form v-if="canManage" class="mt-3 flex flex-wrap items-end gap-2" @submit.prevent="handleAddOwner">
          <input v-model="ownerForm.fullName" required placeholder="Full name" class="input" />
          <input v-model="ownerForm.nationalIdOrPassport" required placeholder="National ID / Passport" class="input" />
          <input v-model.number="ownerForm.ownershipPercentage" type="number" min="0" max="100" required placeholder="% owned" class="input w-24" />
          <input v-model="ownerForm.position" placeholder="Position" class="input" />
          <label class="flex items-center gap-1 text-xs text-slate-600">
            <input v-model="ownerForm.isPoliticallyExposedPerson" type="checkbox" class="rounded border-slate-300 text-brand-600 focus:ring-brand-500" />
            Politically exposed person
          </label>
          <button type="submit" class="btn btn-primary btn-sm">Add owner</button>
        </form>
      </div>

      <!-- Compliance documents -->
      <div v-if="canReadSensitive" class="mt-6 card p-6">
        <h2 class="section-title">Compliance Documents</h2>
        <div class="overflow-x-auto">
        <table class="mt-2 w-full text-xs">
          <thead>
            <tr class="text-left text-slate-500">
              <th class="pr-2">Type</th>
              <th class="pr-2">File</th>
              <th class="pr-2">SHA-256</th>
              <th class="pr-2">Status</th>
              <th><span class="sr-only">Actions</span></th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="supplier.documents.length === 0">
              <td colspan="5" class="p-0"><EmptyState title="No compliance documents uploaded yet" /></td>
            </tr>
            <tr v-for="doc in supplier.documents" :key="doc.id" class="border-t border-slate-100">
              <td class="py-1 pr-2">{{ doc.documentType }}</td>
              <td class="py-1 pr-2">{{ doc.fileName }}</td>
              <td class="py-1 pr-2 font-mono text-[10px]">{{ doc.fileHash.slice(0, 16) }}…</td>
              <td class="py-1 pr-2">
                <StatusBadge :status="doc.status" />
              </td>
              <td class="py-1">
                <div v-if="doc.status === 'PENDING' && canVerify" class="flex items-center gap-1">
                  <button class="btn btn-ghost btn-sm text-emerald-700" @click="supplier.verifyDocument(supplierId, doc.id)">Verify</button>
                  <input
                    v-model="rejectReasonByDoc[doc.id]"
                    placeholder="Rejection reason"
                    class="input w-28 px-1.5 py-1 text-xs"
                  />
                  <button class="btn btn-ghost btn-sm text-red-700" @click="handleRejectDocument(doc.id)">Reject</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        </div>
        <form v-if="canManage" class="mt-3 flex flex-wrap items-center gap-2" @submit.prevent="handleUploadDocument">
          <select v-model="documentForm.documentType" aria-label="Document type" class="select w-auto max-w-full">
            <option value="REGISTRATION_CERTIFICATE">Registration certificate</option>
            <option value="TAX_COMPLIANCE_CERTIFICATE">Tax compliance certificate</option>
            <option value="CR12">CR12</option>
            <option value="PIN_CERTIFICATE">PIN certificate</option>
            <option value="OTHER">Other</option>
          </select>
          <input type="file" required aria-label="Document file" class="text-xs" @change="onFileChange" />
          <button type="submit" :disabled="uploading || !documentForm.file" class="btn btn-primary btn-sm">
            {{ uploading ? 'Uploading…' : 'Upload' }}
          </button>
        </form>
        <p class="mt-1 text-[11px] text-slate-500">
          Only the document's SHA-256 hash and metadata are stored — see SECURITY.md for the object-storage limitation.
        </p>
      </div>

      <!-- Risk profile -->
      <div v-if="canReadSensitive" class="mt-6 card p-6">
        <h2 class="section-title">Risk Profile</h2>
        <div v-if="supplier.currentRisk" class="mt-2 flex items-center gap-3 text-xs">
          <StatusBadge :status="supplier.currentRisk.riskLevel" />
          <span class="text-slate-600">Score {{ supplier.currentRisk.score }}/100</span>
          <span v-if="supplier.currentRisk.notes" class="text-slate-500">{{ supplier.currentRisk.notes }}</span>
        </div>
        <p v-else class="mt-2 text-xs text-slate-500">No risk assessment recorded yet.</p>

        <details v-if="supplier.riskHistory.length" class="mt-2">
          <summary class="cursor-pointer text-xs text-slate-500">History ({{ supplier.riskHistory.length }})</summary>
          <div class="overflow-x-auto">
          <table class="mt-1 w-full text-xs">
            <tbody>
              <tr v-for="entry in supplier.riskHistory" :key="entry.id" class="border-t border-slate-100">
                <td class="py-1 pr-2">{{ entry.riskLevel }}</td>
                <td class="py-1 pr-2">{{ entry.score }}</td>
                <td class="py-1 pr-2 text-slate-500">{{ new Date(entry.assessedAt).toLocaleString() }}</td>
              </tr>
            </tbody>
          </table>
          </div>
        </details>

        <form v-if="canVerify" class="mt-3 flex flex-wrap items-end gap-2" @submit.prevent="handleRecordRisk">
          <select v-model="riskForm.riskLevel" aria-label="Risk level" class="select w-auto max-w-full">
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
            <option value="CRITICAL">Critical</option>
          </select>
          <input v-model.number="riskForm.score" type="number" min="0" max="100" required placeholder="Score" class="input w-20" />
          <input v-model="riskForm.factorsCsv" placeholder="Factors (comma-separated)" class="input" />
          <input v-model="riskForm.notes" placeholder="Notes" class="input" />
          <button type="submit" class="btn btn-primary btn-sm">Record assessment</button>
        </form>
      </div>
    </div>

    <ConfirmDialog
      :open="pendingAction !== null"
      :title="confirmTitle"
      :message="confirmMessage"
      :confirm-label="pendingAction === 'suspend' ? 'Suspend' : 'Blacklist'"
      tone="danger"
      :busy="actionBusy"
      @confirm="confirmAction"
      @cancel="pendingAction = null"
    />
  </section>
</template>
