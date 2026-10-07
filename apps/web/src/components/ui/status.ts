/**
 * One registry for every status the platform shows. Each entry carries a tone
 * (a semantic token, never a palette step) and a human label. Badges read from
 * here, so the same status looks the same on every page.
 */
export type Tone = 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'critical'

export interface StatusDefinition {
  label: string
  tone: Tone
}

const STATUSES: Record<string, StatusDefinition> = {
  DRAFT: { label: 'Draft', tone: 'neutral' },
  SUBMITTED: { label: 'Submitted', tone: 'info' },
  PENDING: { label: 'Pending', tone: 'warning' },
  PENDING_APPROVAL: { label: 'Awaiting approval', tone: 'warning' },
  PENDING_ACTIVATION: { label: 'Awaiting activation', tone: 'neutral' },
  UNDER_REVIEW: { label: 'Under review', tone: 'info' },
  CORRECTION_REQUIRED: { label: 'Correction required', tone: 'warning' },
  APPROVED: { label: 'Approved', tone: 'success' },
  REJECTED: { label: 'Rejected', tone: 'danger' },
  ACTIVE: { label: 'Active', tone: 'success' },
  SUSPENDED: { label: 'Suspended', tone: 'danger' },
  LOCKED: { label: 'Locked', tone: 'warning' },
  COMPLETED: { label: 'Completed', tone: 'success' },
  CLOSED: { label: 'Closed', tone: 'neutral' },
  VERIFIED: { label: 'Verified', tone: 'success' },
  PUBLISHED: { label: 'Published', tone: 'info' },
  ISSUED: { label: 'Issued', tone: 'success' },
  CANCELLED: { label: 'Cancelled', tone: 'danger' },
  EXECUTED: { label: 'Executed', tone: 'success' },
  TERMINATED: { label: 'Terminated', tone: 'danger' },
  EVALUATED: { label: 'Evaluated', tone: 'info' },
  AWARDED: { label: 'Awarded', tone: 'success' },
  LOW: { label: 'Low', tone: 'success' },
  MEDIUM: { label: 'Medium', tone: 'warning' },
  HIGH: { label: 'High', tone: 'danger' },
  CRITICAL: { label: 'Critical', tone: 'critical' },
}

export function statusFor(status: string): StatusDefinition {
  return (
    STATUSES[status] ?? {
      label: status
        .toLowerCase()
        .replace(/_/g, ' ')
        .replace(/^\w/, (c) => c.toUpperCase()),
      tone: 'neutral',
    }
  )
}

/** Tailwind classes for a tone. Uses the semantic tokens defined in style.css. */
export const TONE_CLASSES: Record<Tone, string> = {
  neutral: 'bg-slate-100 text-slate-700 ring-slate-200',
  info: 'bg-info-soft text-info ring-info/20',
  success: 'bg-success-soft text-success ring-success/20',
  warning: 'bg-warning-soft text-warning ring-warning/25',
  danger: 'bg-danger-soft text-danger ring-danger/20',
  critical: 'bg-risk-critical text-white ring-risk-critical',
}
