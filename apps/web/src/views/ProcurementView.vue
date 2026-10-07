<script setup lang="ts">
import { computed, onMounted, reactive, ref } from 'vue'
import { useAuthStore } from '../stores/auth'
import { useProcurementStore, type ProcurementPlan, type ProcurementRequest, type Bid } from '../stores/procurement'
import { useBudgetStore } from '../stores/budget'
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
const procurement = useProcurementStore()
const budget = useBudgetStore()

const organizations = ref<Organization[]>([])
const expandedLotId = ref<string | null>(null)

const newSupplier = reactive({ name: '', registrationNumber: '' })
const newPlan = reactive({ organizationId: '', fiscalYearId: '', name: '' })
const newRequest = reactive({
  procurementPlanId: '',
  organizationId: '',
  allocationId: '',
  title: '',
  description: '',
  estimatedAmount: 0,
})
const newTender = reactive({
  procurementRequestId: '',
  title: '',
  description: '',
  closingDate: '',
  lots: [{ lotNumber: '', description: '', estimatedAmount: 0 }],
})
const bidForm = reactive({ supplierId: '', amount: 0 })
const evalForm = reactive<Record<string, { technicalScore: number; financialScore: number }>>({})

onMounted(async () => {
  await Promise.all([
    procurement.fetchSuppliers(),
    procurement.fetchPlans(),
    procurement.fetchRequests(),
    procurement.fetchTenders(),
    budget.fetchFiscalYears(),
    budget.fetchAllocations(),
  ])
  organizations.value = await apiGet<Organization[]>('/organizations')
})

function describeError(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

async function handleCreateSupplier() {
  try {
    await procurement.createSupplier(newSupplier.name, newSupplier.registrationNumber)
    notify(`Supplier “${newSupplier.name}” added.`)
    newSupplier.name = ''
    newSupplier.registrationNumber = ''
  } catch (err) {
    procurement.error = describeError(err, 'Unable to add the supplier.')
  }
}

async function handleCreatePlan() {
  try {
    await procurement.createPlan(newPlan.organizationId, newPlan.fiscalYearId, newPlan.name)
    notify(`Plan “${newPlan.name}” created.`)
    newPlan.name = ''
  } catch (err) {
    procurement.error = describeError(err, 'Unable to create the plan.')
  }
}

async function handleCreateRequest() {
  try {
    await procurement.createRequest(
      newRequest.procurementPlanId,
      newRequest.organizationId,
      newRequest.allocationId,
      newRequest.title,
      newRequest.description,
      newRequest.estimatedAmount,
    )
    notify(`Request “${newRequest.title}” created.`)
    newRequest.title = ''
    newRequest.description = ''
    newRequest.estimatedAmount = 0
  } catch (err) {
    procurement.error = describeError(err, 'Unable to create the request.')
  }
}

function addLot() {
  newTender.lots.push({ lotNumber: '', description: '', estimatedAmount: 0 })
}

async function handleCreateTender() {
  try {
    await procurement.createTender(
      newTender.procurementRequestId,
      newTender.title,
      newTender.description,
      newTender.closingDate,
      newTender.lots,
    )
    notify(`Tender “${newTender.title}” created.`)
    newTender.title = ''
    newTender.description = ''
    newTender.lots = [{ lotNumber: '', description: '', estimatedAmount: 0 }]
  } catch (err) {
    procurement.error = describeError(err, 'Unable to create the tender.')
  }
}

async function toggleLot(lotId: string) {
  if (expandedLotId.value === lotId) {
    expandedLotId.value = null
    return
  }
  expandedLotId.value = lotId
  await procurement.fetchBidsForLot(lotId)
}

async function handleSubmitBid(lotId: string) {
  try {
    await procurement.submitBid(lotId, bidForm.supplierId, bidForm.amount)
    notify('Bid submitted.')
    bidForm.supplierId = ''
    bidForm.amount = 0
  } catch (err) {
    procurement.error = describeError(err, 'Unable to submit the bid.')
  }
}

function evalFormFor(bidId: string) {
  evalForm[bidId] ??= { technicalScore: 0, financialScore: 0 }
  return evalForm[bidId]
}

type PendingProcurementAction =
  | { kind: 'approvePlan'; plan: ProcurementPlan }
  | { kind: 'approveRequest' | 'rejectRequest'; request: ProcurementRequest }
  | { kind: 'awardBid'; bid: Bid; lotId: string }
  | null
const pendingAction = ref<PendingProcurementAction>(null)
const actionBusy = ref(false)

function askApprovePlan(plan: ProcurementPlan) {
  pendingAction.value = { kind: 'approvePlan', plan }
}
function askApproveRequest(request: ProcurementRequest) {
  pendingAction.value = { kind: 'approveRequest', request }
}
function askRejectRequest(request: ProcurementRequest) {
  pendingAction.value = { kind: 'rejectRequest', request }
}
function askAwardBid(bid: Bid, lotId: string) {
  pendingAction.value = { kind: 'awardBid', bid, lotId }
}

const confirmTitle = computed(() => {
  switch (pendingAction.value?.kind) {
    case 'approvePlan':
      return 'Approve this procurement plan?'
    case 'approveRequest':
      return 'Approve this request?'
    case 'rejectRequest':
      return 'Reject this request?'
    case 'awardBid':
      return 'Award this bid?'
    default:
      return ''
  }
})
const confirmMessage = computed(() => {
  const a = pendingAction.value
  if (!a) return ''
  if (a.kind === 'approvePlan') {
    return `“${a.plan.name}” will be approved. Requests can then be raised against it.`
  }
  if (a.kind === 'approveRequest' || a.kind === 'rejectRequest') {
    return `${a.request.title} — ${money(a.request.estimatedAmount)}. This will be recorded on the audit trail.`
  }
  if (a.kind === 'awardBid') {
    return `Supplier bid of ${money(a.bid.amount)} will be awarded the contract. This cannot be undone.`
  }
  return ''
})

async function confirmAction() {
  const a = pendingAction.value
  if (!a) return
  actionBusy.value = true
  procurement.error = null
  try {
    if (a.kind === 'approvePlan') {
      await procurement.approvePlan(a.plan.id)
      notify(`“${a.plan.name}” approved.`)
    } else if (a.kind === 'approveRequest') {
      await procurement.approveRequest(a.request.id)
      if (!procurement.error) notify(`“${a.request.title}” approved.`)
    } else if (a.kind === 'rejectRequest') {
      await procurement.rejectRequest(a.request.id)
      notify(`“${a.request.title}” rejected.`)
    } else if (a.kind === 'awardBid') {
      await procurement.awardBid(a.bid.id, a.lotId)
      if (!procurement.error) notify('Bid awarded.')
    }
    pendingAction.value = null
  } finally {
    actionBusy.value = false
  }
}
</script>

<template>
  <section class="mx-auto max-w-5xl px-4 py-10">
    <PageHeader title="Procurement" subtitle="Plans, requests, tenders, bids, and awards — draws directly against budget allocations." />

    <AlertBanner v-if="procurement.error" class="mt-4">{{ procurement.error }}</AlertBanner>

    <!-- Suppliers -->
    <div v-if="auth.hasPermission('procurement:manage')" class="mt-6 card p-6">
      <h2 class="section-title">Suppliers</h2>
      <div class="mt-2 flex flex-wrap gap-2">
        <router-link
          v-for="s in procurement.suppliers"
          :key="s.id"
          :to="auth.hasPermission('supplier:read') ? `/suppliers/${s.id}` : ''"
          class="badge badge-neutral"
          :class="auth.hasPermission('supplier:read') ? 'hover:bg-slate-200' : 'cursor-default'"
        >
          {{ s.name }} ({{ s.status }})
        </router-link>
      </div>
      <form class="mt-3 flex flex-wrap items-end gap-2" @submit.prevent="handleCreateSupplier">
        <input v-model="newSupplier.name" required placeholder="Supplier name" class="input" />
        <input v-model="newSupplier.registrationNumber" required placeholder="Registration No." class="input" />
        <button type="submit" class="btn btn-primary btn-sm">Add supplier</button>
      </form>
    </div>

    <!-- Procurement Plans -->
    <div v-if="auth.hasPermission('procurement:manage')" class="mt-6 card p-6">
      <h2 class="section-title">Procurement Plans</h2>
      <table class="mt-2 w-full text-xs">
        <tbody>
          <tr v-for="p in procurement.plans" :key="p.id" class="border-t border-slate-100">
            <td class="py-1 pr-2">{{ p.name }}</td>
            <td class="py-1 pr-2">
              <StatusBadge :status="p.status" />
            </td>
            <td class="py-1">
              <button
                v-if="p.status === 'DRAFT' && auth.hasPermission('procurement:approve')"
                class="btn btn-ghost btn-sm text-emerald-700"
                @click="askApprovePlan(p)"
              >
                Approve
              </button>
            </td>
          </tr>
        </tbody>
      </table>
      <form class="mt-3 flex flex-wrap items-end gap-2" @submit.prevent="handleCreatePlan">
        <select v-model="newPlan.organizationId" required class="select w-auto">
          <option value="" disabled>Organization</option>
          <option v-for="org in organizations" :key="org.id" :value="org.id">{{ org.name }}</option>
        </select>
        <select v-model="newPlan.fiscalYearId" required class="select w-auto">
          <option value="" disabled>Fiscal year</option>
          <option v-for="fy in budget.fiscalYears" :key="fy.id" :value="fy.id">{{ fy.name }}</option>
        </select>
        <input v-model="newPlan.name" required placeholder="Plan name" class="input" />
        <button type="submit" class="btn btn-primary btn-sm">Add plan</button>
      </form>
    </div>

    <!-- Procurement Requests -->
    <div class="mt-6 card p-6">
      <h2 class="section-title">Procurement Requests</h2>
      <table class="mt-2 w-full text-xs">
        <thead>
          <tr class="text-left text-slate-500">
            <th class="pr-2">Title</th>
            <th class="pr-2">Amount</th>
            <th class="pr-2">Status</th>
            <th>Actions</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="procurement.requests.length === 0">
            <td colspan="4" class="p-0"><EmptyState title="No procurement requests yet" /></td>
          </tr>
          <tr v-for="r in procurement.requests" :key="r.id" class="border-t border-slate-100">
            <td class="py-1 pr-2">{{ r.title }}</td>
            <td class="num py-1 pr-2">{{ money(r.estimatedAmount) }}</td>
            <td class="py-1 pr-2">
              <StatusBadge :status="r.status" />
            </td>
            <td class="py-1">
              <button
                v-if="r.status === 'DRAFT' && auth.hasPermission('procurement:create')"
                class="btn btn-ghost btn-sm"
                @click="procurement.submitRequest(r.id)"
              >
                Submit
              </button>
              <template v-if="r.status === 'SUBMITTED' && auth.hasPermission('procurement:approve')">
                <button class="btn btn-ghost btn-sm text-emerald-700" @click="askApproveRequest(r)">
                  Approve
                </button>
                <button class="btn btn-ghost btn-sm text-red-700" @click="askRejectRequest(r)">Reject</button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
      <form v-if="auth.hasPermission('procurement:create')" class="mt-3 space-y-2" @submit.prevent="handleCreateRequest">
        <div class="flex flex-wrap gap-2">
          <select v-model="newRequest.procurementPlanId" required class="select w-auto">
            <option value="" disabled>Plan</option>
            <option v-for="p in procurement.plans.filter((x) => x.status === 'APPROVED')" :key="p.id" :value="p.id">
              {{ p.name }}
            </option>
          </select>
          <select v-model="newRequest.organizationId" required class="select w-auto">
            <option value="" disabled>Organization</option>
            <option v-for="org in organizations" :key="org.id" :value="org.id">{{ org.name }}</option>
          </select>
          <select v-model="newRequest.allocationId" required class="select w-auto">
            <option value="" disabled>Allocation</option>
            <option v-for="a in budget.allocations" :key="a.id" :value="a.id">
              {{ a.authorizationReference }} (avail: {{ money(a.availableAmount) }})
            </option>
          </select>
        </div>
        <div class="flex flex-wrap gap-2">
          <input v-model="newRequest.title" required placeholder="Title" class="input" />
          <input v-model="newRequest.description" required placeholder="Description" class="input" />
          <input v-model.number="newRequest.estimatedAmount" type="number" min="1" required placeholder="Estimated amount" class="input" />
          <button type="submit" class="btn btn-primary btn-sm">Create request</button>
        </div>
      </form>
    </div>

    <!-- Tenders -->
    <div class="mt-6 card p-6">
      <h2 class="section-title">Tenders</h2>
      <div v-for="t in procurement.tenders" :key="t.id" class="mt-3 rounded-lg border border-slate-100 p-3">
        <div class="flex items-center justify-between">
          <div>
            <span class="text-sm font-medium text-slate-900">{{ t.title }}</span>
            <span class="ml-2 text-xs text-slate-500">{{ t.tenderNumber }}</span>
            <StatusBadge class="ml-2" :status="t.status" />
          </div>
          <div v-if="auth.hasPermission('procurement:publish')">
            <button v-if="t.status === 'DRAFT'" class="btn btn-ghost btn-sm" @click="procurement.publishTender(t.id)">
              Publish
            </button>
            <button v-if="t.status === 'PUBLISHED'" class="btn btn-ghost btn-sm" @click="procurement.closeTender(t.id)">
              Close bidding
            </button>
          </div>
        </div>

        <table class="mt-2 w-full text-xs">
          <tbody>
            <tr v-for="lot in t.lots" :key="lot.id" class="border-t border-slate-100">
              <td class="py-1 pr-2">{{ lot.lotNumber }} — {{ lot.description }}</td>
              <td class="num py-1 pr-2">{{ money(lot.estimatedAmount) }}</td>
              <td class="py-1">
                <button class="btn btn-ghost btn-sm" @click="toggleLot(lot.id)">
                  {{ expandedLotId === lot.id ? 'Hide bids' : 'View bids' }}
                </button>
              </td>
            </tr>
          </tbody>
        </table>

        <div v-if="expandedLotId" class="mt-2 rounded-lg bg-slate-50 p-2">
          <table class="w-full text-xs">
            <thead>
              <tr class="text-left text-slate-500">
                <th class="pr-2">Supplier</th>
                <th class="pr-2">Amount</th>
                <th class="pr-2">Status</th>
                <th class="pr-2">Scores</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              <tr v-for="bid in procurement.bidsByLot[expandedLotId] ?? []" :key="bid.id" class="border-t border-slate-100">
                <td class="py-1 pr-2">{{ bid.supplierId.slice(0, 8) }}…</td>
                <td class="num py-1 pr-2">{{ money(bid.amount) }}</td>
                <td class="py-1 pr-2">
                  <StatusBadge :status="bid.status" />
                </td>
                <td class="py-1 pr-2">
                  <span v-if="bid.technicalScore">T:{{ bid.technicalScore }} F:{{ bid.financialScore }}</span>
                </td>
                <td class="py-1">
                  <div v-if="bid.status === 'SUBMITTED' && auth.hasPermission('procurement:evaluate')" class="flex items-center gap-1">
                    <input v-model.number="evalFormFor(bid.id).technicalScore" type="number" min="0" max="100" placeholder="Tech" class="input w-14 px-1.5 py-1 text-xs" />
                    <input v-model.number="evalFormFor(bid.id).financialScore" type="number" min="0" max="100" placeholder="Fin" class="input w-14 px-1.5 py-1 text-xs" />
                    <button
                      type="button"
                      class="btn btn-secondary btn-sm"
                      @click="procurement.evaluateBid(bid.id, expandedLotId!, evalFormFor(bid.id).technicalScore, evalFormFor(bid.id).financialScore)"
                    >
                      Score
                    </button>
                  </div>
                  <button
                    v-if="bid.status === 'EVALUATED' && auth.hasPermission('procurement:award')"
                    class="btn btn-ghost btn-sm text-emerald-700"
                    @click="askAwardBid(bid, expandedLotId!)"
                  >
                    Award
                  </button>
                </td>
              </tr>
            </tbody>
          </table>
          <form v-if="auth.hasPermission('procurement:bid')" class="mt-2 flex items-center gap-1" @submit.prevent="handleSubmitBid(expandedLotId)">
            <select v-model="bidForm.supplierId" required class="select w-auto px-1.5 py-1 text-xs">
              <option value="" disabled>Supplier</option>
              <option v-for="s in procurement.suppliers" :key="s.id" :value="s.id">{{ s.name }}</option>
            </select>
            <input v-model.number="bidForm.amount" type="number" min="1" required placeholder="Amount" class="input w-24 px-1.5 py-1 text-xs" />
            <button type="submit" class="btn btn-secondary btn-sm">Submit bid</button>
          </form>
        </div>
      </div>

      <form v-if="auth.hasPermission('procurement:create')" class="mt-4 space-y-2 border-t border-slate-100 pt-3" @submit.prevent="handleCreateTender">
        <div class="flex flex-wrap gap-2">
          <select v-model="newTender.procurementRequestId" required class="select w-auto">
            <option value="" disabled>Approved request</option>
            <option v-for="r in procurement.requests.filter((x) => x.status === 'APPROVED')" :key="r.id" :value="r.id">
              {{ r.title }}
            </option>
          </select>
          <input v-model="newTender.title" required placeholder="Tender title" class="input" />
          <input v-model="newTender.description" required placeholder="Description" class="input" />
          <input v-model="newTender.closingDate" type="date" required class="input" />
        </div>
        <table class="w-full text-xs">
          <tbody>
            <tr v-for="(lot, i) in newTender.lots" :key="i">
              <td class="py-1 pr-2"><input v-model="lot.lotNumber" required placeholder="Lot #" class="input w-20 px-1.5 py-1 text-xs" /></td>
              <td class="py-1 pr-2"><input v-model="lot.description" required placeholder="Description" class="input w-40 px-1.5 py-1 text-xs" /></td>
              <td class="py-1 pr-2"><input v-model.number="lot.estimatedAmount" type="number" min="1" required placeholder="Amount" class="input w-24 px-1.5 py-1 text-xs" /></td>
            </tr>
          </tbody>
        </table>
        <button type="button" class="btn btn-ghost btn-sm" @click="addLot">+ Add lot</button>
        <div>
          <button type="submit" class="btn btn-primary">Create tender</button>
        </div>
      </form>
    </div>

    <ConfirmDialog
      :open="pendingAction !== null"
      :title="confirmTitle"
      :message="confirmMessage"
      :confirm-label="pendingAction?.kind === 'rejectRequest' ? 'Reject' : pendingAction?.kind === 'awardBid' ? 'Award' : 'Approve'"
      :tone="pendingAction?.kind === 'rejectRequest' ? 'danger' : 'default'"
      :busy="actionBusy"
      @confirm="confirmAction"
      @cancel="pendingAction = null"
    />
  </section>
</template>
