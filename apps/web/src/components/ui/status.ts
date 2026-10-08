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
  BLACKLISTED: { label: 'Blacklisted', tone: 'critical' },
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
  PLANNED: { label: 'Planned', tone: 'neutral' },
  IN_PROGRESS: { label: 'In progress', tone: 'info' },
  PASSED: { label: 'Passed', tone: 'success' },
  FAILED: { label: 'Failed', tone: 'danger' },
  NEEDS_REVISION: { label: 'Needs revision', tone: 'warning' },
  // A payment approval's own decision — distinct from the PaymentRequest
  // status (APPROVED/REJECTED above): this labels one approver's vote.
  APPROVE: { label: 'Approved', tone: 'success' },
  REJECT: { label: 'Rejected', tone: 'danger' },
  // RiskAlert.status — a human review outcome, distinct from REVIEWED/
  // PENDING above (OPEN reuses no existing key; UNDER_REVIEW already does).
  OPEN: { label: 'Open', tone: 'warning' },
  CONFIRMED: { label: 'Confirmed', tone: 'danger' },
  DISMISSED: { label: 'Dismissed', tone: 'neutral' },
  // A whistleblower investigation's finding — substantiating a report is the
  // accountability system working, not a bad outcome, hence success here.
  SUBSTANTIATED: { label: 'Substantiated', tone: 'success' },
  UNSUBSTANTIATED: { label: 'Unsubstantiated', tone: 'danger' },
  // A toggleable security/feature state (MFA, etc.) — distinct wording from
  // ACTIVE/SUSPENDED above, which describe an account, not a setting.
  ENABLED: { label: 'Enabled', tone: 'success' },
  DISABLED: { label: 'Not enabled', tone: 'warning' },
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
