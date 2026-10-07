<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useAuthStore } from '../stores/auth'
import { useBudgetStore, type Budget } from '../stores/budget'
import { useSigningKeyStore } from '../stores/signingKey'
import { apiGet, ApiError } from '../api/client'
import { money } from '../lib/money'
import PageHeader from '../components/ui/PageHeader.vue'
import StatusBadge from '../components/ui/StatusBadge.vue'
import AlertBanner from '../components/ui/AlertBanner.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import ConfirmDialog from '../components/ui/ConfirmDialog.vue'
import { notify } from '../components/ui/toast'

interface Organization {
  id: string
  name: string
}

const auth = useAuthStore()
const budget = useBudgetStore()
const signingKey = useSigningKeyStore()

const organizations = ref<Organization[]>([])

const newFiscalYear = reactive({ name: '', startDate: '', endDate: '' })
const newBudget = reactive({
  fiscalYearId: '',
  organizationId: '',
  name: '',
  lines: [{ code: '', voteCode: '', voteName: '', programName: '', description: '', authorizedAmount: 0 }],
})
const commitForm = reactive<Record<string, { amount: number; description: string }>>({})
const formError = ref<string | null>(null)

onMounted(async () => {
  await Promise.all([budget.fetchFiscalYears(), budget.fetchBudgets(), budget.fetchAllocations()])
  organizations.value = await apiGet<Organization[]>('/organizations')
})

function addLine() {
  newBudget.lines.push({
    code: '',
    voteCode: '',
    voteName: '',
    programName: '',
    description: '',
    authorizedAmount: 0,
  })
}

function removeLine(index: number) {
  newBudget.lines.splice(index, 1)
}

async function handleCreateFiscalYear() {
  formError.value = null
  try {
    await budget.createFiscalYear(newFiscalYear.name, newFiscalYear.startDate, newFiscalYear.endDate)
    notify(`Fiscal year “${newFiscalYear.name}” created.`)
    newFiscalYear.name = ''
    newFiscalYear.startDate = ''
    newFiscalYear.endDate = ''
  } catch {
    formError.value = 'Unable to create fiscal year'
  }
}

async function handleCreateBudget() {
  formError.value = null
  try {
    await budget.createBudget(
      newBudget.fiscalYearId,
      newBudget.organizationId,
      newBudget.name,
      newBudget.lines,
    )
    notify(`Budget “${newBudget.name}” created.`)
    newBudget.name = ''
    newBudget.lines = [
      { code: '', voteCode: '', voteName: '', programName: '', description: '', authorizedAmount: 0 },
    ]
  } catch {
    formError.value = 'Unable to create budget — check that line codes are unique and amounts are positive'
  }
}

function commitFormFor(allocationId: string) {
  commitForm[allocationId] ??= { amount: 0, description: '' }
  return commitForm[allocationId]
}

type PendingBudgetAction = { kind: 'approve' | 'reject'; budget: Budget } | null
const pendingAction = ref<PendingBudgetAction>(null)
const rejectReason = ref('')
const actionBusy = ref(false)

function askApprove(b: Budget) {
  pendingAction.value = { kind: 'approve', budget: b }
}
function askReject(b: Budget) {
  rejectReason.value = ''
  pendingAction.value = { kind: 'reject', budget: b }
}

async function confirmAction() {
  if (!pendingAction.value || !auth.user) return
  const { kind, budget: b } = pendingAction.value
  actionBusy.value = true
  formError.value = null
  try {
    if (kind === 'approve') {
      const signedFields = signingKey.signRequest(auth.user.sub, 'POST', `/api/v1/budgets/${b.id}/approve`)
      await budget.approveBudget(b.id, signedFields)
      notify(`“${b.name}” approved.`)
    } else {
      await budget.rejectBudget(b.id, rejectReason.value.trim() || undefined)
      notify(`“${b.name}” rejected.`)
    }
    pendingAction.value = null
  } catch (err) {
    formError.value =
      err instanceof Error && err.message.includes('No signing key')
        ? 'Approving a budget requires a signing key — set one up under your account menu → Signing key.'
        : err instanceof ApiError
          ? err.message
          : `Unable to ${kind} the budget. Nothing was changed.`
  } finally {
    actionBusy.value = false
  }
}

async function handleCommit(allocationId: string) {
  const form = commitFormFor(allocationId)
  try {
    await budget.createCommitment(allocationId, form.amount, form.description)
    notify('Commitment recorded.')
    form.amount = 0
    form.description = ''
  } catch {
    formError.value = 'Unable to create commitment — check the available balance'
  }
}
</script>

<template>
  <section class="mx-auto max-w-5xl px-4 py-10">
    <PageHeader title="Budget management" subtitle="Fiscal years, budgets, allocations, and commitment-control spending." />

    <AlertBanner v-if="formError" class="mt-4">{{ formError }}</AlertBanner>

    <!-- Fiscal Years -->
    <div class="mt-6 card p-6">
      <h2 class="section-title">Fiscal Years</h2>
      <div class="mt-3 flex flex-wrap gap-2">
        <span v-for="fy in budget.fiscalYears" :key="fy.id" class="badge badge-neutral">
          {{ fy.name }} ({{ fy.status }})
        </span>
        <span v-if="budget.fiscalYears.length === 0" class="text-xs text-slate-500">None yet.</span>
      </div>

      <form
        v-if="auth.hasPermission('budget:manage')"
        class="mt-4 flex flex-wrap items-end gap-2"
        @submit.prevent="handleCreateFiscalYear"
      >
        <div>
          <label class="field-label">Name</label>
          <input v-model="newFiscalYear.name" required placeholder="2027/2028" class="input mt-1" />
        </div>
        <div>
          <label class="field-label">Start</label>
          <input v-model="newFiscalYear.startDate" type="date" required class="input mt-1" />
        </div>
        <div>
          <label class="field-label">End</label>
          <input v-model="newFiscalYear.endDate" type="date" required class="input mt-1" />
        </div>
        <button type="submit" class="btn btn-primary btn-sm">Add fiscal year</button>
      </form>
    </div>

    <!-- Create Budget -->
    <div v-if="auth.hasPermission('budget:create')" class="mt-6 card p-6">
      <h2 class="section-title">New Budget</h2>
      <form class="mt-3 space-y-3" @submit.prevent="handleCreateBudget">
        <div class="flex flex-wrap gap-2">
          <select v-model="newBudget.fiscalYearId" required class="select w-auto">
            <option value="" disabled>Fiscal year</option>
            <option v-for="fy in budget.fiscalYears" :key="fy.id" :value="fy.id">{{ fy.name }}</option>
          </select>
          <select v-model="newBudget.organizationId" required class="select w-auto">
            <option value="" disabled>Organization</option>
            <option v-for="org in organizations" :key="org.id" :value="org.id">{{ org.name }}</option>
          </select>
          <input v-model="newBudget.name" required placeholder="Budget name" class="input flex-1" />
        </div>

        <table class="w-full text-xs">
          <thead>
            <tr class="text-left text-slate-500">
              <th class="pr-2">Code</th>
              <th class="pr-2">Vote code</th>
              <th class="pr-2">Vote name</th>
              <th class="pr-2">Program</th>
              <th class="pr-2">Description</th>
              <th class="pr-2">Amount</th>
              <th />
            </tr>
          </thead>
          <tbody>
            <tr v-for="(line, i) in newBudget.lines" :key="i">
              <td class="pr-2 py-1"><input v-model="line.code" required class="input w-20 px-1.5 py-1 text-xs" /></td>
              <td class="pr-2 py-1"><input v-model="line.voteCode" required class="input w-16 px-1.5 py-1 text-xs" /></td>
              <td class="pr-2 py-1"><input v-model="line.voteName" required class="input w-24 px-1.5 py-1 text-xs" /></td>
              <td class="pr-2 py-1"><input v-model="line.programName" required class="input w-24 px-1.5 py-1 text-xs" /></td>
              <td class="pr-2 py-1"><input v-model="line.description" required class="input w-32 px-1.5 py-1 text-xs" /></td>
              <td class="pr-2 py-1">
                <input v-model.number="line.authorizedAmount" type="number" min="1" required class="input w-24 px-1.5 py-1 text-xs" />
              </td>
              <td class="py-1">
                <button
                  v-if="newBudget.lines.length > 1"
                  type="button"
                  class="btn btn-ghost btn-sm text-red-600"
                  @click="removeLine(i)"
                >
                  &times;
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <button type="button" class="btn btn-ghost btn-sm" @click="addLine">+ Add line</button>

        <div>
          <button type="submit" class="btn btn-primary">Create budget</button>
        </div>
      </form>
    </div>

    <!-- Budgets list -->
    <div class="mt-6 table-shell">
      <table class="table-base">
        <thead>
          <tr>
            <th>Name</th>
            <th>Status</th>
            <th>Total Authorized</th>
            <th>Lines</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="budget.budgets.length === 0">
            <td colspan="5" class="p-0"><EmptyState title="No budgets yet" description="Budgets created here will appear in this list." /></td>
          </tr>
          <tr v-for="b in budget.budgets" :key="b.id">
            <td class="font-medium text-slate-900">{{ b.name }}</td>
            <td><StatusBadge :status="b.status" /></td>
            <td class="num">{{ money(b.totalAuthorizedAmount) }}</td>
            <td>{{ b.lines.length }}</td>
            <td>
              <button
                v-if="b.status === 'DRAFT' && auth.hasPermission('budget:create')"
                class="btn btn-ghost btn-sm"
                @click="budget.submitBudget(b.id)"
              >
                Submit
              </button>
              <template v-if="b.status === 'PENDING_APPROVAL' && auth.hasPermission('budget:approve')">
                <button class="btn btn-ghost btn-sm text-emerald-700" @click="askApprove(b)">
                  Approve
                </button>
                <button class="btn btn-ghost btn-sm text-red-700" @click="askReject(b)">Reject</button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Allocations -->
    <div class="mt-6 table-shell">
      <table class="table-base">
        <thead>
          <tr>
            <th>Reference</th>
            <th>Authorized</th>
            <th>Committed</th>
            <th>Spent</th>
            <th>Available</th>
            <th v-if="auth.hasPermission('budget:commit')">Commit</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="budget.allocations.length === 0">
            <td colspan="6" class="p-0"><EmptyState title="No allocations yet" description="Allocations appear once a budget is approved." /></td>
          </tr>
          <tr v-for="a in budget.allocations" :key="a.id">
            <td>{{ a.authorizationReference }}</td>
            <td class="num">{{ money(a.authorizedAmount) }}</td>
            <td class="num">{{ money(a.committedAmount) }}</td>
            <td class="num">{{ money(a.spentAmount) }}</td>
            <td class="num font-medium text-slate-900">{{ money(a.availableAmount) }}</td>
            <td v-if="auth.hasPermission('budget:commit')">
              <div class="flex items-center gap-1">
                <input
                  v-model.number="commitFormFor(a.id).amount"
                  type="number"
                  min="1"
                  placeholder="Amount"
                  class="input w-20 px-1.5 py-1 text-xs"
                />
                <input
                  v-model="commitFormFor(a.id).description"
                  placeholder="Description"
                  class="input w-28 px-1.5 py-1 text-xs"
                />
                <button type="button" class="btn btn-secondary btn-sm" @click="handleCommit(a.id)">Commit</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <ConfirmDialog
      :open="pendingAction !== null"
      :title="pendingAction?.kind === 'approve' ? 'Approve this budget?' : 'Reject this budget?'"
      :message="
        pendingAction
          ? `${pendingAction.budget.name} — ${money(pendingAction.budget.totalAuthorizedAmount)} across ${pendingAction.budget.lines.length} line${pendingAction.budget.lines.length === 1 ? '' : 's'}. This will be recorded on the audit trail${pendingAction.kind === 'approve' ? ' and signed with your signing key.' : '.'}`
          : ''
      "
      :confirm-label="pendingAction?.kind === 'approve' ? 'Approve' : 'Reject'"
      :tone="pendingAction?.kind === 'reject' ? 'danger' : 'default'"
      :busy="actionBusy"
      @confirm="confirmAction"
      @cancel="pendingAction = null"
    >
      <label v-if="pendingAction?.kind === 'reject'" class="block">
        <span class="field-label">Reason (optional)</span>
        <textarea v-model="rejectReason" rows="2" class="input mt-1" placeholder="Why is this budget being rejected?" />
      </label>
    </ConfirmDialog>
  </section>
</template>
