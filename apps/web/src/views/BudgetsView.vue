<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useAuthStore } from '../stores/auth'
import { useBudgetStore } from '../stores/budget'
import { useSigningKeyStore } from '../stores/signingKey'
import { apiGet } from '../api/client'

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

async function handleApprove(budgetId: string) {
  formError.value = null
  if (!auth.user) return
  try {
    const signedFields = signingKey.signRequest(
      auth.user.sub,
      'POST',
      `/api/v1/budgets/${budgetId}/approve`,
    )
    await budget.approveBudget(budgetId, signedFields)
  } catch (err) {
    formError.value =
      err instanceof Error && err.message.includes('No signing key')
        ? 'Approving a budget requires a signing key — set one up under your account menu → Signing key.'
        : 'Unable to approve budget'
  }
}

async function handleCommit(allocationId: string) {
  const form = commitFormFor(allocationId)
  try {
    await budget.createCommitment(allocationId, form.amount, form.description)
    form.amount = 0
    form.description = ''
  } catch {
    formError.value = 'Unable to create commitment — check the available balance'
  }
}
</script>

<template>
  <section class="mx-auto max-w-5xl px-4 py-10">
    <div class="page-header">
      <h1 class="page-title">Budget Management</h1>
      <p class="page-subtitle">
        Fiscal years, budgets, allocations, and commitment-control spending.
      </p>
    </div>

    <p v-if="formError" class="mt-4 alert-error">
      {{ formError }}
    </p>

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
            <td colspan="5" class="text-center text-slate-500">No budgets yet.</td>
          </tr>
          <tr v-for="b in budget.budgets" :key="b.id">
            <td class="font-medium text-slate-900">{{ b.name }}</td>
            <td>
              <span
                class="badge"
                :class="{
                  'badge-neutral': b.status === 'DRAFT',
                  'badge-warning': b.status === 'PENDING_APPROVAL',
                  'badge-success': b.status === 'APPROVED' || b.status === 'ACTIVE',
                  'badge-danger': b.status === 'REJECTED',
                }"
              >
                {{ b.status }}
              </span>
            </td>
            <td>{{ b.totalAuthorizedAmount }}</td>
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
                <button class="btn btn-ghost btn-sm text-emerald-700" @click="handleApprove(b.id)">
                  Approve
                </button>
                <button class="btn btn-ghost btn-sm text-red-700" @click="budget.rejectBudget(b.id)">Reject</button>
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
            <td colspan="6" class="text-center text-slate-500">No allocations yet.</td>
          </tr>
          <tr v-for="a in budget.allocations" :key="a.id">
            <td>{{ a.authorizationReference }}</td>
            <td>{{ a.authorizedAmount }}</td>
            <td>{{ a.committedAmount }}</td>
            <td>{{ a.spentAmount }}</td>
            <td class="font-medium text-slate-900">{{ a.availableAmount }}</td>
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
  </section>
</template>
