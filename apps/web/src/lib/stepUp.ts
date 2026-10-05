/**
 * Shared step-up MFA challenge (post-launch item 5 / Phase 1 roadmap). A
 * view that is about to call a @RequireStepUp() route awaits
 * `requestStepUpToken()`; the StepUpChallengeModal mounted once in the app
 * shell collects a fresh TOTP code and resolves that promise with the
 * short-lived X-Step-Up-Token. Nothing calls this yet — Phase 5 wires it
 * into payment execution.
 */
import { reactive } from 'vue'
import { apiPost } from '../api/client'

interface StepUpResponse {
  stepUpToken: string
  expiresIn: number
}

interface PendingChallenge {
  resolve: (token: string) => void
  reject: (error: Error) => void
}

export const stepUpState = reactive({
  open: false,
  busy: false,
  error: '',
})

let pending: PendingChallenge | null = null

export function requestStepUpToken(): Promise<string> {
  if (pending) {
    return Promise.reject(new Error('A step-up challenge is already open'))
  }
  stepUpState.open = true
  stepUpState.error = ''
  return new Promise<string>((resolve, reject) => {
    pending = { resolve, reject }
  })
}

export async function submitStepUpCode(code: string): Promise<void> {
  if (!pending || stepUpState.busy) return
  stepUpState.busy = true
  stepUpState.error = ''
  try {
    const response = await apiPost<StepUpResponse>('/auth/step-up', { code })
    const challenge = pending
    pending = null
    stepUpState.open = false
    challenge?.resolve(response.stepUpToken)
  } catch (error) {
    stepUpState.error = error instanceof Error ? error.message : 'Verification failed. Try again.'
  } finally {
    stepUpState.busy = false
  }
}

export function cancelStepUp(): void {
  if (!pending) return
  const challenge = pending
  pending = null
  stepUpState.open = false
  stepUpState.error = ''
  challenge.reject(new Error('Step-up verification was cancelled'))
}
