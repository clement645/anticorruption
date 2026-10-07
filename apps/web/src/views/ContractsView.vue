<script setup lang="ts">
import { computed, onMounted, reactive, ref, type Ref } from 'vue'
import { ChevronLeft, ChevronRight } from '@lucide/vue'
import { useAuthStore } from '../stores/auth'
import {
  useContractsStore,
  type Contract,
  type PurchaseOrder,
  type Invoice,
  type PaymentRequest,
} from '../stores/contracts'
import { ApiError } from '../api/client'
import { money } from '../lib/money'
import PageHeader from '../components/ui/PageHeader.vue'
import StatusBadge from '../components/ui/StatusBadge.vue'
import AlertBanner from '../components/ui/AlertBanner.vue'
import EmptyState from '../components/ui/EmptyState.vue'
import SkeletonRows from '../components/ui/SkeletonRows.vue'
import ConfirmDialog from '../components/ui/ConfirmDialog.vue'
import { notify } from '../components/ui/toast'

const PAGE_SIZE = 25
/**
 * One page-number ref + its own "Showing X–Y of Z" numbers — each of the
 * five lists below paginates independently. Wrapped in reactive() so its
 * computed properties read as plain numbers in both script and template,
 * rather than needing `.value` on a ref nested inside a plain object.
 */
function pager(total: () => number, page: Ref<number>) {
  return reactive({
    totalPages: computed(() => Math.max(1, Math.ceil(total() / PAGE_SIZE))),
    rangeStart: computed(() => (total() === 0 ? 0 : page.value * PAGE_SIZE + 1)),
    rangeEnd: computed(() => Math.min(total(), (page.value + 1) * PAGE_SIZE)),
  })
}

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

const contractsPage = ref(0)
const poPage = ref(0)
const invoicesPage = ref(0)
const paymentRequestsPage = ref(0)
const paymentsPage = ref(0)
const contractsPager = pager(() => store.contractsTotal, contractsPage)
const poPager = pager(() => store.purchaseOrdersTotal, poPage)
const invoicesPager = pager(() => store.invoicesTotal, invoicesPage)
const paymentRequestsPager = pager(() => store.paymentRequestsTotal, paymentRequestsPage)
const paymentsPager = pager(() => store.paymentsTotal, paymentsPage)

function goToContractsPage(p: number) {
  contractsPage.value = p
  void store.fetchContracts({ skip: p * PAGE_SIZE, take: PAGE_SIZE })
}
function goToPoPage(p: number) {
  poPage.value = p
  void store.fetchPurchaseOrders({ skip: p * PAGE_SIZE, take: PAGE_SIZE })
}
function goToInvoicesPage(p: number) {
  invoicesPage.value = p
  void store.fetchInvoices({ skip: p * PAGE_SIZE, take: PAGE_SIZE })
}
function goToPaymentRequestsPage(p: number) {
  paymentRequestsPage.value = p
  void store.fetchPaymentRequests({ skip: p * PAGE_SIZE, take: PAGE_SIZE })
}
function goToPaymentsPage(p: number) {
  paymentsPage.value = p
  void store.fetchPayments({ skip: p * PAGE_SIZE, take: PAGE_SIZE })
}

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

type PendingContractAction =
  | { kind: 'terminateContract'; contract: Contract }
  | { kind: 'cancelPO'; po: PurchaseOrder }
  | { kind: 'verifyInvoice' | 'rejectInvoice'; invoice: Invoice }
  | { kind: 'approvePayment' | 'rejectPayment'; request: PaymentRequest }
  | { kind: 'executePayment'; request: PaymentRequest }
  | null
const pendingAction = ref<PendingContractAction>(null)
const actionBusy = ref(false)

function askTerminateContract(contract: Contract) {
  pendingAction.value = { kind: 'terminateContract', contract }
}
function askCancelPO(po: PurchaseOrder) {
  pendingAction.value = { kind: 'cancelPO', po }
}
function askVerifyInvoice(invoice: Invoice) {
  pendingAction.value = { kind: 'verifyInvoice', invoice }
}
function askRejectInvoice(invoice: Invoice) {
  pendingAction.value = { kind: 'rejectInvoice', invoice }
}
function askApprovePayment(request: PaymentRequest) {
  pendingAction.value = { kind: 'approvePayment', request }
}
function askRejectPayment(request: PaymentRequest) {
  pendingAction.value = { kind: 'rejectPayment', request }
}
function askExecutePayment(request: PaymentRequest) {
  pendingAction.value = { kind: 'executePayment', request }
}

const confirmTitle = computed(() => {
  switch (pendingAction.value?.kind) {
    case 'terminateContract':
      return 'Terminate this contract?'
    case 'cancelPO':
      return 'Cancel this purchase order?'
    case 'verifyInvoice':
      return 'Verify this invoice?'
    case 'rejectInvoice':
      return 'Reject this invoice?'
    case 'approvePayment':
      return 'Approve this payment?'
    case 'rejectPayment':
      return 'Reject this payment?'
    case 'executePayment':
      return 'Execute this payment?'
    default:
      return ''
  }
})
const confirmMessage = computed(() => {
  const a = pendingAction.value
  if (!a) return ''
  if (a.kind === 'terminateContract') return `${a.contract.contractNumber} — ${a.contract.title}. This cannot be undone.`
  if (a.kind === 'cancelPO') return `${a.po.poNumber} — ${money(a.po.amount)}. This cannot be undone.`
  if (a.kind === 'verifyInvoice') return `${a.invoice.invoiceNumber} — ${money(a.invoice.amount)}.`
  if (a.kind === 'rejectInvoice') return `${a.invoice.invoiceNumber} — ${money(a.invoice.amount)}.`
  if (a.kind === 'approvePayment') {
    return `${money(a.request.amount)}. Your decision is recorded against your identity and cannot be changed afterwards.`
  }
  if (a.kind === 'rejectPayment') {
    return `${money(a.request.amount)}. Your decision is recorded against your identity and cannot be changed afterwards.`
  }
  if (a.kind === 'executePayment') {
    return `${money(a.request.amount)} will be disbursed. This cannot be reversed from this screen. You will be asked for a fresh authenticator code.`
  }
  return ''
})
const confirmTone = computed(() =>
  pendingAction.value &&
  ['terminateContract', 'cancelPO', 'rejectInvoice', 'rejectPayment', 'executePayment'].includes(pendingAction.value.kind)
    ? 'danger'
    : 'default',
)
const confirmLabel = computed(() => {
  switch (pendingAction.value?.kind) {
    case 'terminateContract':
      return 'Terminate'
    case 'cancelPO':
      return 'Cancel PO'
    case 'verifyInvoice':
      return 'Verify'
    case 'rejectInvoice':
    case 'rejectPayment':
      return 'Reject'
    case 'approvePayment':
      return 'Approve'
    case 'executePayment':
      return 'Execute payment'
    default:
      return 'Confirm'
  }
})

const pendingPaymentNotesFor = computed<PaymentRequest | null>(() => {
  const a = pendingAction.value
  return a && (a.kind === 'approvePayment' || a.kind === 'rejectPayment') ? a.request : null
})

function describeError(err: unknown, fallback: string): string {
  return err instanceof ApiError ? err.message : fallback
}

async function confirmAction() {
  const a = pendingAction.value
  if (!a) return
  actionBusy.value = true
  store.error = null
  try {
    if (a.kind === 'terminateContract') {
      await store.terminateContract(a.contract.id)
      notify(`${a.contract.contractNumber} terminated.`)
    } else if (a.kind === 'cancelPO') {
      await store.cancelPurchaseOrder(a.po.id)
      notify(`${a.po.poNumber} cancelled.`)
    } else if (a.kind === 'verifyInvoice') {
      await store.verifyInvoice(a.invoice.id)
      notify(`${a.invoice.invoiceNumber} verified.`)
    } else if (a.kind === 'rejectInvoice') {
      await store.rejectInvoice(a.invoice.id, rejectReasonByInvoice[a.invoice.id] || 'Rejected')
      delete rejectReasonByInvoice[a.invoice.id]
      notify(`${a.invoice.invoiceNumber} rejected.`)
    } else if (a.kind === 'approvePayment') {
      await store.castApproval(a.request.id, 'APPROVE', notesByRequest[a.request.id])
      if (!store.error) notify('Approval recorded.')
    } else if (a.kind === 'rejectPayment') {
      await store.castApproval(a.request.id, 'REJECT', notesByRequest[a.request.id])
      if (!store.error) notify('Rejection recorded.')
    } else if (a.kind === 'executePayment') {
      await store.executePayment(a.request.id)
      if (!store.error) notify('Payment executed.')
    }
    if (!store.error) pendingAction.value = null
  } catch (err) {
    // Backing out of the step-up challenge closes the dialog quietly — it is
    // not a failure, just a change of mind.
    if (err instanceof Error && err.message.includes('cancelled')) {
      pendingAction.value = null
    } else {
      store.error = describeError(err, 'That action did not complete. Nothing was changed.')
    }
  } finally {
    actionBusy.value = false
  }
}

function reconcileFormFor(paymentId: string) {
  reconcileForm[paymentId] ??= { externalReference: '', status: 'MATCHED' }
  return reconcileForm[paymentId]
}

async function handleReconcile(paymentId: string) {
  const form = reconcileFormFor(paymentId)
  store.error = null
  await store.recordReconciliation(paymentId, form.externalReference, form.status)
  if (!store.error) {
    notify('Reconciliation recorded.')
    delete reconcileForm[paymentId]
  }
}

/** The approver who already voted on this request, if the current user is one. */
function myApproval(pr: PaymentRequest) {
  return pr.approvals.find((a) => a.approvedById === auth.user?.sub) ?? null
}

/**
 * The backend refuses an approval from whoever verified the underlying
 * invoice (no one self-certifies a payment they already vouched for) — the
 * form is hidden here too rather than letting the user submit into a
 * guaranteed 403.
 */
function verifiedInvoiceMyself(pr: PaymentRequest): boolean {
  const invoice = store.invoices.find((i) => i.id === pr.invoiceId)
  return !!invoice && invoice.verifiedById === auth.user?.sub
}
</script>

<template>
  <section class="mx-auto max-w-5xl px-4 py-10">
    <PageHeader title="Contracts, invoices &amp; payments" subtitle="Award → Contract → Purchase Order → Invoice → multi-signature Payment approval → execution." />

    <AlertBanner v-if="store.error" class="mt-4">{{ store.error }}</AlertBanner>

    <!-- Contracts -->
    <div class="mt-6 card p-6">
      <h2 class="section-title">Contracts</h2>
      <div class="overflow-x-auto">
      <table class="mt-2 w-full text-xs">
        <thead>
          <tr class="text-left text-slate-500">
            <th class="pr-2">Number</th>
            <th class="pr-2">Title</th>
            <th class="pr-2">Value</th>
            <th class="pr-2">Status</th>
            <th><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="store.contractsLoading">
            <td colspan="5" class="p-0"><SkeletonRows :rows="3" :columns="5" /></td>
          </tr>
          <tr v-else-if="store.contracts.length === 0">
            <td colspan="5" class="p-0"><EmptyState title="No contracts yet" /></td>
          </tr>
          <tr v-for="c in store.contracts" :key="c.id" class="border-t border-slate-100">
            <td class="py-1 pr-2">{{ c.contractNumber }}</td>
            <td class="py-1 pr-2">{{ c.title }}</td>
            <td class="num py-1 pr-2">{{ money(c.value) }}</td>
            <td class="py-1 pr-2">
              <StatusBadge :status="c.status" />
            </td>
            <td class="py-1">
              <template v-if="canManageContracts">
                <button v-if="c.status === 'DRAFT'" class="btn btn-ghost btn-sm text-emerald-700" @click="store.activateContract(c.id)">
                  Activate
                </button>
                <button v-if="c.status === 'ACTIVE'" class="btn btn-ghost btn-sm" @click="store.completeContract(c.id)">
                  Complete
                </button>
                <button
                  v-if="c.status === 'DRAFT' || c.status === 'ACTIVE'"
                  class="btn btn-ghost btn-sm text-red-700"
                  @click="askTerminateContract(c)"
                >
                  Terminate
                </button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
      </div>
      <div v-if="store.contractsTotal > 0" class="mt-2 flex items-center justify-between text-xs text-slate-500">
        <span>Showing {{ contractsPager.rangeStart }}–{{ contractsPager.rangeEnd }} of {{ store.contractsTotal }}</span>
        <div class="flex gap-2">
          <button type="button" class="btn btn-ghost btn-sm" :disabled="contractsPage === 0" @click="goToContractsPage(contractsPage - 1)">
            <ChevronLeft class="h-3.5 w-3.5" /> Previous
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            :disabled="contractsPage >= contractsPager.totalPages - 1"
            @click="goToContractsPage(contractsPage + 1)"
          >
            Next <ChevronRight class="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <form v-if="canManageContracts" class="mt-3 flex flex-wrap items-end gap-2" @submit.prevent="handleCreateContract">
        <input v-model="contractForm.awardId" required placeholder="Award ID" class="input w-64" />
        <input v-model="contractForm.contractNumber" required placeholder="Contract number" class="input" />
        <input v-model="contractForm.title" required placeholder="Title" class="input" />
        <input v-model.number="contractForm.value" type="number" min="1" required placeholder="Value" class="input w-28" />
        <input v-model="contractForm.startDate" type="date" required aria-label="Start date" class="input" />
        <input v-model="contractForm.endDate" type="date" required aria-label="End date" class="input" />
        <button type="submit" class="btn btn-primary btn-sm">Create contract</button>
      </form>
      <p class="mt-1 text-[11px] text-slate-500">
        Budget line, supplier, and organization are derived server-side from the award — not entered here.
      </p>
    </div>

    <!-- Purchase Orders -->
    <div class="mt-6 card p-6">
      <h2 class="section-title">Purchase Orders</h2>
      <div class="overflow-x-auto">
      <table class="mt-2 w-full text-xs">
        <thead>
          <tr class="text-left text-slate-500">
            <th class="pr-2">PO Number</th>
            <th class="pr-2">Description</th>
            <th class="pr-2">Amount</th>
            <th class="pr-2">Status</th>
            <th><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="store.purchaseOrdersLoading">
            <td colspan="5" class="p-0"><SkeletonRows :rows="3" :columns="5" /></td>
          </tr>
          <tr v-else-if="store.purchaseOrders.length === 0">
            <td colspan="5" class="p-0"><EmptyState title="No purchase orders yet" /></td>
          </tr>
          <tr v-for="po in store.purchaseOrders" :key="po.id" class="border-t border-slate-100">
            <td class="py-1 pr-2">{{ po.poNumber }}</td>
            <td class="py-1 pr-2">{{ po.description }}</td>
            <td class="num py-1 pr-2">{{ money(po.amount) }}</td>
            <td class="py-1 pr-2">
              <StatusBadge :status="po.status" />
            </td>
            <td class="py-1">
              <template v-if="canManageContracts">
                <button v-if="po.status === 'DRAFT'" class="btn btn-ghost btn-sm text-emerald-700" @click="store.issuePurchaseOrder(po.id)">
                  Issue
                </button>
                <button v-if="po.status === 'DRAFT' || po.status === 'ISSUED'" class="btn btn-ghost btn-sm text-red-700" @click="askCancelPO(po)">
                  Cancel
                </button>
              </template>
            </td>
          </tr>
        </tbody>
      </table>
      </div>
      <div v-if="store.purchaseOrdersTotal > 0" class="mt-2 flex items-center justify-between text-xs text-slate-500">
        <span>Showing {{ poPager.rangeStart }}–{{ poPager.rangeEnd }} of {{ store.purchaseOrdersTotal }}</span>
        <div class="flex gap-2">
          <button type="button" class="btn btn-ghost btn-sm" :disabled="poPage === 0" @click="goToPoPage(poPage - 1)">
            <ChevronLeft class="h-3.5 w-3.5" /> Previous
          </button>
          <button type="button" class="btn btn-ghost btn-sm" :disabled="poPage >= poPager.totalPages - 1" @click="goToPoPage(poPage + 1)">
            Next <ChevronRight class="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <form v-if="canManageContracts" class="mt-3 flex flex-wrap items-end gap-2" @submit.prevent="handleCreatePO">
        <input v-model="poForm.contractId" required placeholder="Active contract ID" class="input w-64" />
        <input v-model="poForm.poNumber" required placeholder="PO number" class="input" />
        <input v-model="poForm.description" required placeholder="Description" class="input" />
        <input v-model.number="poForm.amount" type="number" min="1" required placeholder="Amount" class="input w-28" />
        <button type="submit" class="btn btn-primary btn-sm">Create PO</button>
      </form>
      <p v-if="canManageContracts" class="mt-1 text-[11px] text-slate-500">
        Enter the ID of an ACTIVE contract — the list above may not show every active contract once there are more than
        {{ PAGE_SIZE }}.
      </p>
    </div>

    <!-- Invoices -->
    <div class="mt-6 card p-6">
      <h2 class="section-title">Invoices</h2>
      <div class="overflow-x-auto">
      <table class="mt-2 w-full text-xs">
        <thead>
          <tr class="text-left text-slate-500">
            <th class="pr-2">Invoice #</th>
            <th class="pr-2">Amount</th>
            <th class="pr-2">Status</th>
            <th><span class="sr-only">Actions</span></th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="store.invoicesLoading">
            <td colspan="4" class="p-0"><SkeletonRows :rows="3" :columns="4" /></td>
          </tr>
          <tr v-else-if="store.invoices.length === 0">
            <td colspan="4" class="p-0"><EmptyState title="No invoices yet" /></td>
          </tr>
          <tr v-for="inv in store.invoices" :key="inv.id" class="border-t border-slate-100">
            <td class="py-1 pr-2">{{ inv.invoiceNumber }}</td>
            <td class="num py-1 pr-2">{{ money(inv.amount) }}</td>
            <td class="py-1 pr-2">
              <StatusBadge :status="inv.status" />
            </td>
            <td class="py-1">
              <div v-if="inv.status === 'SUBMITTED' && canVerifyInvoice" class="flex items-center gap-1">
                <button class="btn btn-ghost btn-sm text-emerald-700" @click="askVerifyInvoice(inv)">Verify</button>
                <input v-model="rejectReasonByInvoice[inv.id]" placeholder="Reason" class="input w-28 px-1.5 py-1 text-xs" />
                <button class="btn btn-ghost btn-sm text-red-700" @click="askRejectInvoice(inv)">Reject</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      </div>
      <div v-if="store.invoicesTotal > 0" class="mt-2 flex items-center justify-between text-xs text-slate-500">
        <span>Showing {{ invoicesPager.rangeStart }}–{{ invoicesPager.rangeEnd }} of {{ store.invoicesTotal }}</span>
        <div class="flex gap-2">
          <button type="button" class="btn btn-ghost btn-sm" :disabled="invoicesPage === 0" @click="goToInvoicesPage(invoicesPage - 1)">
            <ChevronLeft class="h-3.5 w-3.5" /> Previous
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            :disabled="invoicesPage >= invoicesPager.totalPages - 1"
            @click="goToInvoicesPage(invoicesPage + 1)"
          >
            Next <ChevronRight class="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
      <form v-if="canSubmitInvoice" class="mt-3 flex flex-wrap items-end gap-2" @submit.prevent="handleCreateInvoice">
        <input v-model="invoiceForm.purchaseOrderId" required placeholder="Issued PO ID" class="input w-64" />
        <input v-model="invoiceForm.invoiceNumber" required placeholder="Invoice number" class="input" />
        <input v-model="invoiceForm.description" required placeholder="Line description" class="input" />
        <input v-model.number="invoiceForm.quantity" type="number" min="1" required placeholder="Qty" class="input w-16" />
        <input v-model.number="invoiceForm.unitPrice" type="number" min="1" required placeholder="Unit price" class="input w-24" />
        <button type="submit" class="btn btn-primary btn-sm">Submit invoice</button>
      </form>
      <p v-if="canSubmitInvoice" class="mt-1 text-[11px] text-slate-500">
        Enter the ID of an ISSUED purchase order — the list above may not show every issued PO once there are more than
        {{ PAGE_SIZE }}.
      </p>
    </div>

    <!-- Payment Requests -->
    <div class="mt-6 card p-6">
      <h2 class="section-title">Payment requests</h2>
      <p class="mt-1 text-[11px] text-slate-500">
        Multi-signature approval — each request needs decisions from distinct approvers, none of whom verified the invoice themselves.
      </p>

      <SkeletonRows v-if="store.paymentRequestsLoading" :rows="2" :columns="2" class="mt-3" />
      <EmptyState v-else-if="store.paymentRequests.length === 0" class="mt-3" title="No payment requests yet" />

      <div v-for="pr in store.paymentRequests" :key="pr.id" class="mt-3 rounded-lg border border-slate-100 p-3 text-xs">
        <div class="flex items-center justify-between gap-2">
          <span class="num text-sm font-semibold text-slate-900">{{ money(pr.amount) }}</span>
          <StatusBadge :status="pr.status" />
        </div>
        <div class="mt-1 flex items-center justify-between text-slate-500">
          <span>Requested {{ new Date(pr.createdAt).toLocaleDateString() }}</span>
          <span>{{ pr.approvals.length }}/{{ pr.requiredApprovals }} approvals</span>
        </div>

        <ul v-if="pr.approvals.length" class="mt-2 space-y-1">
          <li v-for="a in pr.approvals" :key="a.id" class="flex items-center gap-2 text-slate-500">
            <StatusBadge :status="a.decision" />
            <span>{{ a.approvedById === auth.user?.sub ? 'You' : `${a.approvedById.slice(0, 8)}…` }}</span>
            <span class="text-slate-500">— {{ new Date(a.createdAt).toLocaleDateString() }}</span>
            <span v-if="a.notes" class="text-slate-500">“{{ a.notes }}”</span>
          </li>
        </ul>

        <template v-if="pr.status === 'PENDING' && canApprovePayment">
          <p v-if="myApproval(pr)" class="mt-2 text-slate-500">
            You already recorded your decision on this request.
          </p>
          <p v-else-if="verifiedInvoiceMyself(pr)" class="mt-2 text-slate-500">
            You verified this invoice — a different approver must decide on its payment.
          </p>
          <div v-else class="mt-2 flex items-center gap-1">
            <input v-model="notesByRequest[pr.id]" placeholder="Notes" class="input w-40 px-1.5 py-1 text-xs" />
            <button class="btn btn-secondary btn-sm text-emerald-700" @click="askApprovePayment(pr)">
              Approve
            </button>
            <button class="btn btn-secondary btn-sm text-red-700" @click="askRejectPayment(pr)">
              Reject
            </button>
          </div>
        </template>
        <button
          v-if="pr.status === 'APPROVED' && canExecutePayment"
          class="btn btn-primary btn-sm mt-2"
          @click="askExecutePayment(pr)"
        >
          Execute payment
        </button>
      </div>
      <div v-if="store.paymentRequestsTotal > 0" class="mt-3 flex items-center justify-between text-xs text-slate-500">
        <span>Showing {{ paymentRequestsPager.rangeStart }}–{{ paymentRequestsPager.rangeEnd }} of {{ store.paymentRequestsTotal }}</span>
        <div class="flex gap-2">
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            :disabled="paymentRequestsPage === 0"
            @click="goToPaymentRequestsPage(paymentRequestsPage - 1)"
          >
            <ChevronLeft class="h-3.5 w-3.5" /> Previous
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            :disabled="paymentRequestsPage >= paymentRequestsPager.totalPages - 1"
            @click="goToPaymentRequestsPage(paymentRequestsPage + 1)"
          >
            Next <ChevronRight class="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
    </div>

    <!-- Payments -->
    <div class="mt-6 table-shell">
      <h2 class="section-title px-4 pt-4">Executed payments</h2>
      <table class="table-base">
        <thead>
          <tr>
            <th>Reference</th>
            <th>Amount</th>
            <th>Executed</th>
            <th>Reconciliation</th>
          </tr>
        </thead>
        <tbody>
          <tr v-if="store.paymentsLoading">
            <td colspan="4" class="p-0"><SkeletonRows :rows="2" :columns="4" /></td>
          </tr>
          <tr v-else-if="store.payments.length === 0">
            <td colspan="4" class="p-0"><EmptyState title="No payments executed yet" /></td>
          </tr>
          <tr v-for="p in store.payments" :key="p.id">
            <td class="font-mono text-slate-500">{{ p.reference }}</td>
            <td class="num font-medium text-slate-900">{{ money(p.amount) }}</td>
            <td class="text-slate-500">{{ new Date(p.executedAt).toLocaleString() }}</td>
            <td>
              <div v-if="canReconcile" class="flex items-center gap-1">
                <input
                  v-model="reconcileFormFor(p.id).externalReference"
                  placeholder="Bank ref"
                  aria-label="Bank reference"
                  class="input w-28 px-1.5 py-1 text-xs"
                />
                <select v-model="reconcileFormFor(p.id).status" aria-label="Reconciliation status" class="select w-auto px-1.5 py-1 text-xs">
                  <option value="MATCHED">Matched</option>
                  <option value="DISCREPANCY">Discrepancy</option>
                </select>
                <button class="btn btn-secondary btn-sm" @click="handleReconcile(p.id)">Record</button>
              </div>
            </td>
          </tr>
        </tbody>
      </table>
      <div v-if="store.paymentsTotal > 0" class="flex items-center justify-between border-t border-slate-100 px-4 py-3 text-xs text-slate-500">
        <span>Showing {{ paymentsPager.rangeStart }}–{{ paymentsPager.rangeEnd }} of {{ store.paymentsTotal }}</span>
        <div class="flex gap-2">
          <button type="button" class="btn btn-ghost btn-sm" :disabled="paymentsPage === 0" @click="goToPaymentsPage(paymentsPage - 1)">
            <ChevronLeft class="h-3.5 w-3.5" /> Previous
          </button>
          <button
            type="button"
            class="btn btn-ghost btn-sm"
            :disabled="paymentsPage >= paymentsPager.totalPages - 1"
            @click="goToPaymentsPage(paymentsPage + 1)"
          >
            Next <ChevronRight class="h-3.5 w-3.5" />
          </button>
        </div>
      </div>
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
      <label v-if="pendingAction?.kind === 'rejectInvoice'" class="block">
        <span class="field-label">Reason</span>
        <input
          v-model="rejectReasonByInvoice[pendingAction.invoice.id]"
          class="input mt-1"
          placeholder="Why is this invoice being rejected?"
        />
      </label>
      <label v-else-if="pendingPaymentNotesFor" class="block">
        <span class="field-label">Notes (optional)</span>
        <input v-model="notesByRequest[pendingPaymentNotesFor.id]" class="input mt-1" placeholder="Add a note for the audit trail" />
      </label>
    </ConfirmDialog>
  </section>
</template>
