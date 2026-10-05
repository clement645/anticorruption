import { describe, it, expect, vi, beforeEach } from 'vitest'

const apiPost = vi.fn()
vi.mock('../api/client', () => ({ apiPost: (...args: unknown[]) => apiPost(...args) }))

import { cancelStepUp, requestStepUpToken, stepUpState, submitStepUpCode } from './stepUp'

describe('step-up challenge', () => {
  beforeEach(() => {
    apiPost.mockReset()
    cancelStepUp()
  })

  it('resolves with the step-up token once a valid code is submitted', async () => {
    apiPost.mockResolvedValue({ stepUpToken: 'token-123', expiresIn: 600 })

    const pending = requestStepUpToken()
    expect(stepUpState.open).toBe(true)

    await submitStepUpCode('123456')

    await expect(pending).resolves.toBe('token-123')
    expect(apiPost).toHaveBeenCalledWith('/auth/step-up', { code: '123456' })
    expect(stepUpState.open).toBe(false)
  })

  it('keeps the challenge open with the backend error when the code is rejected', async () => {
    apiPost.mockRejectedValue(new Error('Invalid MFA code'))

    const pending = requestStepUpToken()
    await submitStepUpCode('000000')

    expect(stepUpState.open).toBe(true)
    expect(stepUpState.error).toBe('Invalid MFA code')

    cancelStepUp()
    await expect(pending).rejects.toThrow('cancelled')
  })

  it('rejects the pending request when the user cancels', async () => {
    const pending = requestStepUpToken()
    cancelStepUp()

    await expect(pending).rejects.toThrow('cancelled')
    expect(stepUpState.open).toBe(false)
  })

  it('refuses to open a second challenge while one is already pending', async () => {
    const first = requestStepUpToken()
    await expect(requestStepUpToken()).rejects.toThrow('already open')
    cancelStepUp()
    await expect(first).rejects.toThrow('cancelled')
  })
})
