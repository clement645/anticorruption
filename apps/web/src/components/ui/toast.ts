import { reactive } from 'vue'

export type ToastTone = 'success' | 'error' | 'info'

export interface Toast {
  id: number
  tone: ToastTone
  message: string
}

const DISMISS_AFTER_MS = 4000
let nextId = 1
export const toasts = reactive<Toast[]>([])

/** Short confirmations that do not need the user to act. Errors stay until dismissed. */
export function notify(message: string, tone: ToastTone = 'success') {
  const id = nextId++
  toasts.push({ id, tone, message })
  if (tone !== 'error') {
    setTimeout(() => dismiss(id), DISMISS_AFTER_MS)
  }
  return id
}

export function dismiss(id: number) {
  const index = toasts.findIndex((t) => t.id === id)
  if (index !== -1) toasts.splice(index, 1)
}
