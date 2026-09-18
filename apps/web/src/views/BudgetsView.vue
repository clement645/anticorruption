<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useAuthStore } from '../stores/auth'
import { useBudgetStore } from '../stores/budget'
import { apiGet } from '../api/client'

interface Organization {
  id: string
  name: string
}

const auth = useAuthStore()
const budget = useBudgetStore()

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
    <h1 class="text-2xl font-semibold text-slate-900">Budget Management</h1>
    <p class="mt-1 text-sm text-slate-600">
      Fiscal years, budgets, allocations, and commitment-control spending.
    </p>

    <p v-if="formError" class="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
      {{ formError }}
    </p>

    <!-- Fiscal Years -->
    <div class="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 class="text-sm font-medium text-slate-900">Fiscal Years</h2>
      <div class="mt-3 flex flex-wrap gap-2">
        <span
          v-for="fy in budget.fiscalYears"
          :key="fy.id"
          class="rounded-full bg-slate-100 px-3 py-1 text-xs text-slate-700"
        >
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
          <label class="block text-xs text-slate-500">Name</label>
          <input v-model="newFiscalYear.name" required placeholder="2027/2028" class="rounded-md border border-slate-300 px-2 py-1 text-sm" />
        </div>
        <div>
          <label class="block text-xs text-slate-500">Start</label>
          <input v-model="newFiscalYear.startDate" type="date" required class="rounded-md border border-slate-300 px-2 py-1 text-sm" />
        </div>
        <div>
          <label class="block text-xs text-slate-500">End</label>
          <input v-model="newFiscalYear.endDate" type="date" required class="rounded-md border border-slate-300 px-2 py-1 text-sm" />
        </div>
        <button type="submit" class="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800">
          Add fiscal year
        </button>
      </form>
    </div>

    <!-- Create Budget -->
    <div v-if="auth.hasPermission('budget:create')" class="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 class="text-sm font-medium text-slate-900">New Budget</h2>
      <form class="mt-3 space-y-3" @submit.prevent="handleCreateBudget">
        <div class="flex flex-wrap gap-2">
          <select v-model="newBudget.fiscalYearId" required class="rounded-md border border-slate-300 px-2 py-1 text-sm">
            <option value="" disabled>Fiscal year</option>
            <option v-for="fy in budget.fiscalYears" :key="fy.id" :value="fy.id">{{ fy.name }}</option>
          </select>
          <select v-model="newBudget.organizationId" required class="rounded-md border border-slate-300 px-2 py-1 text-sm">
            <option value="" disabled>Organization</option>
            <option v-for="org in organizations" :key="org.id" :value="org.id">{{ org.name }}</option>
          </select>
          <input v-model="newBudget.name" required placeholder="Budget name" class="flex-1 rounded-md border border-slate-300 px-2 py-1 text-sm" />
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
              <td class="pr-2 py-1"><input v-model="line.code" required class="w-20 rounded border border-slate-300 px-1 py-0.5" /></td>
              <td class="pr-2 py-1"><input v-model="line.voteCode" required class="w-16 rounded border border-slate-300 px-1 py-0.5" /></td>
              <td class="pr-2 py-1"><input v-model="line.voteName" required class="w-24 rounded border border-slate-300 px-1 py-0.5" /></td>
              <td class="pr-2 py-1"><input v-model="line.programName" required class="w-24 rounded border border-slate-300 px-1 py-0.5" /></td>
              <td class="pr-2 py-1"><input v-model="line.description" required class="w-32 rounded border border-slate-300 px-1 py-0.5" /></td>
              <td class="pr-2 py-1">
                <input v-model.number="line.authorizedAmount" type="number" min="1" required class="w-24 rounded border border-slate-300 px-1 py-0.5" />
              </td>
              <td class="py-1">
                <button
                  v-if="newBudget.lines.length > 1"
                  type="button"
                  class="text-red-600"
                  @click="removeLine(i)"
                >
                  &times;
                </button>
              </td>
            </tr>
          </tbody>
        </table>
        <button type="button" class="text-xs text-slate-600 underline" @click="addLine">+ Add line</button>

        <div>
          <button type="submit" class="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800">
            Create budget
          </button>
        </div>
      </form>
    </div>

    <!-- Budgets list -->
    <div class="mt-6 overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
      <table class="min-w-full divide-y divide-slate-200 text-sm">
        <thead class="bg-slate-50">
          <tr>
            <th class="px-4 py-2 text-left font-medium text-slate-500">Name</th>
            <th class="px-4 py-2 text-left font-medium text-slate-500">Status</th>
            <th class="px-4 py-2 text-left font-medium text-slate-500">Total Authorized</th>
            <th class="px-4 py-2 text-left font-medium text-slate-500">Lines</th>
            <th class="px-4 py-2 text-left font-medium text-slate-500">Actions</th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          <tr v-if="budget.budgets.length === 0">
            <td colspan="5" class="px-4 py-6 text-center text-slate-500">No budgets yet.</td>
          </tr>
          <tr v-for="b in budget.budgets" :key="b.id">
            <td class="px-4 py-2 font-medium text-slate-900">{{ b.name }}</td>
            <td class="px-4 py-2 text-slate-600">{{ b.status }}</td>
            <td class="px-4 py-2 text-slate-600">{{ b.totalAuthorizedAmount }}</td>
            <td class="px-4 py-2 text-slate-600">{{ b.lines.length }}</td>
            <td class="px-4 py-2">
              <button
                v-if="b.status === 'DRAFT' && auth.hasPermission('budget:create')"
                class="mr-2 text-xs text-slate-700 underline"
                @click="budget.submitBudget(b.id)"
              >
                Submit
              </button>
              <template v-if="b.status === 'PENDING_APPROVAL' && auth.hasPermission('budget:approve')">
                <button class="mr-2 text-xs text-emerald-700 underline" @click="budget.approveBudget(b.id)">
                  Approve
                </button>
                <button class="text-xs text-red-700 underline" @click="budget.rejectBudget(b.id)">Reject</button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
    </div>

    <!-- Allocations -->
    <div class="mt-6 overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
      <table class="min-w-full divide-y divide-slate-200 text-sm">
        <thead class="bg-slate-50">
          <tr>
            <th class="px-4 py-2 text-left font-medium text-slate-500">Reference</th>
            <th class="px-4 py-2 text-left font-medium text-slate-500">Authorized</th>
            <th class="px-4 py-2 text-left font-medium text-slate-500">Committed</th>
            <th class="px-4 py-2 text-left font-medium text-slate-500">Spent</th>
            <th class="px-4 py-2 text-left font-medium text-slate-500">Available</th>
            <th v-if="auth.hasPermission('budget:commit')" class="px-4 py-2 text-left font-medium text-slate-500">
              Commit
            </th>
          </tr>
        </thead>
        <tbody class="divide-y divide-slate-100">
          <tr v-if="budget.allocations.length === 0">
            <td colspan="6" class="px-4 py-6 text-center text-slate-500">No allocations yet.</td>
          </tr>
          <tr v-for="a in budget.allocations" :key="a.id">
            <td class="px-4 py-2 text-slate-600">{{ a.authorizationReference }}</td>
            <td class="px-4 py-2 text-slate-600">{{ a.authorizedAmount }}</td>
            <td class="px-4 py-2 text-slate-600">{{ a.committedAmount }}</td>
            <td class="px-4 py-2 text-slate-600">{{ a.spentAmount }}</td>
            <td class="px-4 py-2 font-medium text-slate-900">{{ a.availableAmount }}</td>
            <td v-if="auth.hasPermission('budget:commit')" class="px-4 py-2">
              <div class="flex items-center gap-1">
                <input
                  v-model.number="commitFormFor(a.id).amount"
                  type="number"
                  min="1"
                  placeholder="Amount"
                  class="w-20 rounded border border-slate-300 px-1 py-0.5 text-xs"
                />
                <input
                  v-model="commitFormFor(a.id).description"
                  placeholder="Description"
                  class="w-28 rounded border border-slate-300 px-1 py-0.5 text-xs"
                />
                <button
                  type="button"
                  class="rounded border border-slate-300 px-2 py-0.5 text-xs hover:bg-slate-50"
                  @click="handleCommit(a.id)"
                >
                  Commit
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
