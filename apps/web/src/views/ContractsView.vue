<script setup lang="ts">
import { onMounted, reactive } from 'vue'
import { useAuthStore } from '../stores/auth'
import { useContractsStore } from '../stores/contracts'

const auth = useAuthStore()
const store = useContractsStore()

const canManageContracts = auth.hasPermission('contract:manage')
const canSubmitInvoice = auth.hasPermission('invoice:submit')
const canVerifyInvoice = auth.hasPermission('invoice:verify')
const canApprovePayment = auth.hasPermission('payment:approve')
const canExecutePayment = auth.hasPermission('payment:execute')
const canReconcile = auth.hasPermission('payment:reconcile')

const contractForm = reactive({
  awardId: '',
  contractNumber: '',
  title: '',
  value: 0,
  startDate: '',
  endDate: '',
})

const poForm = reactive({ contractId: '', poNumber: '', description: '', amount: 0 })

const invoiceForm = reactive({
  purchaseOrderId: '',
  invoiceNumber: '',
  description: '',
  quantity: 1,
  unitPrice: 0,
})

const rejectReasonByInvoice = reactive<Record<string, string>>({})
const notesByRequest = reactive<Record<string, string>>({})
const reconcileForm = reactive<Record<string, { externalReference: string; status: 'MATCHED' | 'DISCREPANCY' }>>({})

onMounted(async () => {
  await Promise.all([
    store.fetchContracts(),
    store.fetchPurchaseOrders(),
    store.fetchInvoices(),
    store.fetchPaymentRequests(),
    store.fetchPayments(),
  ])
})

async function handleCreateContract() {
  await store.createContract(
    contractForm.awardId,
    contractForm.contractNumber,
    contractForm.title,
    contractForm.value,
    contractForm.startDate,
    contractForm.endDate,
  )
  contractForm.awardId = ''
  contractForm.contractNumber = ''
  contractForm.title = ''
  contractForm.value = 0
}

async function handleCreatePO() {
  await store.createPurchaseOrder(poForm.contractId, poForm.poNumber, poForm.description, poForm.amount)
  poForm.poNumber = ''
  poForm.description = ''
  poForm.amount = 0
}

async function handleCreateInvoice() {
  const amount = invoiceForm.quantity * invoiceForm.unitPrice
  await store.createInvoice(invoiceForm.purchaseOrderId, invoiceForm.invoiceNumber, amount, [
    {
      description: invoiceForm.description,
      quantity: invoiceForm.quantity,
      unitPrice: invoiceForm.unitPrice,
      amount,
    },
  ])
  invoiceForm.invoiceNumber = ''
  invoiceForm.description = ''
  invoiceForm.quantity = 1
  invoiceForm.unitPrice = 0
}

async function handleRejectInvoice(id: string) {
  await store.rejectInvoice(id, rejectReasonByInvoice[id] || 'Rejected')
  delete rejectReasonByInvoice[id]
}

function reconcileFormFor(paymentId: string) {
  reconcileForm[paymentId] ??= { externalReference: '', status: 'MATCHED' }
  return reconcileForm[paymentId]
}

async function handleReconcile(paymentId: string) {
  const form = reconcileFormFor(paymentId)
  await store.recordReconciliation(paymentId, form.externalReference, form.status)
  delete reconcileForm[paymentId]
}

function activePOs() {
  return store.purchaseOrders.filter((p) => p.status === 'ISSUED')
}
function activeContracts() {
  return store.contracts.filter((c) => c.status === 'ACTIVE')
}
</script>

<template>
  <section class="mx-auto max-w-5xl px-4 py-10">
    <h1 class="text-2xl font-semibold text-slate-900">Contracts, Invoices &amp; Payments</h1>
    <p class="mt-1 text-sm text-slate-600">
      Award → Contract → Purchase Order → Invoice → multi-signature Payment approval → execution.
    </p>

    <p v-if="store.error" class="mt-4 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">
      {{ store.error }}
    </p>

    <!-- Contracts -->
    <div class="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 class="text-sm font-medium text-slate-900">Contracts</h2>
      <table class="mt-2 w-full text-xs">
        <thead>
          <tr class="text-left text-slate-500">
            <th class="pr-2">Number</th>
            <th class="pr-2">Title</th>
            <th class="pr-2">Value</th>
            <th class="pr-2">Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="c in store.contracts" :key="c.id" class="border-t border-slate-100">
            <td class="py-1 pr-2">{{ c.contractNumber }}</td>
            <td class="py-1 pr-2">{{ c.title }}</td>
            <td class="py-1 pr-2">{{ c.value }}</td>
            <td class="py-1 pr-2">{{ c.status }}</td>
            <td class="py-1">
              <template v-if="canManageContracts">
                <button v-if="c.status === 'DRAFT'" class="mr-2 text-emerald-700 underline" @click="store.activateContract(c.id)">
                  Activate
                </button>
                <button v-if="c.status === 'ACTIVE'" class="mr-2 underline" @click="store.completeContract(c.id)">
                  Complete
                </button>
                <button
                  v-if="c.status === 'DRAFT' || c.status === 'ACTIVE'"
                  class="text-red-700 underline"
                  @click="store.terminateContract(c.id)"
                >
                  Terminate
                </button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
      <form v-if="canManageContracts" class="mt-3 flex flex-wrap items-end gap-2" @submit.prevent="handleCreateContract">
        <input v-model="contractForm.awardId" required placeholder="Award ID" class="w-64 rounded-md border border-slate-300 px-2 py-1 text-sm" />
        <input v-model="contractForm.contractNumber" required placeholder="Contract number" class="rounded-md border border-slate-300 px-2 py-1 text-sm" />
        <input v-model="contractForm.title" required placeholder="Title" class="rounded-md border border-slate-300 px-2 py-1 text-sm" />
        <input v-model.number="contractForm.value" type="number" min="1" required placeholder="Value" class="w-28 rounded-md border border-slate-300 px-2 py-1 text-sm" />
        <input v-model="contractForm.startDate" type="date" required class="rounded-md border border-slate-300 px-2 py-1 text-sm" />
        <input v-model="contractForm.endDate" type="date" required class="rounded-md border border-slate-300 px-2 py-1 text-sm" />
        <button type="submit" class="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800">
          Create contract
        </button>
      </form>
      <p class="mt-1 text-[11px] text-slate-400">
        Budget line, supplier, and organization are derived server-side from the award — not entered here.
      </p>
    </div>

    <!-- Purchase Orders -->
    <div class="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 class="text-sm font-medium text-slate-900">Purchase Orders</h2>
      <table class="mt-2 w-full text-xs">
        <thead>
          <tr class="text-left text-slate-500">
            <th class="pr-2">PO Number</th>
            <th class="pr-2">Description</th>
            <th class="pr-2">Amount</th>
            <th class="pr-2">Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="po in store.purchaseOrders" :key="po.id" class="border-t border-slate-100">
            <td class="py-1 pr-2">{{ po.poNumber }}</td>
            <td class="py-1 pr-2">{{ po.description }}</td>
            <td class="py-1 pr-2">{{ po.amount }}</td>
            <td class="py-1 pr-2">{{ po.status }}</td>
            <td class="py-1">
              <template v-if="canManageContracts">
                <button v-if="po.status === 'DRAFT'" class="mr-2 text-emerald-700 underline" @click="store.issuePurchaseOrder(po.id)">
                  Issue
                </button>
                <button v-if="po.status === 'DRAFT' || po.status === 'ISSUED'" class="text-red-700 underline" @click="store.cancelPurchaseOrder(po.id)">
                  Cancel
                </button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
      <form v-if="canManageContracts" class="mt-3 flex flex-wrap items-end gap-2" @submit.prevent="handleCreatePO">
        <select v-model="poForm.contractId" required class="rounded-md border border-slate-300 px-2 py-1 text-sm">
          <option value="" disabled>Active contract</option>
          <option v-for="c in activeContracts()" :key="c.id" :value="c.id">{{ c.contractNumber }}</option>
        </select>
        <input v-model="poForm.poNumber" required placeholder="PO number" class="rounded-md border border-slate-300 px-2 py-1 text-sm" />
        <input v-model="poForm.description" required placeholder="Description" class="rounded-md border border-slate-300 px-2 py-1 text-sm" />
        <input v-model.number="poForm.amount" type="number" min="1" required placeholder="Amount" class="w-28 rounded-md border border-slate-300 px-2 py-1 text-sm" />
        <button type="submit" class="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800">
          Create PO
        </button>
      </form>
    </div>

    <!-- Invoices -->
    <div class="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 class="text-sm font-medium text-slate-900">Invoices</h2>
      <table class="mt-2 w-full text-xs">
        <thead>
          <tr class="text-left text-slate-500">
            <th class="pr-2">Invoice #</th>
            <th class="pr-2">Amount</th>
            <th class="pr-2">Status</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="inv in store.invoices" :key="inv.id" class="border-t border-slate-100">
            <td class="py-1 pr-2">{{ inv.invoiceNumber }}</td>
            <td class="py-1 pr-2">{{ inv.amount }}</td>
            <td class="py-1 pr-2">{{ inv.status }}</td>
            <td class="py-1">
              <div v-if="inv.status === 'SUBMITTED' && canVerifyInvoice" class="flex items-center gap-1">
                <button class="text-emerald-700 underline" @click="store.verifyInvoice(inv.id)">Verify</button>
                <input v-model="rejectReasonByInvoice[inv.id]" placeholder="Reason" class="w-28 rounded border border-slate-300 px-1 py-0.5" />
                <button class="text-red-700 underline" @click="handleRejectInvoice(inv.id)">Reject</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <form v-if="canSubmitInvoice" class="mt-3 flex flex-wrap items-end gap-2" @submit.prevent="handleCreateInvoice">
        <select v-model="invoiceForm.purchaseOrderId" required class="rounded-md border border-slate-300 px-2 py-1 text-sm">
          <option value="" disabled>Issued PO</option>
          <option v-for="po in activePOs()" :key="po.id" :value="po.id">{{ po.poNumber }}</option>
        </select>
        <input v-model="invoiceForm.invoiceNumber" required placeholder="Invoice number" class="rounded-md border border-slate-300 px-2 py-1 text-sm" />
        <input v-model="invoiceForm.description" required placeholder="Line description" class="rounded-md border border-slate-300 px-2 py-1 text-sm" />
        <input v-model.number="invoiceForm.quantity" type="number" min="1" required placeholder="Qty" class="w-16 rounded-md border border-slate-300 px-2 py-1 text-sm" />
        <input v-model.number="invoiceForm.unitPrice" type="number" min="1" required placeholder="Unit price" class="w-24 rounded-md border border-slate-300 px-2 py-1 text-sm" />
        <button type="submit" class="rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800">
          Submit invoice
        </button>
      </form>
    </div>

    <!-- Payment Requests -->
    <div class="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 class="text-sm font-medium text-slate-900">Payment Requests</h2>
      <p class="mt-1 text-[11px] text-slate-400">
        Multi-signature approval — {{ store.paymentRequests[0]?.requiredApprovals ?? 2 }} distinct approvers required before execution.
      </p>
      <div v-for="pr in store.paymentRequests" :key="pr.id" class="mt-3 rounded-md border border-slate-100 p-3 text-xs">
        <div class="flex items-center justify-between">
          <span class="font-medium">{{ pr.amount }} — {{ pr.status }}</span>
          <span class="text-slate-400">{{ pr.approvals.length }}/{{ pr.requiredApprovals }} approvals</span>
        </div>
        <ul class="mt-1 text-slate-500">
          <li v-for="a in pr.approvals" :key="a.id">{{ a.decision }} — {{ a.approvedById.slice(0, 8) }}…</li>
        </ul>
        <div v-if="pr.status === 'PENDING' && canApprovePayment" class="mt-2 flex items-center gap-1">
          <input v-model="notesByRequest[pr.id]" placeholder="Notes" class="w-40 rounded border border-slate-300 px-1 py-0.5" />
          <button class="rounded border border-emerald-300 px-2 py-0.5 text-emerald-700 hover:bg-emerald-50" @click="store.castApproval(pr.id, 'APPROVE', notesByRequest[pr.id])">
            Approve
          </button>
          <button class="rounded border border-red-300 px-2 py-0.5 text-red-700 hover:bg-red-50" @click="store.castApproval(pr.id, 'REJECT', notesByRequest[pr.id])">
            Reject
          </button>
        </div>
        <button
          v-if="pr.status === 'APPROVED' && canExecutePayment"
          class="mt-2 rounded-md bg-slate-900 px-3 py-1.5 text-xs font-medium text-white hover:bg-slate-800"
          @click="store.executePayment(pr.id)"
        >
          Execute payment
        </button>
      </div>
    </div>

    <!-- Payments -->
    <div class="mt-6 rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
      <h2 class="text-sm font-medium text-slate-900">Executed Payments</h2>
      <table class="mt-2 w-full text-xs">
        <thead>
          <tr class="text-left text-slate-500">
            <th class="pr-2">Reference</th>
            <th class="pr-2">Amount</th>
            <th class="pr-2">Executed</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="p in store.payments" :key="p.id" class="border-t border-slate-100">
            <td class="py-1 pr-2 font-mono">{{ p.reference }}</td>
            <td class="py-1 pr-2">{{ p.amount }}</td>
            <td class="py-1 pr-2 text-slate-500">{{ new Date(p.executedAt).toLocaleString() }}</td>
            <td class="py-1">
              <div v-if="canReconcile" class="flex items-center gap-1">
                <input v-model="reconcileFormFor(p.id).externalReference" placeholder="Bank ref" class="w-28 rounded border border-slate-300 px-1 py-0.5" />
                <select v-model="reconcileFormFor(p.id).status" class="rounded border border-slate-300 px-1 py-0.5">
                  <option value="MATCHED">Matched</option>
                  <option value="DISCREPANCY">Discrepancy</option>
                </select>
                <button class="rounded border border-slate-300 px-2 py-0.5 hover:bg-white" @click="handleReconcile(p.id)">
                  Record
                </button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </section>
</template>
