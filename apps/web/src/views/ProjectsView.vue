<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useAuthStore } from '../stores/auth'
import { useProjectsStore } from '../stores/projects'

const auth = useAuthStore()
const store = useProjectsStore()

const canManageProjects = auth.hasPermission('project:manage')
const canInspect = auth.hasPermission('project:inspect')
const canUploadEvidence = auth.hasPermission('evidence:upload')

const projectForm = reactive({
  contractId: '',
  name: '',
  description: '',
  location: '',
  startDate: '',
  plannedEndDate: '',
})

const milestoneForm = reactive({ sequenceNumber: 1, title: '', description: '', plannedAmount: 0, plannedDate: '' })
const findingsByMilestone = reactive<Record<string, string>>({})
const evidenceFile = ref<File | null>(null)
const evidenceInspectionId = ref('')
const uploading = ref(false)
const downloadStatusByEvidence = reactive<Record<string, string>>({})

const selectedProjectId = ref<string | null>(null)
const selectedProject = computed(() => store.projects.find((p) => p.id === selectedProjectId.value) ?? null)
const milestonesForSelected = computed(() =>
  store.milestones.filter((m) => m.projectId === selectedProjectId.value).sort((a, b) => a.sequenceNumber - b.sequenceNumber),
)

onMounted(async () => {
  await store.fetchProjects()
})

async function selectProject(id: string) {
  selectedProjectId.value = id
  await Promise.all([store.fetchMilestones(id), store.fetchEvidence(id)])
  for (const m of store.milestones.filter((ms) => ms.projectId === id && ms.status !== 'PENDING' && ms.status !== 'IN_PROGRESS')) {
    await store.fetchInspections(m.id)
  }
}

async function handleCreateProject() {
  await store.createProject(
    projectForm.contractId,
    projectForm.name,
    projectForm.description,
    projectForm.startDate,
    projectForm.plannedEndDate,
    projectForm.location || undefined,
  )
  projectForm.contractId = ''
  projectForm.name = ''
  projectForm.description = ''
  projectForm.location = ''
}

async function handleCreateMilestone() {
  if (!selectedProjectId.value) return
  await store.createMilestone(
    selectedProjectId.value,
    milestoneForm.sequenceNumber,
    milestoneForm.title,
    milestoneForm.description,
    milestoneForm.plannedAmount,
    milestoneForm.plannedDate,
  )
  milestoneForm.title = ''
  milestoneForm.description = ''
  milestoneForm.plannedAmount = 0
  milestoneForm.sequenceNumber += 1
}

async function handleRecordInspection(milestoneId: string, outcome: 'PASSED' | 'FAILED' | 'NEEDS_REVISION') {
  if (!selectedProjectId.value) return
  await store.recordInspection(milestoneId, selectedProjectId.value, outcome, findingsByMilestone[milestoneId] || outcome)
  delete findingsByMilestone[milestoneId]
}

function onFileChange(event: Event) {
  const target = event.target as HTMLInputElement
  evidenceFile.value = target.files?.[0] ?? null
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

async function handleUploadEvidence() {
  if (!evidenceFile.value || !selectedProjectId.value) return
  uploading.value = true
  try {
    const base64 = await fileToBase64(evidenceFile.value)
    await store.uploadEvidence(
      selectedProjectId.value,
      evidenceFile.value.name,
      evidenceFile.value.type || 'application/octet-stream',
      base64,
      evidenceInspectionId.value || undefined,
    )
    evidenceFile.value = null
    evidenceInspectionId.value = ''
  } finally {
    uploading.value = false
  }
}

/** Round-trips through the download endpoint purely to surface hashVerified — no client-side save. */
async function handleVerifyEvidence(evidenceId: string) {
  downloadStatusByEvidence[evidenceId] = 'Checking…'
  try {
    const result = await store.downloadEvidence(evidenceId)
    downloadStatusByEvidence[evidenceId] = result.hashVerified ? 'Hash verified ✓' : 'HASH MISMATCH — possible tampering'
  } catch {
    downloadStatusByEvidence[evidenceId] = 'Integrity check failed — file could not be decrypted'
  }
}

function activeContractsHint() {
  return 'Enter the ID of an ACTIVE contract with no project yet'
}
</script>

<template>
  <section class="mx-auto max-w-5xl px-4 py-10">
    <div class="page-header">
      <h1 class="page-title">Project Verification</h1>
      <p class="page-subtitle">
        Contract → Project → Milestones → independent Engineer inspection → evidence vault.
      </p>
    </div>

    <p v-if="store.error" class="mt-4 alert-error">
      {{ store.error }}
    </p>

    <!-- Projects -->
    <div class="mt-6 card p-6">
      <h2 class="section-title">Projects</h2>
      <table class="mt-2 w-full text-xs">
        <thead>
          <tr class="text-left text-slate-500">
            <th class="pr-2">Name</th>
            <th class="pr-2">Location</th>
            <th class="pr-2">Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in store.projects" :key="p.id" class="border-t border-slate-100">
            <td class="py-1 pr-2">{{ p.name }}</td>
            <td class="py-1 pr-2">{{ p.location ?? '—' }}</td>
            <td class="py-1 pr-2">
              <span
                class="badge"
                :class="{
                  'badge-neutral': p.status === 'PLANNED',
                  'badge-success': p.status === 'IN_PROGRESS' || p.status === 'COMPLETED',
                  'badge-warning': p.status === 'SUSPENDED',
                  'badge-danger': p.status === 'CANCELLED',
                }"
              >
                {{ p.status }}
              </span>
            </td>
            <td class="py-1">
              <button class="btn btn-ghost btn-sm" @click="selectProject(p.id)">Manage</button>
              <template v-if="canManageProjects">
                <button v-if="p.status === 'PLANNED'" class="btn btn-ghost btn-sm text-emerald-700" @click="store.activateProject(p.id)">
                  Activate
                </button>
                <button v-if="p.status === 'IN_PROGRESS'" class="btn btn-ghost btn-sm text-amber-700" @click="store.suspendProject(p.id)">
                  Suspend
                </button>
                <button v-if="p.status === 'SUSPENDED'" class="btn btn-ghost btn-sm text-emerald-700" @click="store.resumeProject(p.id)">
                  Resume
                </button>
                <button
                  v-if="p.status !== 'COMPLETED' && p.status !== 'CANCELLED'"
                  class="btn btn-ghost btn-sm text-red-700"
                  @click="store.cancelProject(p.id)"
                >
                  Cancel
                </button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
      <form v-if="canManageProjects" class="mt-3 flex flex-wrap items-end gap-2" @submit.prevent="handleCreateProject">
        <input v-model="projectForm.contractId" required placeholder="Contract ID" class="input w-64" />
        <input v-model="projectForm.name" required placeholder="Name" class="input" />
        <input v-model="projectForm.description" required placeholder="Description" class="input" />
        <input v-model="projectForm.location" placeholder="Location (optional)" class="input" />
        <input v-model="projectForm.startDate" type="date" required class="input" />
        <input v-model="projectForm.plannedEndDate" type="date" required class="input" />
        <button type="submit" class="btn btn-primary btn-sm">Create project</button>
      </form>
      <p class="mt-1 text-[11px] text-slate-400">
        {{ activeContractsHint() }} — the organization is derived server-side from the contract, not entered here.
      </p>
    </div>

    <!-- Selected project detail -->
    <div v-if="selectedProject" class="mt-6 card p-6">
      <h2 class="section-title">{{ selectedProject.name }} — Milestones</h2>
      <p class="mt-1 text-[11px] text-slate-400">
        Milestones can only be added while the project is PLANNED — the list is frozen once activated.
      </p>

      <div v-for="m in milestonesForSelected" :key="m.id" class="mt-3 rounded-lg border border-slate-100 p-3 text-xs">
        <div class="flex items-center justify-between">
          <span class="font-medium">#{{ m.sequenceNumber }} {{ m.title }}</span>
          <span
            class="badge"
            :class="{
              'badge-neutral': m.status === 'PENDING',
              'badge-warning': m.status === 'IN_PROGRESS',
              'badge-success': m.status === 'COMPLETED',
            }"
          >
            {{ m.status }}
          </span>
          <span class="text-slate-400">{{ m.plannedAmount }} due {{ new Date(m.plannedDate).toLocaleDateString() }}</span>
        </div>
        <p class="mt-1 text-slate-500">{{ m.description }}</p>

        <div v-if="canManageProjects" class="mt-2 flex items-center gap-2">
          <button v-if="m.status === 'PENDING'" class="btn btn-ghost btn-sm text-emerald-700" @click="store.startMilestone(m.id, selectedProject!.id)">
            Start
          </button>
          <button
            v-if="m.status === 'IN_PROGRESS' || m.status === 'PENDING'"
            class="btn btn-ghost btn-sm text-emerald-700"
            @click="store.completeMilestone(m.id, selectedProject!.id)"
          >
            Mark completed
          </button>
        </div>

        <div v-if="canInspect && m.status === 'COMPLETED'" class="mt-2 flex items-center gap-1">
          <input v-model="findingsByMilestone[m.id]" placeholder="Findings" class="input w-40 px-1.5 py-1 text-xs" />
          <button class="btn btn-secondary btn-sm text-emerald-700" @click="handleRecordInspection(m.id, 'PASSED')">
            Passed
          </button>
          <button class="btn btn-secondary btn-sm text-amber-700" @click="handleRecordInspection(m.id, 'NEEDS_REVISION')">
            Needs revision
          </button>
          <button class="btn btn-secondary btn-sm text-red-700" @click="handleRecordInspection(m.id, 'FAILED')">
            Failed
          </button>
        </div>

        <ul v-if="store.inspectionsByMilestone[m.id]?.length" class="mt-2 text-slate-500">
          <li v-for="insp in store.inspectionsByMilestone[m.id]" :key="insp.id">
            {{ insp.outcome }} — {{ insp.findings }} ({{ new Date(insp.inspectedAt).toLocaleString() }})
          </li>
        </ul>
      </div>

      <form v-if="canManageProjects && selectedProject.status === 'PLANNED'" class="mt-3 flex flex-wrap items-end gap-2" @submit.prevent="handleCreateMilestone">
        <input v-model.number="milestoneForm.sequenceNumber" type="number" min="1" required placeholder="Seq #" class="input w-16" />
        <input v-model="milestoneForm.title" required placeholder="Title" class="input" />
        <input v-model="milestoneForm.description" required placeholder="Description" class="input" />
        <input v-model.number="milestoneForm.plannedAmount" type="number" min="1" required placeholder="Amount" class="input w-28" />
        <input v-model="milestoneForm.plannedDate" type="date" required class="input" />
        <button type="submit" class="btn btn-primary btn-sm">Add milestone</button>
      </form>

      <!-- Evidence vault -->
      <h2 class="section-title mt-6">Evidence Vault</h2>
      <table class="mt-2 w-full text-xs">
        <thead>
          <tr class="text-left text-slate-500">
            <th class="pr-2">File</th>
            <th class="pr-2">SHA-256</th>
            <th class="pr-2">Anchored</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="e in store.evidence" :key="e.id" class="border-t border-slate-100">
            <td class="py-1 pr-2">{{ e.fileName }}</td>
            <td class="py-1 pr-2 font-mono">{{ e.fileHash.slice(0, 12) }}…</td>
            <td class="py-1 pr-2">
              <span class="badge" :class="e.blockchainTxRef ? 'badge-success' : 'badge-neutral'">
                {{ e.blockchainTxRef ? 'yes' : 'pending' }}
              </span>
            </td>
            <td class="py-1">
              <button class="btn btn-ghost btn-sm" @click="handleVerifyEvidence(e.id)">Verify integrity</button>
              <span v-if="downloadStatusByEvidence[e.id]" class="ml-2 text-slate-500">{{ downloadStatusByEvidence[e.id] }}</span>
            </td>
          </tr>
        </tbody>
      </table>
      <form v-if="canUploadEvidence" class="mt-3 flex flex-wrap items-end gap-2" @submit.prevent="handleUploadEvidence">
        <input type="file" required class="text-sm" @change="onFileChange" />
        <input v-model="evidenceInspectionId" placeholder="Inspection ID (optional)" class="input w-56" />
        <button type="submit" :disabled="uploading" class="btn btn-primary btn-sm">
          {{ uploading ? 'Uploading…' : 'Upload evidence' }}
        </button>
      </form>
      <p class="mt-1 text-[11px] text-slate-400">
        Encrypted at rest (AES-256-GCM), hashed with SHA-256, anchored on the blockchain, and re-verified on every download.
      </p>
    </div>
  </section>
</template>
