import { createRouter, createWebHistory } from 'vue-router'
import { useAuthStore } from '../stores/auth'

const router = createRouter({
  history: createWebHistory(),
  routes: [
    {
      path: '/login',
      name: 'login',
      component: () => import('../views/LoginView.vue'),
      meta: { public: true },
    },
    {
      path: '/transparency',
      name: 'transparency',
      component: () => import('../views/TransparencyView.vue'),
      meta: { public: true },
    },
    {
      path: '/report-a-concern',
      name: 'report-a-concern',
      component: () => import('../views/ReportConcernView.vue'),
      meta: { public: true },
    },
    {
      path: '/',
      name: 'dashboard',
      component: () => import('../views/DashboardView.vue'),
    },
    {
      path: '/audit',
      name: 'audit',
      component: () => import('../views/AuditView.vue'),
      meta: { requiresPermission: 'audit:read' },
    },
    {
      path: '/budgets',
      name: 'budgets',
      component: () => import('../views/BudgetsView.vue'),
      meta: { requiresPermission: 'budget:read' },
    },
    {
      path: '/procurement',
      name: 'procurement',
      component: () => import('../views/ProcurementView.vue'),
      meta: { requiresPermission: 'procurement:read' },
    },
    {
      path: '/suppliers/:id',
      name: 'supplier-detail',
      component: () => import('../views/SupplierDetailView.vue'),
      meta: { requiresPermission: 'supplier:read' },
    },
    {
      path: '/risk-alerts',
      name: 'risk-alerts',
      component: () => import('../views/RiskAlertsView.vue'),
      meta: { requiresPermission: 'risk:read' },
    },
    {
      path: '/contracts',
      name: 'contracts',
      component: () => import('../views/ContractsView.vue'),
      meta: { requiresPermission: 'contract:read' },
    },
    {
      path: '/projects',
      name: 'projects',
      component: () => import('../views/ProjectsView.vue'),
      meta: { requiresPermission: 'project:read' },
    },
    {
      path: '/auditor-portal',
      name: 'auditor-portal',
      component: () => import('../views/AuditorPortalView.vue'),
      meta: { requiresPermission: 'audit:read' },
    },
    {
      path: '/whistleblower-investigations',
      name: 'whistleblower-investigations',
      component: () => import('../views/WhistleblowerInvestigationView.vue'),
      meta: { requiresPermission: 'whistleblower:read' },
    },
  ],
})

// Backend authorization is authoritative regardless (section 28/29) — this
// guard only spares an authenticated-looking flash of a page the user can't
// use before the API rejects it.
router.beforeEach(async (to) => {
  if (to.meta.public) {
    return true
  }

  const auth = useAuthStore()
  if (auth.status === 'unknown') {
    await auth.restoreSession()
  }

  if (!auth.isAuthenticated) {
    return { name: 'login', query: { redirect: to.fullPath } }
  }

  const requiredPermission = to.meta.requiresPermission as string | undefined
  if (requiredPermission && !auth.hasPermission(requiredPermission)) {
    return { name: 'dashboard' }
  }

  return true
})

export default router
