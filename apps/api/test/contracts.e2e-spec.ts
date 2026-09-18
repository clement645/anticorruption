import { Test, TestingModule } from '@nestjs/testing';
import { INestApplication, ValidationPipe } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import * as argon2 from 'argon2';
import request from 'supertest';
import { App } from 'supertest/types';
import { AppModule } from './../src/app.module';
import { PrismaService } from '../src/prisma/prisma.service';

interface LoginResponseBody {
  accessToken: string;
}
interface IdBody {
  id: string;
}
interface TenderBody {
  id: string;
  lots: Array<{ id: string }>;
}
interface ContractBody {
  id: string;
  status: string;
  commitmentId: string;
  allocationId: string;
}
interface PurchaseOrderBody {
  id: string;
  status: string;
}
interface InvoiceBody {
  id: string;
  status: string;
}
interface PaymentRequestBody {
  id: string;
  status: string;
  requiredApprovals: number;
  approvals: Array<{ approvedById: string; decision: string }>;
}
interface PaymentBody {
  id: string;
  expenditureId: string | null;
  idempotencyKey: string;
}
interface AllocationBody {
  committedAmount: string;
  spentAmount: string;
  availableAmount: string;
}

/**
 * Exercises Phase 9 (Contracts, Invoices & Payments): the full
 * Contract -> PurchaseOrder -> Invoice -> PaymentRequest -> Payment chain,
 * every field on Contract derived server-side from the Award rather than
 * accepted as client input, multi-signature payment approval (including
 * self-approval prevention and a genuine concurrent-approval stress test),
 * and Idempotency-Key-backed execution — including a regression test for a
 * real ordering bug found during this phase's own manual smoke testing
 * (a legitimate idempotent retry after a successful execution was
 * incorrectly rejected because the status check ran before the
 * idempotency-key replay check).
 */
describe('Contracts, Invoices & Payments (e2e)', () => {
  let app: INestApplication<App>;
  let prisma: PrismaService;

  const fullEmail = 'e2e-contracts-full@test.bpfmps.local';
  const approver1Email = 'e2e-contracts-approver1@test.bpfmps.local';
  const approver2Email = 'e2e-contracts-approver2@test.bpfmps.local';
  const approver3Email = 'e2e-contracts-approver3@test.bpfmps.local';
  const noPermEmail = 'e2e-contracts-noperm@test.bpfmps.local';
  const password = 'E2ETestPassword123!';

  let fullUserId: string;
  let approver1UserId: string;
  let approver2UserId: string;
  let approver3UserId: string;
  let noPermUserId: string;
  let fullToken: string;
  let approver1Token: string;
  let approver2Token: string;
  let approver3Token: string;
  let noPermToken: string;
  let orgId: string;
  let fullRoleId: string;
  let approverRoleId: string;
  let fiscalYearId: string;
  let allocationId: string;
  let planId: string;

  beforeAll(async () => {
    const moduleFixture: TestingModule = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleFixture.createNestApplication();
    app.setGlobalPrefix('api/v1');
    app.use(cookieParser());
    app.useGlobalPipes(
      new ValidationPipe({
        whitelist: true,
        forbidNonWhitelisted: true,
        transform: true,
      }),
    );
    await app.init();

    prisma = app.get(PrismaService);

    const org = await prisma.organization.upsert({
      where: { code: 'E2E-CONTRACTS-ORG' },
      create: {
        code: 'E2E-CONTRACTS-ORG',
        name: '[E2E] Contracts Test Ministry',
        type: 'MINISTRY',
      },
      update: {},
    });
    orgId = org.id;

    async function grantRole(roleName: string, grants: [string, string][]) {
      const role = await prisma.role.upsert({
        where: { name: roleName },
        create: { name: roleName },
        update: {},
      });
      for (const [resource, action] of grants) {
        const permission = await prisma.permission.upsert({
          where: { resource_action: { resource, action } },
          create: { resource, action, description: `${resource}:${action}` },
          update: {},
        });
        await prisma.rolePermission.upsert({
          where: {
            roleId_permissionId: {
              roleId: role.id,
              permissionId: permission.id,
            },
          },
          create: { roleId: role.id, permissionId: permission.id },
          update: {},
        });
      }
      return role.id;
    }

    fullRoleId = await grantRole('[E2E] Contracts Full Access', [
      ['budget', 'manage'],
      ['budget', 'read'],
      ['budget', 'create'],
      ['budget', 'approve'],
      ['budget', 'commit'],
      ['procurement', 'manage'],
      ['procurement', 'read'],
      ['procurement', 'create'],
      ['procurement', 'approve'],
      ['procurement', 'publish'],
      ['procurement', 'bid'],
      ['procurement', 'evaluate'],
      ['procurement', 'award'],
      ['contract', 'read'],
      ['contract', 'manage'],
      ['invoice', 'read'],
      ['invoice', 'submit'],
      ['invoice', 'verify'],
      ['payment', 'read'],
      ['payment', 'execute'],
      ['payment', 'reconcile'],
    ]);

    // A role with ONLY payment:approve/read — used by three distinct users
    // so approvals can be cast by genuinely different people, and so
    // self-approval / duplicate-approval / concurrency tests are real.
    approverRoleId = await grantRole('[E2E] Contracts Payment Approver', [
      ['payment', 'read'],
      ['payment', 'approve'],
      ['contract', 'read'],
      ['invoice', 'read'],
    ]);

    const passwordHash = await argon2.hash(password, { type: argon2.argon2id });

    async function upsertUser(email: string, lastName: string, roleId: string) {
      const user = await prisma.user.upsert({
        where: { email },
        create: {
          email,
          firstName: '[E2E]',
          lastName,
          passwordHash,
          status: 'ACTIVE',
          organizationId: orgId,
          roles: { create: { roleId } },
        },
        update: {
          passwordHash,
          status: 'ACTIVE',
          failedLoginAttempts: 0,
          lockedUntil: null,
        },
      });
      return user.id;
    }

    fullUserId = await upsertUser(fullEmail, 'ContractsFull', fullRoleId);
    approver1UserId = await upsertUser(
      approver1Email,
      'Approver1',
      approverRoleId,
    );
    approver2UserId = await upsertUser(
      approver2Email,
      'Approver2',
      approverRoleId,
    );
    approver3UserId = await upsertUser(
      approver3Email,
      'Approver3',
      approverRoleId,
    );

    const noPerm = await prisma.user.upsert({
      where: { email: noPermEmail },
      create: {
        email: noPermEmail,
        firstName: '[E2E]',
        lastName: 'NoPerm',
        passwordHash,
        status: 'ACTIVE',
      },
      update: {
        passwordHash,
        status: 'ACTIVE',
        failedLoginAttempts: 0,
        lockedUntil: null,
      },
    });
    noPermUserId = noPerm.id;

    async function login(email: string): Promise<string> {
      const res = await request(app.getHttpServer())
        .post('/api/v1/auth/login')
        .send({ email, password })
        .expect(200);
      return (res.body as LoginResponseBody).accessToken;
    }

    fullToken = await login(fullEmail);
    approver1Token = await login(approver1Email);
    approver2Token = await login(approver2Email);
    approver3Token = await login(approver3Email);
    noPermToken = await login(noPermEmail);

    const fy = await request(app.getHttpServer())
      .post('/api/v1/fiscal-years')
      .set('Authorization', `Bearer ${fullToken}`)
      .send({
        name: `E2E-CONTRACTS-FY-${Date.now()}`,
        startDate: '2027-07-01',
        endDate: '2028-06-30',
      })
      .expect(201);
    fiscalYearId = (fy.body as IdBody).id;

    const budget = await request(app.getHttpServer())
      .post('/api/v1/budgets')
      .set('Authorization', `Bearer ${fullToken}`)
      .send({
        fiscalYearId,
        organizationId: orgId,
        name: 'E2E Contracts Fixture Budget',
        lines: [
          {
            code: 'BL01',
            voteCode: 'V01',
            voteName: 'Test Vote',
            programName: 'Test Program',
            description: 'Fixture line',
            authorizedAmount: 50_000_000,
          },
        ],
      })
      .expect(201);
    const budgetId = (budget.body as IdBody).id;
    await request(app.getHttpServer())
      .post(`/api/v1/budgets/${budgetId}/submit`)
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/budgets/${budgetId}/approve`)
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(200);
    const allocations = await request(app.getHttpServer())
      .get('/api/v1/allocations')
      .query({ fiscalYearId })
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(200);
    allocationId = (allocations.body as { items: Array<{ id: string }> })
      .items[0].id;

    const plan = await request(app.getHttpServer())
      .post('/api/v1/procurement-plans')
      .set('Authorization', `Bearer ${fullToken}`)
      .send({
        organizationId: orgId,
        fiscalYearId,
        name: `E2E Contracts Plan ${Date.now()}`,
      })
      .expect(201);
    planId = (plan.body as IdBody).id;
    await request(app.getHttpServer())
      .post(`/api/v1/procurement-plans/${planId}/approve`)
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(200);
  });

  afterAll(async () => {
    const userIds = [
      fullUserId,
      approver1UserId,
      approver2UserId,
      approver3UserId,
      noPermUserId,
    ];
    await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.userRole.deleteMany({ where: { userId: { in: userIds } } });
    await prisma.securityEvent.deleteMany({
      where: { userId: { in: userIds } },
    });
    // PaymentApproval.approvedById is onDelete: Restrict (approval history
    // must survive a user's deletion in real usage — see schema.prisma) —
    // these test users cast real approvals, so deleting them without first
    // clearing those rows leaves user.deleteMany() failing partway through,
    // which silently orphans the deleted-role/deleted-session user rows for
    // every later run (found the hard way: a killed test run left exactly
    // this corrupted state, and the NEXT run's fixtures then failed
    // permission checks against a user with no roles). Only test data, so
    // clearing it here (rather than leaving these particular rows as
    // residue like other E2E business data) keeps user deletion working the
    // same way every other e2e spec file's afterAll already relies on.
    await prisma.paymentApproval.deleteMany({
      where: { approvedById: { in: userIds } },
    });
    await prisma.user.deleteMany({ where: { id: { in: userIds } } });
    await prisma.rolePermission.deleteMany({
      where: { roleId: { in: [fullRoleId, approverRoleId] } },
    });
    await prisma.role.deleteMany({
      where: { id: { in: [fullRoleId, approverRoleId] } },
    });
    await app.close();
  });

  /** Drives a full plan -> ... -> award chain and returns the resulting awardId. */
  async function createAward(amount = 900_000): Promise<string> {
    const reqResponse = await request(app.getHttpServer())
      .post('/api/v1/procurement-requests')
      .set('Authorization', `Bearer ${fullToken}`)
      .send({
        procurementPlanId: planId,
        organizationId: orgId,
        allocationId,
        title: `E2E contracts request ${Date.now()}-${Math.random()}`,
        description: 'desc',
        estimatedAmount: amount,
      })
      .expect(201);
    const requestId = (reqResponse.body as IdBody).id;
    await request(app.getHttpServer())
      .post(`/api/v1/procurement-requests/${requestId}/submit`)
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/procurement-requests/${requestId}/approve`)
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(200);

    const tender = await request(app.getHttpServer())
      .post(`/api/v1/procurement-requests/${requestId}/tenders`)
      .set('Authorization', `Bearer ${fullToken}`)
      .send({
        title: `E2E contracts tender ${Date.now()}`,
        description: 'desc',
        closingDate: '2028-06-01',
        lots: [
          { lotNumber: 'L1', description: 'lot1', estimatedAmount: amount },
        ],
      })
      .expect(201);
    const tenderId = (tender.body as TenderBody).id;
    const lotId = (tender.body as TenderBody).lots[0].id;
    await request(app.getHttpServer())
      .post(`/api/v1/tenders/${tenderId}/publish`)
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(200);

    const supplier = await request(app.getHttpServer())
      .post('/api/v1/suppliers')
      .set('Authorization', `Bearer ${fullToken}`)
      .send({
        name: `[E2E] Contracts Supplier ${Math.random()}`,
        registrationNumber: `E2E-CONTRACTS-SUP-${Date.now()}-${Math.random()}`,
      })
      .expect(201);
    const supplierId = (supplier.body as IdBody).id;

    const bid = await request(app.getHttpServer())
      .post(`/api/v1/tender-lots/${lotId}/bids`)
      .set('Authorization', `Bearer ${fullToken}`)
      .send({ supplierId, amount })
      .expect(201);
    const bidId = (bid.body as IdBody).id;

    await request(app.getHttpServer())
      .post(`/api/v1/tenders/${tenderId}/close`)
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/bids/${bidId}/evaluate`)
      .set('Authorization', `Bearer ${fullToken}`)
      .send({ technicalScore: 90, financialScore: 85 })
      .expect(201);
    const award = await request(app.getHttpServer())
      .post(`/api/v1/bids/${bidId}/award`)
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(200);
    return (award.body as IdBody).id;
  }

  /** Drives Contract -> active PO -> a verified Invoice, returning the resulting PaymentRequest id. */
  async function createReadyPaymentRequest(
    amount = 900_000,
    verifierToken = fullToken,
  ): Promise<{ paymentRequestId: string; invoiceId: string }> {
    const awardId = await createAward(amount);
    const contract = await request(app.getHttpServer())
      .post('/api/v1/contracts')
      .set('Authorization', `Bearer ${fullToken}`)
      .send({
        awardId,
        contractNumber: `E2E-CTR-${Date.now()}-${Math.random()}`,
        title: 'E2E Contract',
        value: amount,
        startDate: '2027-10-01',
        endDate: '2028-06-30',
      })
      .expect(201);
    const contractId = (contract.body as ContractBody).id;
    await request(app.getHttpServer())
      .post(`/api/v1/contracts/${contractId}/activate`)
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(200);

    const po = await request(app.getHttpServer())
      .post(`/api/v1/contracts/${contractId}/purchase-orders`)
      .set('Authorization', `Bearer ${fullToken}`)
      .send({
        poNumber: `E2E-PO-${Date.now()}-${Math.random()}`,
        description: 'Goods and services',
        amount,
      })
      .expect(201);
    const poId = (po.body as PurchaseOrderBody).id;
    await request(app.getHttpServer())
      .post(`/api/v1/purchase-orders/${poId}/issue`)
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(200);

    const invoice = await request(app.getHttpServer())
      .post(`/api/v1/purchase-orders/${poId}/invoices`)
      .set('Authorization', `Bearer ${fullToken}`)
      .send({
        invoiceNumber: `E2E-INV-${Date.now()}-${Math.random()}`,
        amount,
        items: [
          { description: 'Line 1', quantity: 1, unitPrice: amount, amount },
        ],
      })
      .expect(201);
    const invoiceId = (invoice.body as InvoiceBody).id;

    const verified = await request(app.getHttpServer())
      .post(`/api/v1/invoices/${invoiceId}/verify`)
      .set('Authorization', `Bearer ${verifierToken}`)
      .expect(200);
    expect((verified.body as InvoiceBody).status).toBe('VERIFIED');

    const paymentRequests = await request(app.getHttpServer())
      .get('/api/v1/payment-requests')
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(200);
    const pr = (
      paymentRequests.body as Array<PaymentRequestBody & { invoiceId: string }>
    ).find((p) => p.invoiceId === invoiceId);
    expect(pr).toBeDefined();

    return { paymentRequestId: pr!.id, invoiceId };
  }

  it('rejects contract access without contract:read', async () => {
    await request(app.getHttpServer())
      .get('/api/v1/contracts')
      .set('Authorization', `Bearer ${noPermToken}`)
      .expect(403);
  });

  it('derives contract fields server-side from the award chain, not from client input', async () => {
    const awardId = await createAward(500_000);
    const contract = await request(app.getHttpServer())
      .post('/api/v1/contracts')
      .set('Authorization', `Bearer ${fullToken}`)
      .send({
        awardId,
        contractNumber: `E2E-DERIVE-${Date.now()}`,
        title: 'E2E derivation check',
        value: 500_000,
        startDate: '2027-10-01',
        endDate: '2028-06-30',
      })
      .expect(201);
    const body = contract.body as ContractBody;
    expect(body.allocationId).toBe(allocationId);
    expect(body.commitmentId).toBeTruthy();
    expect(body.status).toBe('DRAFT');

    // A second contract for the SAME award is rejected (Award.awardId unique on Contract).
    await request(app.getHttpServer())
      .post('/api/v1/contracts')
      .set('Authorization', `Bearer ${fullToken}`)
      .send({
        awardId,
        contractNumber: `E2E-DUP-${Date.now()}`,
        title: 'duplicate',
        value: 500_000,
        startDate: '2027-10-01',
        endDate: '2028-06-30',
      })
      .expect(409);
  });

  it('enforces the contract/PO/invoice lifecycle state machines', async () => {
    const awardId = await createAward(400_000);
    const contract = await request(app.getHttpServer())
      .post('/api/v1/contracts')
      .set('Authorization', `Bearer ${fullToken}`)
      .send({
        awardId,
        contractNumber: `E2E-LIFECYCLE-${Date.now()}`,
        title: 'E2E lifecycle',
        value: 400_000,
        startDate: '2027-10-01',
        endDate: '2028-06-30',
      })
      .expect(201);
    const contractId = (contract.body as ContractBody).id;

    // PO cannot be created against a DRAFT (not yet ACTIVE) contract.
    await request(app.getHttpServer())
      .post(`/api/v1/contracts/${contractId}/purchase-orders`)
      .set('Authorization', `Bearer ${fullToken}`)
      .send({
        poNumber: `E2E-EARLY-PO-${Date.now()}`,
        description: 'x',
        amount: 100,
      })
      .expect(400);

    await request(app.getHttpServer())
      .post(`/api/v1/contracts/${contractId}/activate`)
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(200);
    await request(app.getHttpServer())
      .post(`/api/v1/contracts/${contractId}/activate`)
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(400); // already ACTIVE

    const po = await request(app.getHttpServer())
      .post(`/api/v1/contracts/${contractId}/purchase-orders`)
      .set('Authorization', `Bearer ${fullToken}`)
      .send({
        poNumber: `E2E-PO-${Date.now()}`,
        description: 'x',
        amount: 400_000,
      })
      .expect(201);
    const poId = (po.body as PurchaseOrderBody).id;

    // Invoice cannot be created against a DRAFT (not yet ISSUED) PO.
    await request(app.getHttpServer())
      .post(`/api/v1/purchase-orders/${poId}/invoices`)
      .set('Authorization', `Bearer ${fullToken}`)
      .send({
        invoiceNumber: `E2E-EARLY-INV-${Date.now()}`,
        amount: 400_000,
        items: [
          {
            description: 'x',
            quantity: 1,
            unitPrice: 400_000,
            amount: 400_000,
          },
        ],
      })
      .expect(400);

    await request(app.getHttpServer())
      .post(`/api/v1/purchase-orders/${poId}/issue`)
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(200);

    const invoice = await request(app.getHttpServer())
      .post(`/api/v1/purchase-orders/${poId}/invoices`)
      .set('Authorization', `Bearer ${fullToken}`)
      .send({
        invoiceNumber: `E2E-INV-${Date.now()}`,
        amount: 400_000,
        items: [
          {
            description: 'x',
            quantity: 1,
            unitPrice: 400_000,
            amount: 400_000,
          },
        ],
      })
      .expect(201);
    const invoiceId = (invoice.body as InvoiceBody).id;

    const rejected = await request(app.getHttpServer())
      .post(`/api/v1/invoices/${invoiceId}/reject`)
      .set('Authorization', `Bearer ${fullToken}`)
      .send({ reason: '[E2E] discrepancy' })
      .expect(200);
    expect((rejected.body as InvoiceBody).status).toBe('REJECTED');

    // Cannot verify an already-rejected invoice.
    await request(app.getHttpServer())
      .post(`/api/v1/invoices/${invoiceId}/verify`)
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(400);
  });

  it('prevents self-approval and duplicate approval by the same user', async () => {
    const { paymentRequestId } = await createReadyPaymentRequest(
      300_000,
      fullToken,
    );

    // fullToken verified this invoice — cannot also approve its payment.
    await request(app.getHttpServer())
      .post(`/api/v1/payment-requests/${paymentRequestId}/approvals`)
      .set('Authorization', `Bearer ${fullToken}`)
      .send({ decision: 'APPROVE' })
      .expect(403);

    await request(app.getHttpServer())
      .post(`/api/v1/payment-requests/${paymentRequestId}/approvals`)
      .set('Authorization', `Bearer ${approver1Token}`)
      .send({ decision: 'APPROVE' })
      .expect(201);

    // Same approver again, before the threshold is reached — unique constraint.
    await request(app.getHttpServer())
      .post(`/api/v1/payment-requests/${paymentRequestId}/approvals`)
      .set('Authorization', `Bearer ${approver1Token}`)
      .send({ decision: 'APPROVE' })
      .expect(409);
  });

  it('reaches APPROVED after 2 distinct approvals, and a REJECT rejects immediately', async () => {
    const { paymentRequestId } = await createReadyPaymentRequest(
      310_000,
      fullToken,
    );

    const first = await request(app.getHttpServer())
      .post(`/api/v1/payment-requests/${paymentRequestId}/approvals`)
      .set('Authorization', `Bearer ${approver1Token}`)
      .send({ decision: 'APPROVE' })
      .expect(201);
    expect((first.body as PaymentRequestBody).status).toBe('PENDING');

    const second = await request(app.getHttpServer())
      .post(`/api/v1/payment-requests/${paymentRequestId}/approvals`)
      .set('Authorization', `Bearer ${approver2Token}`)
      .send({ decision: 'APPROVE' })
      .expect(201);
    expect((second.body as PaymentRequestBody).status).toBe('APPROVED');

    // Now REJECTED-flavored test on a fresh request.
    const { paymentRequestId: pr2 } = await createReadyPaymentRequest(
      320_000,
      fullToken,
    );
    const rejected = await request(app.getHttpServer())
      .post(`/api/v1/payment-requests/${pr2}/approvals`)
      .set('Authorization', `Bearer ${approver1Token}`)
      .send({ decision: 'REJECT', notes: '[E2E] amount looks wrong' })
      .expect(201);
    expect((rejected.body as PaymentRequestBody).status).toBe('REJECTED');

    // A second approver can no longer act on a REJECTED request.
    await request(app.getHttpServer())
      .post(`/api/v1/payment-requests/${pr2}/approvals`)
      .set('Authorization', `Bearer ${approver2Token}`)
      .send({ decision: 'APPROVE' })
      .expect(400);
  });

  it(
    'stays exactly correct under 3 genuinely concurrent approvals — exactly ' +
      '2 reach the threshold and succeed, the row lock ensures the 3rd ' +
      'consistently observes the request is no longer PENDING',
    async () => {
      const { paymentRequestId } = await createReadyPaymentRequest(
        330_000,
        fullToken,
      );

      const results = await Promise.all([
        request(app.getHttpServer())
          .post(`/api/v1/payment-requests/${paymentRequestId}/approvals`)
          .set('Authorization', `Bearer ${approver1Token}`)
          .send({ decision: 'APPROVE' }),
        request(app.getHttpServer())
          .post(`/api/v1/payment-requests/${paymentRequestId}/approvals`)
          .set('Authorization', `Bearer ${approver2Token}`)
          .send({ decision: 'APPROVE' }),
        request(app.getHttpServer())
          .post(`/api/v1/payment-requests/${paymentRequestId}/approvals`)
          .set('Authorization', `Bearer ${approver3Token}`)
          .send({ decision: 'APPROVE' }),
      ]);

      // Once the 2nd distinct approval reaches the row-locked count check,
      // the request moves to APPROVED — a 3rd concurrent attempt correctly
      // observes it's no longer PENDING and is rejected (400), the same
      // "exactly the number that fit succeed, the rest correctly rejected"
      // shape as Phase 5's allocation stress test and Phase 6's 5-way
      // award race, not "every distinct approver's opinion is always
      // recorded regardless of how many already exist".
      const succeeded = results.filter((r) => r.status === 201);
      const rejected = results.filter((r) => r.status === 400);
      expect(succeeded).toHaveLength(2);
      expect(rejected).toHaveLength(1);

      const final = await request(app.getHttpServer())
        .get(`/api/v1/payment-requests/${paymentRequestId}`)
        .set('Authorization', `Bearer ${fullToken}`)
        .expect(200);
      const body = final.body as PaymentRequestBody;
      expect(body.status).toBe('APPROVED');
      expect(body.approvals).toHaveLength(2);
    },
  );

  it('executes a payment, updates the budget, and marks the invoice PAID', async () => {
    const { paymentRequestId, invoiceId } = await createReadyPaymentRequest(
      340_000,
      fullToken,
    );
    await request(app.getHttpServer())
      .post(`/api/v1/payment-requests/${paymentRequestId}/approvals`)
      .set('Authorization', `Bearer ${approver1Token}`)
      .send({ decision: 'APPROVE' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/payment-requests/${paymentRequestId}/approvals`)
      .set('Authorization', `Bearer ${approver2Token}`)
      .send({ decision: 'APPROVE' })
      .expect(201);

    const before = await request(app.getHttpServer())
      .get(`/api/v1/allocations/${allocationId}`)
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(200);
    const spentBefore = Number((before.body as AllocationBody).spentAmount);

    await request(app.getHttpServer())
      .post(`/api/v1/payment-requests/${paymentRequestId}/execute`)
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(400); // missing Idempotency-Key

    const payment = await request(app.getHttpServer())
      .post(`/api/v1/payment-requests/${paymentRequestId}/execute`)
      .set('Authorization', `Bearer ${fullToken}`)
      .set('Idempotency-Key', `e2e-exec-${paymentRequestId}`)
      .expect(200);
    const paymentBody = payment.body as PaymentBody;
    expect(paymentBody.expenditureId).toBeTruthy();

    const invoiceAfter = await request(app.getHttpServer())
      .get(`/api/v1/invoices/${invoiceId}`)
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(200);
    expect((invoiceAfter.body as InvoiceBody).status).toBe('PAID');

    const after = await request(app.getHttpServer())
      .get(`/api/v1/allocations/${allocationId}`)
      .set('Authorization', `Bearer ${fullToken}`)
      .expect(200);
    expect(Number((after.body as AllocationBody).spentAmount)).toBe(
      spentBefore + 340_000,
    );

    await request(app.getHttpServer())
      .post(`/api/v1/payments/${paymentBody.id}/reconciliations`)
      .set('Authorization', `Bearer ${fullToken}`)
      .send({ externalReference: '[E2E] BANK-REF', status: 'MATCHED' })
      .expect(201);
  });

  it(
    'regression: replaying the same Idempotency-Key after a successful ' +
      'execution returns the ORIGINAL payment, not a 400 — a real ordering ' +
      'bug (status checked before the idempotency replay lookup) found ' +
      "during this phase's manual smoke testing",
    async () => {
      const { paymentRequestId } = await createReadyPaymentRequest(
        350_000,
        fullToken,
      );
      await request(app.getHttpServer())
        .post(`/api/v1/payment-requests/${paymentRequestId}/approvals`)
        .set('Authorization', `Bearer ${approver1Token}`)
        .send({ decision: 'APPROVE' })
        .expect(201);
      await request(app.getHttpServer())
        .post(`/api/v1/payment-requests/${paymentRequestId}/approvals`)
        .set('Authorization', `Bearer ${approver2Token}`)
        .send({ decision: 'APPROVE' })
        .expect(201);

      const key = `e2e-replay-${paymentRequestId}`;
      const first = await request(app.getHttpServer())
        .post(`/api/v1/payment-requests/${paymentRequestId}/execute`)
        .set('Authorization', `Bearer ${fullToken}`)
        .set('Idempotency-Key', key)
        .expect(200);

      // The payment request is now EXECUTED — replaying the SAME key must
      // still succeed and return the identical payment, not 400.
      const replay = await request(app.getHttpServer())
        .post(`/api/v1/payment-requests/${paymentRequestId}/execute`)
        .set('Authorization', `Bearer ${fullToken}`)
        .set('Idempotency-Key', key)
        .expect(200);

      expect((replay.body as PaymentBody).id).toBe(
        (first.body as PaymentBody).id,
      );

      // A DIFFERENT key against the same now-EXECUTED request is a real
      // conflict, not a replay.
      await request(app.getHttpServer())
        .post(`/api/v1/payment-requests/${paymentRequestId}/execute`)
        .set('Authorization', `Bearer ${fullToken}`)
        .set('Idempotency-Key', `${key}-different`)
        .expect(400);
    },
  );

  it('under genuinely concurrent execute() calls sharing one Idempotency-Key, only one Expenditure is created', async () => {
    const { paymentRequestId } = await createReadyPaymentRequest(
      360_000,
      fullToken,
    );
    await request(app.getHttpServer())
      .post(`/api/v1/payment-requests/${paymentRequestId}/approvals`)
      .set('Authorization', `Bearer ${approver1Token}`)
      .send({ decision: 'APPROVE' })
      .expect(201);
    await request(app.getHttpServer())
      .post(`/api/v1/payment-requests/${paymentRequestId}/approvals`)
      .set('Authorization', `Bearer ${approver2Token}`)
      .send({ decision: 'APPROVE' })
      .expect(201);

    const key = `e2e-concurrent-${paymentRequestId}`;
    const attempts = Array.from({ length: 5 }, () =>
      request(app.getHttpServer())
        .post(`/api/v1/payment-requests/${paymentRequestId}/execute`)
        .set('Authorization', `Bearer ${fullToken}`)
        .set('Idempotency-Key', key),
    );
    const results = await Promise.all(attempts);

    // Regression: all 5 must return 200 with the identical payment — not a
    // mix of 200/409. An earlier version branched on which specific unique
    // constraint Postgres reported (idempotencyKey vs paymentRequestId),
    // and under genuine 5-way concurrency sharing one key, some losing
    // requests were reported against paymentRequestId and got a false 409
    // "different idempotency key" — even though their key was identical.
    // Found via this exact test before the fix (see PaymentsService.execute()).
    const statuses = results.map((r) => r.status);
    expect(statuses.every((s) => s === 200)).toBe(true);

    const paymentIds = new Set(
      results
        .filter((r) => r.status === 200)
        .map((r) => (r.body as PaymentBody).id),
    );
    // Every successful response must be the SAME payment id — genuine
    // concurrency, not just sequential retries, proven the same way Phase
    // 6's 5-way concurrent award test proved "exactly one winner".
    expect(paymentIds.size).toBe(1);

    const payments = await prisma.payment.findMany({
      where: { idempotencyKey: key },
    });
    expect(payments).toHaveLength(1);
    expect(payments[0].expenditureId).toBeTruthy();
  });
});
