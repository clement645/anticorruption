<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useRoute } from 'vue-router'
import { useAuthStore } from '../stores/auth'
import { useSupplierStore } from '../stores/supplier'

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
</script>

<template>
  <section class="mx-auto max-w-4xl px-4 py-10">
    <router-link to="/procurement" class="text-xs text-slate-500 hover:text-slate-900">&larr; Back to Procurement</router-link>

    <div v-if="supplier.error" class="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
      {{ supplier.error }}
    </div>

    <div v-if="supplier.profile" class="mt-2">
      <div class="flex items-center gap-3">
        <h1 class="text-2xl font-semibold text-slate-900">{{ supplier.profile.name }}</h1>
        <span
          class="rounded-full px-2 py-0.5 text-xs font-medium"
          :class="{
            'bg-emerald-100 text-emerald-800': supplier.profile.status === 'ACTIVE',
            'bg-amber-100 text-amber-800': supplier.profile.status === 'SUSPENDED',
            'bg-red-100 text-red-800': supplier.profile.status === 'BLACKLISTED',
          }"
        >
          {{ supplier.profile.status }}
        </span>
      </div>
      <p class="mt-1 text-sm text-slate-600">Registration No. {{ supplier.profile.registrationNumber }}</p>

      <!-- Profile -->
      <div class="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 class="text-sm font-medium text-slate-900">Profile</h2>
        <dl class="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-slate-600">
          <dt class="text-slate-400">Business type</dt>
          <dd>{{ supplier.profile.businessType ?? '—' }}</dd>
          <dt class="text-slate-400">Tax identifier</dt>
          <dd>{{ supplier.profile.taxIdentifier ?? '—' }}</dd>
          <dt class="text-slate-400">County</dt>
          <dd>{{ supplier.profile.county ?? '—' }}</dd>
          <dt class="text-slate-400">Physical address</dt>
          <dd>{{ supplier.profile.physicalAddress ?? '—' }}</dd>
          <dt class="text-slate-400">Contact person</dt>
          <dd>{{ supplier.profile.contactPersonName ?? '—' }}</dd>
          <dt class="text-slate-400">Email</dt>
          <dd>{{ supplier.profile.email ?? '—' }}</dd>
        </dl>

        <template v-if="canManage">
          <form class="mt-4 grid grid-cols-2 gap-2 border-t border-slate-100 pt-3" @submit.prevent="handleUpdateProfile">
            <select v-model="profileForm.businessType" class="rounded-md border border-slate-300 px-2 py-1 text-sm">
              <option value="">Business type…</option>
              <option value="SOLE_PROPRIETORSHIP">Sole proprietorship</option>
              <option value="PARTNERSHIP">Partnership</option>
              <option value="LIMITED_COMPANY">Limited company</option>
              <option value="COOPERATIVE">Cooperative</option>
              <option value="NGO">NGO</option>
              <option value="OTHER">Other</option>
            </select>
            <input v-model="profileForm.taxIdentifier" placeholder="Tax identifier (KRA PIN)" class="rounded-md border border-slate-300 px-2 py-1 text-sm" />
            <input v-model="profileForm.county" placeholder="County" class="rounded-md border border-slate-300 px-2 py-1 text-sm" />
            <input v-model="profileForm.physicalAddress" placeholder="Physical address" class="rounded-md border border-slate-300 px-2 py-1 text-sm" />
            <input v-model="profileForm.contactPersonName" placeholder="Contact person" class="rounded-md border border-slate-300 px-2 py-1 text-sm" />
            <input v-model="profileForm.email" placeholder="Email" class="rounded-md border border-slate-300 px-2 py-1 text-sm" />
            <button type="submit" class="col-span-2 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800">
              Save profile
            </button>
          </form>

          <div class="mt-3 flex gap-2 border-t border-slate-100 pt-3">
            <button
              v-if="supplier.profile.status === 'ACTIVE'"
              class="rounded-md border border-amber-300 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-50"
              @click="supplier.suspend(supplierId)"
            >
              Suspend
            </button>
            <button
              v-if="supplier.profile.status === 'SUSPENDED'"
              class="rounded-md border border-emerald-300 px-3 py-1.5 text-xs font-medium text-emerald-800 hover:bg-emerald-50"
              @click="supplier.reactivate(supplierId)"
            >
              Reactivate
            </button>
            <button
              v-if="supplier.profile.status !== 'BLACKLISTED'"
              class="rounded-md border border-red-300 px-3 py-1.5 text-xs font-medium text-red-800 hover:bg-red-50"
              @click="supplier.blacklist(supplierId)"
            >
              Blacklist
            </button>
          </div>
        </template>
      </div>

      <!-- Beneficial owners -->
      <div v-if="canReadSensitive" class="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 class="text-sm font-medium text-slate-900">Beneficial Owners</h2>
        <table class="mt-2 w-full text-xs">
          <thead>
            <tr class="text-left text-slate-500">
              <th class="pr-2">Name</th>
              <th class="pr-2">ID/Passport</th>
              <th class="pr-2">Ownership</th>
              <th class="pr-2">PEP</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="owner in supplier.owners" :key="owner.id" class="border-t border-slate-100">
              <td class="py-1 pr-2">{{ owner.fullName }}</td>
              <td class="py-1 pr-2">{{ owner.nationalIdOrPassport }}</td>
              <td class="py-1 pr-2">{{ owner.ownershipPercentage }}%</td>
              <td class="py-1 pr-2">
                <span v-if="owner.isPoliticallyExposedPerson" class="rounded-full bg-amber-100 px-2 py-0.5 text-amber-800">PEP</span>
              </td>
              <td class="py-1">
                <button v-if="canManage" class="text-red-700 underline" @click="supplier.removeOwner(supplierId, owner.id)">
                  Remove
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <form v-if="canManage" class="mt-3 flex flex-wrap items-end gap-2" @submit.prevent="handleAddOwner">
          <input v-model="ownerForm.fullName" required placeholder="Full name" class="rounded-md border border-slate-300 px-2 py-1 text-sm" />
          <input v-model="ownerForm.nationalIdOrPassport" required placeholder="National ID / Passport" class="rounded-md border border-slate-300 px-2 py-1 text-sm" />
          <input v-model.number="ownerForm.ownershipPercentage" type="number" min="0" max="100" required placeholder="% owned" class="w-24 rounded-md border border-slate-300 px-2 py-1 text-sm" />
          <input v-model="ownerForm.position" placeholder="Position" class="rounded-md border border-slate-300 px-2 py-1 text-sm" />
          <label class="flex items-center gap-1 text-xs text-slate-600">
            <input v-model="ownerForm.isPoliticallyExposedPerson" type="checkbox" />
            Politically exposed person
          </label>
          <button type="submit" class="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800">
            Add owner
          </button>
        </form>
      </div>

      <!-- Compliance documents -->
      <div v-if="canReadSensitive" class="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 class="text-sm font-medium text-slate-900">Compliance Documents</h2>
        <table class="mt-2 w-full text-xs">
          <thead>
            <tr class="text-left text-slate-500">
              <th class="pr-2">Type</th>
              <th class="pr-2">File</th>
              <th class="pr-2">SHA-256</th>
              <th class="pr-2">Status</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            <tr v-for="doc in supplier.documents" :key="doc.id" class="border-t border-slate-100">
              <td class="py-1 pr-2">{{ doc.documentType }}</td>
              <td class="py-1 pr-2">{{ doc.fileName }}</td>
              <td class="py-1 pr-2 font-mono text-[10px]">{{ doc.fileHash.slice(0, 16) }}…</td>
              <td class="py-1 pr-2">{{ doc.status }}</td>
              <td class="py-1">
                <div v-if="doc.status === 'PENDING' && canVerify" class="flex items-center gap-1">
                  <button class="text-emerald-700 underline" @click="supplier.verifyDocument(supplierId, doc.id)">Verify</button>
                  <input
                    v-model="rejectReasonByDoc[doc.id]"
                    placeholder="Rejection reason"
                    class="w-28 rounded border border-slate-300 px-1 py-0.5"
                  />
                  <button class="text-red-700 underline" @click="handleRejectDocument(doc.id)">Reject</button>
                </div>
              </td>
            </tr>
          </tbody>
        </table>
        <form v-if="canManage" class="mt-3 flex flex-wrap items-center gap-2" @submit.prevent="handleUploadDocument">
          <select v-model="documentForm.documentType" class="rounded-md border border-slate-300 px-2 py-1 text-sm">
            <option value="REGISTRATION_CERTIFICATE">Registration certificate</option>
            <option value="TAX_COMPLIANCE_CERTIFICATE">Tax compliance certificate</option>
            <option value="CR12">CR12</option>
            <option value="PIN_CERTIFICATE">PIN certificate</option>
            <option value="OTHER">Other</option>
          </select>
          <input type="file" required class="text-xs" @change="onFileChange" />
          <button
            type="submit"
            :disabled="uploading || !documentForm.file"
            class="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800 disabled:opacity-50"
          >
            {{ uploading ? 'Uploading…' : 'Upload' }}
          </button>
        </form>
        <p class="mt-1 text-[11px] text-slate-400">
          Only the document's SHA-256 hash and metadata are stored — see SECURITY.md for the object-storage limitation.
        </p>
      </div>

      <!-- Risk profile -->
      <div v-if="canReadSensitive" class="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h2 class="text-sm font-medium text-slate-900">Risk Profile</h2>
        <div v-if="supplier.currentRisk" class="mt-2 flex items-center gap-3 text-xs">
          <span
            class="rounded-full px-2 py-0.5 font-medium"
            :class="{
              'bg-emerald-100 text-emerald-800': supplier.currentRisk.riskLevel === 'LOW',
              'bg-amber-100 text-amber-800': supplier.currentRisk.riskLevel === 'MEDIUM',
              'bg-orange-100 text-orange-800': supplier.currentRisk.riskLevel === 'HIGH',
              'bg-red-100 text-red-800': supplier.currentRisk.riskLevel === 'CRITICAL',
            }"
          >
            {{ supplier.currentRisk.riskLevel }}
          </span>
          <span class="text-slate-600">Score {{ supplier.currentRisk.score }}/100</span>
          <span v-if="supplier.currentRisk.notes" class="text-slate-400">{{ supplier.currentRisk.notes }}</span>
        </div>
        <p v-else class="mt-2 text-xs text-slate-400">No risk assessment recorded yet.</p>

        <details v-if="supplier.riskHistory.length" class="mt-2">
          <summary class="cursor-pointer text-xs text-slate-500">History ({{ supplier.riskHistory.length }})</summary>
          <table class="mt-1 w-full text-xs">
            <tbody>
              <tr v-for="entry in supplier.riskHistory" :key="entry.id" class="border-t border-slate-100">
                <td class="py-1 pr-2">{{ entry.riskLevel }}</td>
                <td class="py-1 pr-2">{{ entry.score }}</td>
                <td class="py-1 pr-2 text-slate-400">{{ new Date(entry.assessedAt).toLocaleString() }}</td>
              </tr>
            </tbody>
          </table>
        </details>

        <form v-if="canVerify" class="mt-3 flex flex-wrap items-end gap-2" @submit.prevent="handleRecordRisk">
          <select v-model="riskForm.riskLevel" class="rounded-md border border-slate-300 px-2 py-1 text-sm">
            <option value="LOW">Low</option>
            <option value="MEDIUM">Medium</option>
            <option value="HIGH">High</option>
            <option value="CRITICAL">Critical</option>
          </select>
          <input v-model.number="riskForm.score" type="number" min="0" max="100" required placeholder="Score" class="w-20 rounded-md border border-slate-300 px-2 py-1 text-sm" />
          <input v-model="riskForm.factorsCsv" placeholder="Factors (comma-separated)" class="rounded-md border border-slate-300 px-2 py-1 text-sm" />
          <input v-model="riskForm.notes" placeholder="Notes" class="rounded-md border border-slate-300 px-2 py-1 text-sm" />
          <button type="submit" class="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800">
            Record assessment
          </button>
        </form>
      </div>
    </div>
  </section>
</template>
