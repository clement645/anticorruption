import {
  LayoutDashboard,
  Wallet,
  Gavel,
  FileText,
  FolderKanban,
  ShieldAlert,
  ClipboardList,
  ShieldCheck,
  MessageSquareWarning,
  UserCog,
  Shield,
  KeyRound,
  ShieldHalf,
  type LucideIcon,
} from '@lucide/vue'

/**
 * The one place navigation is defined. The sidebar, header breadcrumbs and
 * command palette all read from here, so a route cannot appear in one and be
 * missing from another. Every entry points at a route that exists in the router.
 */
export interface NavItem {
  to: string
  label: string
  icon: LucideIcon
  permission?: string
}

export interface NavGroup {
  label: string
  items: NavItem[]
}

export const NAV_GROUPS: NavGroup[] = [
  {
    label: 'Overview',
    items: [{ to: '/', label: 'Dashboard', icon: LayoutDashboard }],
  },
  {
    label: 'Financial management',
    items: [
      { to: '/budgets', label: 'Budgets', icon: Wallet, permission: 'budget:read' },
      { to: '/contracts', label: 'Contracts & payments', icon: FileText, permission: 'contract:read' },
    ],
  },
  {
    label: 'Procurement & delivery',
    items: [
      { to: '/procurement', label: 'Procurement', icon: Gavel, permission: 'procurement:read' },
      { to: '/projects', label: 'Projects', icon: FolderKanban, permission: 'project:read' },
    ],
  },
  {
    label: 'Oversight',
    items: [
      { to: '/risk-alerts', label: 'Risk alerts', icon: ShieldAlert, permission: 'risk:read' },
      { to: '/audit', label: 'Audit trail', icon: ClipboardList, permission: 'audit:read' },
      { to: '/auditor-portal', label: 'Auditor portal', icon: ShieldCheck, permission: 'audit:read' },
      {
        to: '/whistleblower-investigations',
        label: 'Whistleblower cases',
        icon: MessageSquareWarning,
        permission: 'whistleblower:read',
      },
    ],
  },
  {
    label: 'Administration',
    items: [
      { to: '/admin/users', label: 'Users', icon: UserCog, permission: 'users:read' },
      { to: '/admin/roles', label: 'Roles & permissions', icon: Shield, permission: 'roles:read' },
    ],
  },
]

/** Account pages reachable from the user menu and the command palette. */
export const ACCOUNT_ITEMS: NavItem[] = [
  { to: '/settings/security', label: 'Security', icon: ShieldHalf },
  { to: '/settings/signing-key', label: 'Signing key', icon: KeyRound },
]

/** Titles for pages that are not in the sidebar, used by breadcrumbs. */
const EXTRA_TITLES: Record<string, string> = {
  '/settings/security': 'Security',
  '/settings/signing-key': 'Signing key',
  '/suppliers': 'Suppliers',
  '/transparency': 'Transparency portal',
  '/report-a-concern': 'Report a concern',
  '/login': 'Sign in',
}

export function allNavItems(): NavItem[] {
  return NAV_GROUPS.flatMap((g) => g.items)
}

export function titleFor(path: string): string | null {
  const item = allNavItems().find((i) => i.to === path)
  if (item) return item.label
  return EXTRA_TITLES[path] ?? null
}

export interface Crumb {
  label: string
  to: string | null
}

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

/**
 * Breadcrumb trail for a path. The owning section (e.g. Administration) appears
 * as a non-link crumb so the user can see where they are, without inventing a
 * section page that does not exist.
 */
export function breadcrumbsFor(path: string): Crumb[] {
  if (path === '/') return []

  const crumbs: Crumb[] = []
  const owner = NAV_GROUPS.find((g) => g.items.some((i) => i.to === path))
  if (owner && owner.label !== 'Overview') {
    crumbs.push({ label: owner.label, to: null })
  }

  const segments = path.split('/').filter(Boolean)
  let prefix = ''
  for (const segment of segments) {
    prefix += `/${segment}`
    const known = titleFor(prefix)
    if (known) {
      crumbs.push({ label: known, to: prefix })
    } else if (UUID.test(segment)) {
      crumbs.push({ label: 'Details', to: null })
    }
  }
  return crumbs
}
