/**
 * Development/demo seed data. Everything created here is clearly DEMO/TEST
 * data (section 47) — no real citizen, supplier, or government personnel
 * data. Safe to re-run: every write is an idempotent upsert.
 */
import { PrismaClient } from "../generated/client/index.js";
import { hash, argon2id } from "argon2";

const prisma = new PrismaClient();

// Baseline permission set for what exists so far (IAM itself). Business-module
// permissions (budget:approve, procurement:publish_tender, ...) are added
// alongside their owning module in later phases — see DATABASE.md.
const PERMISSIONS: Array<{
  resource: string;
  action: string;
  description: string;
}> = [
  { resource: "users", action: "read", description: "View user accounts" },
  { resource: "users", action: "create", description: "Create user accounts" },
  {
    resource: "users",
    action: "update",
    description: "Update a user's roles, status, organization, or department",
  },
  {
    resource: "users",
    action: "reset_password",
    description:
      "Issue a one-time temporary password for another user (Super Administrator only by default)",
  },
  {
    resource: "users",
    action: "reset_mfa",
    description:
      "Remove another user's authenticator so they can enrol again (Super Administrator only by default)",
  },
  {
    resource: "roles",
    action: "read",
    description: "View roles and their permissions",
  },
  {
    resource: "roles",
    action: "manage",
    description:
      "Create, edit, and delete non-system roles and their permission grants (never grant a permission you don't hold)",
  },
  {
    resource: "organizations",
    action: "create",
    description: "Create organizations/departments",
  },
  {
    resource: "security_events",
    action: "read",
    description: "View the security event log",
  },
  {
    resource: "audit",
    action: "read",
    description: "View and verify the immutable audit trail",
  },
  {
    resource: "blockchain",
    action: "read",
    description: "View blockchain transactions and blocks",
  },
  {
    resource: "blockchain",
    action: "anchor",
    description: "Manually trigger an anchoring run",
  },
  {
    resource: "budget",
    action: "manage",
    description: "Create/activate/close fiscal years",
  },
  {
    resource: "budget",
    action: "read",
    description: "View budgets, allocations, commitments",
  },
  {
    resource: "budget",
    action: "create",
    description: "Create and submit budgets",
  },
  {
    resource: "budget",
    action: "approve",
    description: "Approve/reject budgets and adjustments",
  },
  {
    resource: "budget",
    action: "commit",
    description: "Create/release commitments against an allocation",
  },
  {
    resource: "budget",
    action: "spend",
    description: "Record expenditure against a commitment",
  },
  {
    resource: "budget",
    action: "adjust",
    description: "Request a budget adjustment",
  },
  {
    resource: "procurement",
    action: "manage",
    description: "Create suppliers and procurement plans",
  },
  {
    resource: "procurement",
    action: "read",
    description: "View procurement plans, requests, tenders, bids",
  },
  {
    resource: "procurement",
    action: "create",
    description: "Create procurement requests and tenders",
  },
  {
    resource: "procurement",
    action: "approve",
    description: "Approve procurement plans/requests, cancel tenders",
  },
  {
    resource: "procurement",
    action: "publish",
    description: "Publish/close tenders",
  },
  {
    resource: "procurement",
    action: "bid",
    description: "Submit a bid against a tender lot",
  },
  {
    resource: "procurement",
    action: "evaluate",
    description: "Score a submitted bid",
  },
  {
    resource: "procurement",
    action: "award",
    description: "Award a tender lot to an evaluated bid",
  },
  {
    resource: "supplier",
    action: "read",
    description: "View a supplier's basic registration profile",
  },
  {
    resource: "supplier",
    action: "read_sensitive",
    description:
      "View a supplier's beneficial owners, compliance documents, and risk profile",
  },
  {
    resource: "supplier",
    action: "manage",
    description:
      "Update a supplier profile, disclose owners, upload documents, suspend/reactivate/blacklist a supplier",
  },
  {
    resource: "supplier",
    action: "verify",
    description:
      "Verify/reject a supplier document and record a risk assessment",
  },
  {
    resource: "risk",
    action: "read",
    description: "View AI Risk Engine alerts",
  },
  {
    resource: "risk",
    action: "review",
    description:
      "Confirm/dismiss a risk alert — restricted to independent oversight roles, not the procurement roles whose own actions the alerts may concern",
  },
  {
    resource: "risk",
    action: "manage",
    description: "Manually trigger a detector re-scan",
  },
  {
    resource: "contract",
    action: "read",
    description: "View contracts and purchase orders",
  },
  {
    resource: "contract",
    action: "manage",
    description:
      "Create/activate/complete/terminate contracts, issue/cancel purchase orders",
  },
  { resource: "invoice", action: "read", description: "View invoices" },
  {
    resource: "invoice",
    action: "submit",
    description: "Record a supplier invoice against a purchase order",
  },
  {
    resource: "invoice",
    action: "verify",
    description: "Verify or reject a submitted invoice",
  },
  {
    resource: "payment",
    action: "read",
    description: "View payment requests and executed payments",
  },
  {
    resource: "payment",
    action: "approve",
    description:
      "Cast one multi-signature approval decision on a payment request",
  },
  {
    resource: "payment",
    action: "execute",
    description: "Disburse an approved payment (requires an Idempotency-Key)",
  },
  {
    resource: "payment",
    action: "reconcile",
    description: "Record a reconciliation outcome for an executed payment",
  },
  {
    resource: "project",
    action: "read",
    description: "View projects, milestones, inspections, and evidence",
  },
  {
    resource: "project",
    action: "manage",
    description:
      "Create/activate/suspend/resume/cancel projects, create milestones, mark milestones in-progress/completed",
  },
  {
    resource: "project",
    action: "inspect",
    description:
      "Record a milestone inspection outcome — restricted to a role independent of the one that marked the milestone complete",
  },
  {
    resource: "evidence",
    action: "upload",
    description:
      "Upload evidence (photos, documents) into the encrypted evidence vault",
  },
  {
    resource: "whistleblower",
    action: "read",
    description:
      "View whistleblower reports and their evidence/updates — the narrowest grant in the system, restricted to independent oversight roles only",
  },
  {
    resource: "whistleblower",
    action: "investigate",
    description:
      "Assign a whistleblower report to self, change its status, and post investigator updates on it",
  },
];

// Role -> permission grants. Roles not listed here (or listed with an empty
// array) exist as identity/authorization scaffolding for later phases where
// their real permissions will be granted.
const ROLE_PERMISSIONS: Record<string, string[]> = {
  "Super Administrator": PERMISSIONS.map((p) => `${p.resource}:${p.action}`),
  Auditor: [
    "security_events:read",
    "roles:read",
    "audit:read",
    "blockchain:read",
    "budget:read",
    "procurement:read",
    "supplier:read",
    "supplier:read_sensitive",
    "risk:read",
    "risk:review",
    "risk:manage",
    "contract:read",
    "invoice:read",
    "payment:read",
    "payment:reconcile",
    "project:read",
    "whistleblower:read",
    "whistleblower:investigate",
  ],
  "Internal Auditor": [
    "security_events:read",
    "roles:read",
    "audit:read",
    "blockchain:read",
    "budget:read",
    "procurement:read",
    "supplier:read",
    "supplier:read_sensitive",
    "risk:read",
    "risk:review",
    "risk:manage",
    "contract:read",
    "invoice:read",
    "payment:read",
    "payment:reconcile",
    "project:read",
    "whistleblower:read",
    "whistleblower:investigate",
  ],
  // payment:execute (treasury disbursement) is deliberately kept separate
  // from payment:approve (Accounting Officer / Approving Officer below) —
  // the role that pushes money out the door is not one of the roles that
  // votes to authorize it.
  "Treasury Officer": [
    "budget:manage",
    "budget:create",
    "budget:read",
    "procurement:read",
    "supplier:read",
    "risk:read",
    "contract:read",
    "invoice:read",
    "payment:read",
    "payment:execute",
    "project:read",
  ],
  "Finance Officer": [
    "budget:create",
    "budget:commit",
    "budget:adjust",
    "budget:read",
    "procurement:read",
    "supplier:read",
    "risk:read",
    "invoice:read",
    "invoice:submit",
    "payment:read",
    "project:read",
  ],
  // Deliberately NOT granted risk:review — a Procurement Officer confirming
  // or dismissing an alert about their own procurement actions would defeat
  // the separation-of-duties principle the alert exists to support. They
  // can see alerts (risk:read) and trigger a re-scan (risk:manage), but
  // resolving one is reserved for independent oversight roles.
  //
  // Gap-audit fix (Phase 1 roadmap item): procurement:evaluate and
  // procurement:award were REMOVED from this role. The same actor who
  // creates a procurement request and publishes its tender must not also
  // be the one who scores bids and awards the contract — that's a
  // textbook self-dealing/conflict-of-interest shape, not a hypothetical
  // one. Evaluation stays with Engineer (already independently granted,
  // for the same reason project:inspect is Engineer-only rather than
  // Project-Manager-only); award moves to Approving Officer below,
  // alongside its existing budget/procurement-request/payment approval
  // authority. Phase 3's multi-evaluator-assignment workflow builds on
  // this baseline split — it does not replace the need for it now.
  "Procurement Officer": [
    "procurement:manage",
    "procurement:read",
    "procurement:create",
    "procurement:publish",
    "supplier:read",
    "supplier:read_sensitive",
    "supplier:manage",
    "supplier:verify",
    "risk:read",
    "risk:manage",
    "contract:read",
    "contract:manage",
    "project:read",
  ],
  "Accounting Officer": [
    "budget:approve",
    "budget:spend",
    "budget:read",
    "procurement:read",
    "supplier:read",
    "risk:read",
    "invoice:read",
    "payment:read",
    "payment:approve",
    "project:read",
  ],
  Supplier: ["procurement:bid", "procurement:read"],
  // evidence:upload is granted to both Project Manager and Engineer — either
  // role may be on-site attaching photos/documents — but project:inspect
  // (recording a PASSED/FAILED verdict) is Engineer-only, and project:manage
  // (marking a milestone COMPLETED in the first place) is PM-only. Neither
  // role can do the other's half of "mark done, then verify it was actually
  // done" — the same separation-of-duties shape as every prior phase's
  // create/verify split.
  "Project Manager": [
    "procurement:read",
    "supplier:read",
    "risk:read",
    "contract:read",
    "invoice:read",
    "project:read",
    "project:manage",
    "evidence:upload",
  ],
  Engineer: [
    "procurement:evaluate",
    "procurement:read",
    "supplier:read",
    "risk:read",
    "invoice:read",
    "invoice:verify",
    "project:read",
    "project:inspect",
    "evidence:upload",
  ],
  "Approving Officer": [
    "budget:approve",
    "budget:read",
    "procurement:approve",
    // procurement:award moved here from Procurement Officer (see comment
    // above that role) — the award decision belongs with this role's
    // existing independent-approval mandate, not with the role that
    // created and published the tender being awarded.
    "procurement:award",
    "procurement:read",
    "supplier:read",
    "supplier:read_sensitive",
    "risk:read",
    "risk:review",
    "contract:read",
    "payment:read",
    "payment:approve",
    "project:read",
  ],
  "County Officer": [
    "budget:read",
    "procurement:read",
    "supplier:read",
    "risk:read",
    "contract:read",
    "invoice:read",
    "payment:read",
    "project:read",
  ],
  "Ministry Officer": [
    "budget:read",
    "procurement:read",
    "supplier:read",
    "risk:read",
    "contract:read",
    "invoice:read",
    "payment:read",
    "project:read",
  ],
  "Public Viewer": [],
  Whistleblower: [],
};

// Departments seeded under the ministry in every environment. Safe for
// production: codes and names only, no people.
const DEPARTMENTS: Array<{ code: string; name: string }> = [
  { code: "TREASURY", name: "National Treasury" },
  { code: "PROCUREMENT", name: "Public Procurement Directorate" },
  { code: "ACCOUNTS", name: "Accounts and Reporting" },
  { code: "INTERNAL_AUDIT", name: "Internal Audit" },
  { code: "PUBLIC_WORKS", name: "Public Works" },
  { code: "HEALTH", name: "Health Services" },
  { code: "EDUCATION", name: "Education Services" },
  { code: "WATER", name: "Water and Sanitation" },
  { code: "AGRICULTURE", name: "Agriculture" },
  { code: "LEGAL", name: "Legal Services" },
];

// Production runs set SEED_DEMO_USERS=false: roles, permissions and departments
// are created, but no accounts are, so no default credential ever exists there.
const seedDemoUsers = process.env.SEED_DEMO_USERS !== "false";

async function main() {
  console.log(seedDemoUsers ? "Seeding DEMO/TEST data..." : "Seeding roles, permissions and departments...");

  for (const permission of PERMISSIONS) {
    await prisma.permission.upsert({
      where: {
        resource_action: {
          resource: permission.resource,
          action: permission.action,
        },
      },
      create: permission,
      update: { description: permission.description },
    });
  }

  for (const [roleName, permissionKeys] of Object.entries(ROLE_PERMISSIONS)) {
    const role = await prisma.role.upsert({
      where: { name: roleName },
      create: { name: roleName, isSystem: roleName === "Super Administrator" },
      update: {},
    });

    for (const key of permissionKeys) {
      const [resource, action] = key.split(":");
      const permission = await prisma.permission.findUniqueOrThrow({
        where: { resource_action: { resource, action } },
      });
      await prisma.rolePermission.upsert({
        where: {
          roleId_permissionId: { roleId: role.id, permissionId: permission.id },
        },
        create: { roleId: role.id, permissionId: permission.id },
        update: {},
      });
    }
  }

  const ministry = await prisma.organization.upsert({
    where: { code: "MOF-DEMO" },
    create: {
      code: "MOF-DEMO",
      name: "Ministry of Finance",
      type: "MINISTRY",
    },
    update: { name: "Ministry of Finance" },
  });

  const departmentIds = new Map<string, string>();
  for (const dept of DEPARTMENTS) {
    const row = await prisma.department.upsert({
      where: {
        organizationId_code: { organizationId: ministry.id, code: dept.code },
      },
      create: { organizationId: ministry.id, code: dept.code, name: dept.name },
      update: { name: dept.name },
    });
    departmentIds.set(dept.code, row.id);
  }
  const treasuryDeptId = departmentIds.get("TREASURY")!;

  if (!seedDemoUsers) {
    console.log("Seed complete (roles, permissions and departments; no demo accounts).");
    return;
  }

  const superAdminRole = await prisma.role.findUniqueOrThrow({
    where: { name: "Super Administrator" },
  });
  const auditorRole = await prisma.role.findUniqueOrThrow({
    where: { name: "Auditor" },
  });

  const demoPasswordHash = await hash("DemoPassword123!", { type: argon2id });

  const admin = await prisma.user.upsert({
    where: { email: "admin@demo.bpfmps.local" },
    create: {
      email: "admin@demo.bpfmps.local",
      firstName: "[DEMO]",
      lastName: "Super Admin",
      passwordHash: demoPasswordHash,
      status: "ACTIVE",
      organizationId: ministry.id,
      departmentId: treasuryDeptId,
    },
    update: {},
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: admin.id, roleId: superAdminRole.id } },
    create: { userId: admin.id, roleId: superAdminRole.id },
    update: {},
  });

  const auditor = await prisma.user.upsert({
    where: { email: "auditor@demo.bpfmps.local" },
    create: {
      email: "auditor@demo.bpfmps.local",
      firstName: "[DEMO]",
      lastName: "Auditor",
      passwordHash: demoPasswordHash,
      status: "ACTIVE",
      organizationId: ministry.id,
    },
    update: {},
  });
  await prisma.userRole.upsert({
    where: { userId_roleId: { userId: auditor.id, roleId: auditorRole.id } },
    create: { userId: auditor.id, roleId: auditorRole.id },
    update: {},
  });

  console.log("Seed complete.");
  console.log(
    "  DEMO admin login:   admin@demo.bpfmps.local   / DemoPassword123!",
  );
  console.log(
    "  DEMO auditor login: auditor@demo.bpfmps.local / DemoPassword123!",
  );
}

main()
  .catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => {
    void prisma.$disconnect();
  });
