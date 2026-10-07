<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useAuthStore } from '../stores/auth'
import { useProjectsStore, type Milestone, type Project } from '../stores/projects'
import { ApiError } from '../api/client'
import { money } from '../lib/money'
import PageHeader from '../components/ui/PageHeader.vue'
import StatusBadge from '../components/ui/StatusBadge.vue'
import AlertBanner from '../components/ui/AlertBanner.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import SkeletonRows from '../components/ui/SkeletonRows.vue'
import ConfirmDialog from '../components/ui/ConfirmDialog.vue'
import { notify } from '../components/ui/toast'

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

function describeError(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

async function handleCreateProject() {
  store.error = null
  try {
    await store.createProject(
      projectForm.contractId,
      projectForm.name,
      projectForm.description,
      projectForm.startDate,
      projectForm.plannedEndDate,
      projectForm.location || undefined,
    )
    if (!store.error) {
      notify(`Project “${projectForm.name}” created.`)
      projectForm.contractId = ''
      projectForm.name = ''
      projectForm.description = ''
      projectForm.location = ''
      projectForm.startDate = ''
      projectForm.plannedEndDate = ''
    }
  } catch (err) {
    store.error = describeError(err, 'Unable to create project')
  }
}

async function handleActivate(p: Project) {
  store.error = null
  await store.activateProject(p.id)
  if (!store.error) notify(`“${p.name}” activated.`)
}

async function handleResume(p: Project) {
  store.error = null
  await store.resumeProject(p.id)
  if (!store.error) notify(`“${p.name}” resumed.`)
}

async function handleStartMilestone(m: Milestone) {
  if (!selectedProject.value) return
  store.error = null
  await store.startMilestone(m.id, selectedProject.value.id)
  if (!store.error) notify(`“${m.title}” started.`)
}

async function handleCreateMilestone() {
  if (!selectedProjectId.value) return
  store.error = null
  try {
    await store.createMilestone(
      selectedProjectId.value,
      milestoneForm.sequenceNumber,
      milestoneForm.title,
      milestoneForm.description,
      milestoneForm.plannedAmount,
      milestoneForm.plannedDate,
    )
    if (!store.error) {
      notify(`Milestone “${milestoneForm.title}” added.`)
      milestoneForm.title = ''
      milestoneForm.description = ''
      milestoneForm.plannedAmount = 0
      milestoneForm.sequenceNumber += 1
    }
  } catch (err) {
    store.error = describeError(err, 'Unable to add milestone')
  }
}

// Suspending/cancelling a project, marking a milestone complete, and recording
// an inspection outcome all feed either the audit trail or downstream payment
// eligibility — each gets an explicit confirmation rather than a single click.
type PendingProjectAction =
  | { kind: 'suspendProject'; project: Project }
  | { kind: 'cancelProject'; project: Project }
  | { kind: 'completeMilestone'; milestone: Milestone }
  | { kind: 'recordInspection'; milestone: Milestone; outcome: 'PASSED' | 'FAILED' | 'NEEDS_REVISION' }
  | null
const pendingAction = ref<PendingProjectAction>(null)
const actionBusy = ref(false)

function askSuspendProject(p: Project) {
  pendingAction.value = { kind: 'suspendProject', project: p }
}
function askCancelProject(p: Project) {
  pendingAction.value = { kind: 'cancelProject', project: p }
}
function askCompleteMilestone(m: Milestone) {
  pendingAction.value = { kind: 'completeMilestone', milestone: m }
}
function askRecordInspection(m: Milestone, outcome: 'PASSED' | 'FAILED' | 'NEEDS_REVISION') {
  findingsByMilestone[m.id] ||= outcome
  pendingAction.value = { kind: 'recordInspection', milestone: m, outcome }
}

const confirmTitle = computed(() => {
  switch (pendingAction.value?.kind) {
    case 'suspendProject':
      return 'Suspend this project?'
    case 'cancelProject':
      return 'Cancel this project?'
    case 'completeMilestone':
      return 'Mark this milestone completed?'
    case 'recordInspection':
      return 'Record this inspection outcome?'
    default:
      return ''
  }
})
const confirmMessage = computed(() => {
  const a = pendingAction.value
  if (!a) return ''
  if (a.kind === 'suspendProject') return `${a.project.name}. Work on its milestones pauses until it is resumed.`
  if (a.kind === 'cancelProject') return `${a.project.name}. This cannot be undone.`
  if (a.kind === 'completeMilestone') {
    return `#${a.milestone.sequenceNumber} ${a.milestone.title} — ${money(a.milestone.plannedAmount)}. This opens it to inspection.`
  }
  if (a.kind === 'recordInspection') {
    return `#${a.milestone.sequenceNumber} ${a.milestone.title} will be marked ${a.outcome.replace('_', ' ').toLowerCase()}. This is recorded against your identity and cannot be changed afterwards.`
  }
  return ''
})
const confirmTone = computed(() => {
  const a = pendingAction.value
  if (!a) return 'default'
  if (a.kind === 'cancelProject') return 'danger'
  if (a.kind === 'recordInspection' && a.outcome === 'FAILED') return 'danger'
  return 'default'
})
const confirmLabel = computed(() => {
  switch (pendingAction.value?.kind) {
    case 'suspendProject':
      return 'Suspend'
    case 'cancelProject':
      return 'Cancel project'
    case 'completeMilestone':
      return 'Mark completed'
    case 'recordInspection':
      return 'Record outcome'
    default:
      return 'Confirm'
  }
})
const pendingInspectionFindingsFor = computed<Milestone | null>(() => {
  const a = pendingAction.value
  return a && a.kind === 'recordInspection' ? a.milestone : null
})

async function confirmAction() {
  const a = pendingAction.value
  if (!a || !selectedProject.value) return
  actionBusy.value = true
  store.error = null
  try {
    if (a.kind === 'suspendProject') {
      await store.suspendProject(a.project.id)
      if (!store.error) notify(`“${a.project.name}” suspended.`)
    } else if (a.kind === 'cancelProject') {
      await store.cancelProject(a.project.id)
      if (!store.error) notify(`“${a.project.name}” cancelled.`)
    } else if (a.kind === 'completeMilestone') {
      await store.completeMilestone(a.milestone.id, selectedProject.value.id)
      if (!store.error) notify(`“${a.milestone.title}” marked completed.`)
    } else if (a.kind === 'recordInspection') {
      await store.recordInspection(
        a.milestone.id,
        selectedProject.value.id,
        a.outcome,
        findingsByMilestone[a.milestone.id] || a.outcome,
      )
      if (!store.error) {
        delete findingsByMilestone[a.milestone.id]
        notify('Inspection outcome recorded.')
      }
    }
    if (!store.error) pendingAction.value = null
  } catch (err) {
    store.error = describeError(err, 'That action did not complete. Nothing was changed.')
  } finally {
    actionBusy.value = false
  }
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
  store.error = null
  const fileName = evidenceFile.value.name
  try {
    const base64 = await fileToBase64(evidenceFile.value)
    await store.uploadEvidence(
      selectedProjectId.value,
      fileName,
      evidenceFile.value.type || 'application/octet-stream',
      base64,
      evidenceInspectionId.value || undefined,
    )
    if (!store.error) {
      notify(`“${fileName}” uploaded to the evidence vault.`)
      evidenceFile.value = null
      evidenceInspectionId.value = ''
    }
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
</script>

<template>
  <section class="mx-auto max-w-5xl px-4 py-10">
    <PageHeader
      title="Project verification"
      subtitle="Contract → Project → Milestones → independent engineer inspection → evidence vault."
    />

    <AlertBanner v-if="store.error" class="mt-4">{{ store.error }}</AlertBanner>

    <!-- Projects -->
    <div class="mt-6 table-shell">
      <h2 class="section-title px-4 pt-4">Projects</h2>
      <table class="table-base">
        <thead>
          <tr>
            <th>Name</th>
            <th>Location</th>
            <th>Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="store.projectsLoading">
            <td colspan="4" class="p-0"><SkeletonRows :rows="3" :columns="4" /></td>
          </tr>
          <tr v-else-if="store.projects.length === 0">
            <td colspan="4" class="p-0">
              <EmptyState title="No projects yet" description="Projects created from an active contract will appear in this list." />
            </td>
          </tr>
          <tr v-for="p in store.projects" :key="p.id">
            <td class="font-medium text-slate-900">{{ p.name }}</td>
            <td>{{ p.location ?? '—' }}</td>
            <td><StatusBadge :status="p.status" /></td>
            <td>
              <button class="btn btn-ghost btn-sm" @click="selectProject(p.id)">Manage</button>
              <template v-if="canManageProjects">
                <button v-if="p.status === 'PLANNED'" class="btn btn-ghost btn-sm text-emerald-700" @click="handleActivate(p)">
                  Activate
                </button>
                <button v-if="p.status === 'IN_PROGRESS'" class="btn btn-ghost btn-sm text-amber-700" @click="askSuspendProject(p)">
                  Suspend
                </button>
                <button v-if="p.status === 'SUSPENDED'" class="btn btn-ghost btn-sm text-emerald-700" @click="handleResume(p)">
                  Resume
                </button>
                <button
                  v-if="p.status !== 'COMPLETED' && p.status !== 'CANCELLED'"
                  class="btn btn-ghost btn-sm text-red-700"
                  @click="askCancelProject(p)"
                >
                  Cancel
                </button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
      <form v-if="canManageProjects" class="flex flex-wrap items-end gap-2 border-t border-slate-100 p-4" @submit.prevent="handleCreateProject">
        <input v-model="projectForm.contractId" required placeholder="Contract ID" class="input w-64" />
        <input v-model="projectForm.name" required placeholder="Name" class="input" />
        <input v-model="projectForm.description" required placeholder="Description" class="input" />
        <input v-model="projectForm.location" placeholder="Location (optional)" class="input" />
        <input v-model="projectForm.startDate" type="date" required class="input" />
        <input v-model="projectForm.plannedEndDate" type="date" required class="input" />
        <button type="submit" class="btn btn-primary btn-sm">Create project</button>
      </form>
      <p v-if="canManageProjects" class="px-4 pb-4 text-[11px] text-slate-400">
        Enter the ID of an ACTIVE contract with no project yet — the organization is derived server-side from the contract, not entered here.
      </p>
    </div>

    <!-- Selected project detail -->
    <div v-if="selectedProject" class="mt-6 card p-6">
      <div class="flex items-center justify-between">
        <h2 class="section-title">{{ selectedProject.name }} — Milestones</h2>
        <StatusBadge :status="selectedProject.status" />
      </div>
      <p class="mt-1 text-[11px] text-slate-400">
        Milestones can only be added while the project is PLANNED — the list is frozen once activated.
      </p>

      <SkeletonRows v-if="store.milestonesLoading" :rows="3" :columns="2" class="mt-3" />
      <EmptyState
        v-else-if="milestonesForSelected.length === 0"
        class="mt-3"
        title="No milestones yet"
        :description="selectedProject.status === 'PLANNED' ? 'Add the first milestone below.' : 'This project has no milestones.'"
      />

      <div v-for="m in milestonesForSelected" :key="m.id" class="mt-3 rounded-lg border border-slate-100 p-3 text-xs">
        <div class="flex items-center justify-between gap-2">
          <span class="font-medium text-slate-900">#{{ m.sequenceNumber }} {{ m.title }}</span>
          <StatusBadge :status="m.status" />
          <span class="num text-slate-400">{{ money(m.plannedAmount) }} due {{ new Date(m.plannedDate).toLocaleDateString() }}</span>
        </div>
        <p class="mt-1 text-slate-500">{{ m.description }}</p>

        <div v-if="canManageProjects" class="mt-2 flex items-center gap-2">
          <button v-if="m.status === 'PENDING'" class="btn btn-ghost btn-sm text-emerald-700" @click="handleStartMilestone(m)">
            Start
          </button>
          <button
            v-if="m.status === 'IN_PROGRESS' || m.status === 'PENDING'"
            class="btn btn-ghost btn-sm text-emerald-700"
            @click="askCompleteMilestone(m)"
          >
            Mark completed
          </button>
        </div>

        <div v-if="canInspect && m.status === 'COMPLETED'" class="mt-2 flex items-center gap-1">
          <input v-model="findingsByMilestone[m.id]" placeholder="Findings" class="input w-40 px-1.5 py-1 text-xs" />
          <button class="btn btn-secondary btn-sm text-emerald-700" @click="askRecordInspection(m, 'PASSED')">
            Passed
          </button>
          <button class="btn btn-secondary btn-sm text-amber-700" @click="askRecordInspection(m, 'NEEDS_REVISION')">
            Needs revision
          </button>
          <button class="btn btn-secondary btn-sm text-red-700" @click="askRecordInspection(m, 'FAILED')">
            Failed
          </button>
        </div>

        <ul v-if="store.inspectionsByMilestone[m.id]?.length" class="mt-2 space-y-1 text-slate-500">
          <li v-for="insp in store.inspectionsByMilestone[m.id]" :key="insp.id" class="flex items-center gap-2">
            <StatusBadge :status="insp.outcome" /> {{ insp.findings }} ({{ new Date(insp.inspectedAt).toLocaleString() }})
          </li>
        </ul>
      </div>

      <form
        v-if="canManageProjects && selectedProject.status === 'PLANNED'"
        class="mt-3 flex flex-wrap items-end gap-2"
        @submit.prevent="handleCreateMilestone"
      >
        <input v-model.number="milestoneForm.sequenceNumber" type="number" min="1" required placeholder="Seq #" class="input w-16" />
        <input v-model="milestoneForm.title" required placeholder="Title" class="input" />
        <input v-model="milestoneForm.description" required placeholder="Description" class="input" />
        <input v-model.number="milestoneForm.plannedAmount" type="number" min="1" required placeholder="Amount" class="input w-28" />
        <input v-model="milestoneForm.plannedDate" type="date" required class="input" />
        <button type="submit" class="btn btn-primary btn-sm">Add milestone</button>
      </form>

      <!-- Evidence vault -->
      <h2 class="section-title mt-6">Evidence vault</h2>
      <div class="mt-2 table-shell">
        <table class="table-base">
          <thead>
            <tr>
              <th>File</th>
              <th>SHA-256</th>
              <th>Anchored</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            <tr v-if="store.evidenceLoading">
              <td colspan="4" class="p-0"><SkeletonRows :rows="2" :columns="4" /></td>
            </tr>
            <tr v-else-if="store.evidence.length === 0">
              <td colspan="4" class="p-0">
                <EmptyState title="No evidence yet" description="Files uploaded here are encrypted at rest and anchored on the blockchain." />
              </td>
            </tr>
            <tr v-for="e in store.evidence" :key="e.id">
              <td class="font-medium text-slate-900">{{ e.fileName }}</td>
              <td class="font-mono text-slate-500">{{ e.fileHash.slice(0, 12) }}…</td>
              <td>
                <span class="badge" :class="e.blockchainTxRef ? 'badge-success' : 'badge-neutral'">
                  {{ e.blockchainTxRef ? 'yes' : 'pending' }}
                </span>
              </td>
              <td>
                <button class="btn btn-ghost btn-sm" @click="handleVerifyEvidence(e.id)">Verify integrity</button>
                <span v-if="downloadStatusByEvidence[e.id]" class="ml-2 text-slate-500">{{ downloadStatusByEvidence[e.id] }}</span>
              </td>
            </tr>
          </tbody>
        </table>
      </div>
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

    <ConfirmDialog
      :open="pendingAction !== null"
      :title="confirmTitle"
      :message="confirmMessage"
      :confirm-label="confirmLabel"
      :tone="confirmTone"
      :busy="actionBusy"
      @confirm="confirmAction"
      @cancel="pendingAction = null"
    >
      <label v-if="pendingInspectionFindingsFor" class="block">
        <span class="field-label">Findings</span>
        <textarea
          v-model="findingsByMilestone[pendingInspectionFindingsFor.id]"
          rows="2"
          class="input mt-1"
          placeholder="What did the inspection find?"
        />
      </label>
    </ConfirmDialog>
  </section>
</template>
