// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import StatusBadge from './StatusBadge.vue'
import ConfirmDialog from './ConfirmDialog.vue'
import { statusFor } from './status'
import { notify, dismiss, toasts } from './toast'

describe('status registry', () => {
  it('maps known statuses to a label and a semantic tone', () => {
    expect(statusFor('APPROVED')).toEqual({ label: 'Approved', tone: 'success' })
    expect(statusFor('REJECTED').tone).toBe('danger')
    expect(statusFor('CRITICAL').tone).toBe('critical')
  })

  it('still labels an unknown status readably rather than hiding it', () => {
    expect(statusFor('SOME_NEW_STATE')).toEqual({ label: 'Some new state', tone: 'neutral' })
  })

  it('maps the financial-lifecycle statuses introduced by the budget, procurement, and contracts screens', () => {
    expect(statusFor('EXECUTED').tone).toBe('success')
    expect(statusFor('TERMINATED').tone).toBe('danger')
    expect(statusFor('ISSUED').tone).toBe('success')
    expect(statusFor('CANCELLED').tone).toBe('danger')
  })

  it('maps the project, milestone, and inspection statuses introduced by the project-verification screen', () => {
    expect(statusFor('PLANNED').tone).toBe('neutral')
    expect(statusFor('IN_PROGRESS').tone).toBe('info')
    expect(statusFor('PASSED').tone).toBe('success')
    expect(statusFor('FAILED').tone).toBe('danger')
    expect(statusFor('NEEDS_REVISION').tone).toBe('warning')
  })

  it('distinguishes a payment approval decision from the payment request status it feeds into', () => {
    expect(statusFor('APPROVE')).toEqual({ label: 'Approved', tone: 'success' })
    expect(statusFor('REJECT')).toEqual({ label: 'Rejected', tone: 'danger' })
  })

  it('maps the risk-alert review statuses', () => {
    expect(statusFor('OPEN').tone).toBe('warning')
    expect(statusFor('CONFIRMED').tone).toBe('danger')
    expect(statusFor('DISMISSED').tone).toBe('neutral')
  })
})

describe('StatusBadge', () => {
  it('shows the text label, not only colour', () => {
    const wrapper = mount(StatusBadge, { props: { status: 'PENDING_APPROVAL' } })
    expect(wrapper.text()).toContain('Awaiting approval')
  })

  it('accepts a label override for context-specific wording', () => {
    const wrapper = mount(StatusBadge, { props: { status: 'ACTIVE', label: 'Enabled' } })
    expect(wrapper.text()).toContain('Enabled')
  })
})

describe('ConfirmDialog', () => {
  afterEach(() => {
    document.body.innerHTML = ''
  })

  function mountDialog(props: Partial<InstanceType<typeof ConfirmDialog>['$props']> = {}) {
    return mount(ConfirmDialog, {
      attachTo: document.body,
      props: { open: true, title: 'Delete role?', message: 'This cannot be undone.', ...props },
    })
  }

  it('is an accessible alert dialog labelled by its title', () => {
    const wrapper = mountDialog()
    const dialog = wrapper.find('[role="alertdialog"]')
    expect(dialog.exists()).toBe(true)
    expect(dialog.attributes('aria-modal')).toBe('true')
    expect(dialog.attributes('aria-labelledby')).toBe('confirm-title')
    wrapper.unmount()
  })

  it('emits confirm and cancel from the buttons', async () => {
    const wrapper = mountDialog({ confirmLabel: 'Delete' })
    const buttons = wrapper.findAll('button')
    await buttons[1].trigger('click')
    expect(wrapper.emitted('confirm')).toHaveLength(1)
    await buttons[0].trigger('click')
    expect(wrapper.emitted('cancel')).toHaveLength(1)
    wrapper.unmount()
  })

  it('closes on Escape', async () => {
    const wrapper = mountDialog()
    await wrapper.find('[role="alertdialog"]').trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('cancel')).toHaveLength(1)
    wrapper.unmount()
  })

  it('does not close while busy', async () => {
    const wrapper = mountDialog({ busy: true })
    await wrapper.find('[role="alertdialog"]').trigger('keydown', { key: 'Escape' })
    expect(wrapper.emitted('cancel')).toBeUndefined()
    wrapper.unmount()
  })

  it('moves focus to Cancel for destructive actions', async () => {
    const wrapper = mountDialog({ tone: 'danger', confirmLabel: 'Delete' })
    await flushPromises()
    expect(document.activeElement?.textContent?.trim()).toBe('Cancel')
    wrapper.unmount()
  })
})

describe('toasts', () => {
  afterEach(() => {
    toasts.splice(0, toasts.length)
    vi.useRealTimers()
  })

  it('adds a success toast that dismisses itself', () => {
    vi.useFakeTimers()
    notify('Saved')
    expect(toasts).toHaveLength(1)
    vi.advanceTimersByTime(4100)
    expect(toasts).toHaveLength(0)
  })

  it('keeps error toasts until the user dismisses them', () => {
    vi.useFakeTimers()
    const id = notify('Could not save', 'error')
    vi.advanceTimersByTime(10_000)
    expect(toasts.map((t) => t.id)).toContain(id)
    dismiss(id)
    expect(toasts).toHaveLength(0)
  })
})
