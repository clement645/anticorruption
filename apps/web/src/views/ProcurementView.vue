<script setup lang="ts">
import { onMounted, reactive, ref } from 'vue'
import { useAuthStore } from '../stores/auth'
import { useProcurementStore } from '../stores/procurement'
import { useBudgetStore } from '../stores/budget'
import { apiGet } from '../api/client'

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

async function handleCreateSupplier() {
  await procurement.createSupplier(newSupplier.name, newSupplier.registrationNumber)
  newSupplier.name = ''
  newSupplier.registrationNumber = ''
}

async function handleCreatePlan() {
  await procurement.createPlan(newPlan.organizationId, newPlan.fiscalYearId, newPlan.name)
  newPlan.name = ''
}

async function handleCreateRequest() {
  await procurement.createRequest(
    newRequest.procurementPlanId,
    newRequest.organizationId,
    newRequest.allocationId,
    newRequest.title,
    newRequest.description,
    newRequest.estimatedAmount,
  )
  newRequest.title = ''
  newRequest.description = ''
  newRequest.estimatedAmount = 0
}

function addLot() {
  newTender.lots.push({ lotNumber: '', description: '', estimatedAmount: 0 })
}

async function handleCreateTender() {
  await procurement.createTender(
    newTender.procurementRequestId,
    newTender.title,
    newTender.description,
    newTender.closingDate,
    newTender.lots,
  )
  newTender.title = ''
  newTender.description = ''
  newTender.lots = [{ lotNumber: '', description: '', estimatedAmount: 0 }]
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
  await procurement.submitBid(lotId, bidForm.supplierId, bidForm.amount)
  bidForm.supplierId = ''
  bidForm.amount = 0
}

function evalFormFor(bidId: string) {
  evalForm[bidId] ??= { technicalScore: 0, financialScore: 0 }
  return evalForm[bidId]
}
</script>

<template>
  <section class="mx-auto max-w-5xl px-4 py-10">
    <div class="page-header">
      <h1 class="page-title">Procurement</h1>
      <p class="page-subtitle">
        Plans, requests, tenders, bids, and awards — draws directly against budget allocations.
      </p>
    </div>

    <p v-if="procurement.error" class="mt-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">
      {{ procurement.error }}
    </p>

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
              <span
                class="badge"
                :class="{ 'badge-neutral': p.status === 'DRAFT', 'badge-success': p.status === 'APPROVED' }"
              >
                {{ p.status }}
              </span>
            </td>
            <td class="py-1">
              <button
                v-if="p.status === 'DRAFT' && auth.hasPermission('procurement:approve')"
                class="btn btn-ghost btn-sm text-emerald-700"
                @click="procurement.approvePlan(p.id)"
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
          <tr v-for="r in procurement.requests" :key="r.id" class="border-t border-slate-100">
            <td class="py-1 pr-2">{{ r.title }}</td>
            <td class="py-1 pr-2">{{ r.estimatedAmount }}</td>
            <td class="py-1 pr-2">
              <span
                class="badge"
                :class="{
                  'badge-neutral': r.status === 'DRAFT',
                  'badge-warning': r.status === 'SUBMITTED',
                  'badge-success': r.status === 'APPROVED',
                  'badge-danger': r.status === 'REJECTED',
                }"
              >
                {{ r.status }}
              </span>
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
                <button class="btn btn-ghost btn-sm text-emerald-700" @click="procurement.approveRequest(r.id)">
                  Approve
                </button>
                <button class="btn btn-ghost btn-sm text-red-700" @click="procurement.rejectRequest(r.id)">Reject</button>
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
              {{ a.authorizationReference }} (avail: {{ a.availableAmount }})
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
            <span
              class="badge ml-2"
              :class="{
                'badge-neutral': t.status === 'DRAFT',
                'badge-info': t.status === 'PUBLISHED',
                'badge-warning': t.status === 'CLOSED',
              }"
            >
              {{ t.status }}
            </span>
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
              <td class="py-1 pr-2">{{ lot.estimatedAmount }}</td>
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
                <td class="py-1 pr-2">{{ bid.amount }}</td>
                <td class="py-1 pr-2">
                  <span
                    class="badge"
                    :class="{
                      'badge-neutral': bid.status === 'SUBMITTED',
                      'badge-info': bid.status === 'EVALUATED',
                      'badge-success': bid.status === 'AWARDED',
                    }"
                  >
                    {{ bid.status }}
                  </span>
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
                    @click="procurement.awardBid(bid.id, expandedLotId!)"
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
  </section>
</template>
