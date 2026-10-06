// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { mount, flushPromises } from '@vue/test-utils'
import { createPinia, setActivePinia } from 'pinia'

const apiPost = vi.fn()
vi.mock('../api/client', () => {
  class ApiError extends Error {
    statusCode: number
    constructor(message: string, statusCode: number) {
      super(message)
      this.statusCode = statusCode
    }
  }
  return {
    ApiError,
    apiGet: vi.fn(),
    apiPatch: vi.fn(),
    apiDelete: vi.fn(),
    apiPost: (...args: unknown[]) => apiPost(...args),
  }
})

import UserCreateWizard from './UserCreateWizard.vue'
import { useAdminStore } from '../stores/admin'

function mountWizard() {
  const pinia = createPinia()
  setActivePinia(pinia)
  const admin = useAdminStore()
  admin.organizations = [
    {
      id: 'org-1',
      name: 'Ministry of Finance',
      code: 'MOF-DEMO',
      departments: [{ id: 'dep-1', name: 'National Treasury', code: 'TREASURY' }],
    },
  ]
  admin.roles = [
    { id: 'role-1', name: 'Auditor' },
    { id: 'role-2', name: 'Finance Officer' },
  ]
  const wrapper = mount(UserCreateWizard, {
    global: { plugins: [pinia], stubs: { RouterLink: true } },
  })
  return { wrapper, admin }
}

async function next(wrapper: ReturnType<typeof mountWizard>['wrapper']) {
  await wrapper.find('form').trigger('submit')
  await flushPromises()
}

describe('UserCreateWizard', () => {
  beforeEach(() => {
    apiPost.mockReset()
  })

  it('will not leave the identity step without a valid name and email', async () => {
    const { wrapper } = mountWizard()
    await next(wrapper)
    expect(wrapper.text()).toContain('Enter the first and last name.')

    await wrapper.find('#uw-first').setValue('Ada')
    await wrapper.find('#uw-last').setValue('Lovelace')
    await wrapper.find('#uw-email').setValue('not-an-email')
    await next(wrapper)
    expect(wrapper.text()).toContain('Enter a valid email address.')
    expect(wrapper.find('#uw-email').exists()).toBe(true)
  })

  it('requires at least one role before the security step', async () => {
    const { wrapper } = mountWizard()
    await wrapper.find('#uw-first').setValue('Ada')
    await wrapper.find('#uw-last').setValue('Lovelace')
    await wrapper.find('#uw-email').setValue('ada@example.gov')
    await next(wrapper) // identity -> organization
    await next(wrapper) // organization -> department
    await next(wrapper) // department -> role
    await next(wrapper) // role: nothing selected
    expect(wrapper.text()).toContain('Select at least one role')
  })

  it('creates the account with the chosen organization, department, roles and password', async () => {
    apiPost.mockResolvedValue({
      id: 'user-9',
      email: 'ada@example.gov',
      firstName: 'Ada',
      lastName: 'Lovelace',
      status: 'ACTIVE',
      roles: [{ id: 'role-2', name: 'Finance Officer' }],
    })
    const { wrapper } = mountWizard()

    await wrapper.find('#uw-first').setValue('Ada')
    await wrapper.find('#uw-last').setValue('Lovelace')
    await wrapper.find('#uw-email').setValue('ada@example.gov')
    await next(wrapper)

    await wrapper.find('input[name="org"]').setValue()
    await next(wrapper)

    await wrapper.find('input[name="dep"]').setValue()
    await next(wrapper)

    const roleBoxes = wrapper.findAll('input[type="checkbox"]')
    await roleBoxes[1].setValue(true)
    await next(wrapper)

    const password = (wrapper.find('input[aria-label="Temporary password"]').element as HTMLInputElement).value
    expect(password.length).toBeGreaterThanOrEqual(12)
    await next(wrapper)

    expect(wrapper.text()).toContain('Ministry of Finance')
    expect(wrapper.text()).toContain('National Treasury')
    expect(wrapper.text()).toContain('Finance Officer')

    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(apiPost).toHaveBeenCalledWith('/users', {
      email: 'ada@example.gov',
      firstName: 'Ada',
      lastName: 'Lovelace',
      temporaryPassword: password,
      roleIds: ['role-2'],
      organizationId: 'org-1',
      departmentId: 'dep-1',
    })
    expect(wrapper.text()).toContain('Account created successfully.')
    expect(wrapper.emitted('created')).toBeTruthy()
  })

  it('explains a duplicate email instead of showing a raw error', async () => {
    const { ApiError } = await import('../api/client')
    apiPost.mockRejectedValue(new ApiError('conflict', 409))
    const { wrapper } = mountWizard()

    await wrapper.find('#uw-first').setValue('Ada')
    await wrapper.find('#uw-last').setValue('Lovelace')
    await wrapper.find('#uw-email').setValue('dup@example.gov')
    await next(wrapper)
    await next(wrapper)
    await next(wrapper)
    await wrapper.findAll('input[type="checkbox"]')[0].setValue(true)
    await next(wrapper)
    await next(wrapper)
    await wrapper.find('form').trigger('submit')
    await flushPromises()

    expect(wrapper.text()).toContain('A user with this email already exists')
  })
})
