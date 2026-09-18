-- CreateEnum
CREATE TYPE "FiscalYearStatus" AS ENUM ('DRAFT', 'ACTIVE', 'CLOSED');

-- CreateEnum
CREATE TYPE "BudgetStatus" AS ENUM ('DRAFT', 'PENDING_APPROVAL', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "AllocationStatus" AS ENUM ('ACTIVE', 'FROZEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "CommitmentStatus" AS ENUM ('ACTIVE', 'RELEASED', 'CONSUMED');

-- CreateEnum
CREATE TYPE "BudgetAdjustmentType" AS ENUM ('INCREASE', 'DECREASE');

-- CreateEnum
CREATE TYPE "BudgetAdjustmentStatus" AS ENUM ('PENDING', 'APPROVED', 'REJECTED');

-- CreateTable
CREATE TABLE "fiscal_years" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" "FiscalYearStatus" NOT NULL DEFAULT 'DRAFT',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "fiscal_years_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budgets" (
    "id" TEXT NOT NULL,
    "fiscalYearId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "BudgetStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budgets_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_lines" (
    "id" TEXT NOT NULL,
    "budgetId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "voteCode" TEXT NOT NULL,
    "voteName" TEXT NOT NULL,
    "programName" TEXT NOT NULL,
    "subProgramName" TEXT,
    "description" TEXT NOT NULL,
    "authorizedAmount" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "budget_lines_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allocations" (
    "id" TEXT NOT NULL,
    "budgetLineId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fiscalYearId" TEXT NOT NULL,
    "authorizedAmount" DECIMAL(18,2) NOT NULL,
    "committedAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "spentAmount" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "status" "AllocationStatus" NOT NULL DEFAULT 'ACTIVE',
    "authorizationReference" TEXT NOT NULL,
    "blockchainTxRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "allocations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "commitments" (
    "id" TEXT NOT NULL,
    "allocationId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "description" TEXT NOT NULL,
    "status" "CommitmentStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdById" TEXT,
    "releasedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "commitments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "expenditures" (
    "id" TEXT NOT NULL,
    "commitmentId" TEXT NOT NULL,
    "allocationId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "description" TEXT NOT NULL,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "expenditures_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "budget_adjustments" (
    "id" TEXT NOT NULL,
    "allocationId" TEXT NOT NULL,
    "type" "BudgetAdjustmentType" NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "reason" TEXT NOT NULL,
    "status" "BudgetAdjustmentStatus" NOT NULL DEFAULT 'PENDING',
    "requestedById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "budget_adjustments_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "fiscal_years_name_key" ON "fiscal_years"("name");

-- CreateIndex
CREATE INDEX "budgets_organizationId_idx" ON "budgets"("organizationId");

-- CreateIndex
CREATE INDEX "budgets_fiscalYearId_idx" ON "budgets"("fiscalYearId");

-- CreateIndex
CREATE UNIQUE INDEX "budgets_fiscalYearId_organizationId_name_key" ON "budgets"("fiscalYearId", "organizationId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "budget_lines_budgetId_code_key" ON "budget_lines"("budgetId", "code");

-- CreateIndex
CREATE UNIQUE INDEX "allocations_budgetLineId_key" ON "allocations"("budgetLineId");

-- CreateIndex
CREATE UNIQUE INDEX "allocations_authorizationReference_key" ON "allocations"("authorizationReference");

-- CreateIndex
CREATE INDEX "allocations_organizationId_idx" ON "allocations"("organizationId");

-- CreateIndex
CREATE INDEX "allocations_fiscalYearId_idx" ON "allocations"("fiscalYearId");

-- CreateIndex
CREATE INDEX "commitments_allocationId_idx" ON "commitments"("allocationId");

-- CreateIndex
CREATE UNIQUE INDEX "expenditures_commitmentId_key" ON "expenditures"("commitmentId");

-- CreateIndex
CREATE INDEX "expenditures_allocationId_idx" ON "expenditures"("allocationId");

-- CreateIndex
CREATE INDEX "budget_adjustments_allocationId_idx" ON "budget_adjustments"("allocationId");

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_fiscalYearId_fkey" FOREIGN KEY ("fiscalYearId") REFERENCES "fiscal_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budgets" ADD CONSTRAINT "budgets_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_lines" ADD CONSTRAINT "budget_lines_budgetId_fkey" FOREIGN KEY ("budgetId") REFERENCES "budgets"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_budgetLineId_fkey" FOREIGN KEY ("budgetLineId") REFERENCES "budget_lines"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allocations" ADD CONSTRAINT "allocations_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "allocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "commitments" ADD CONSTRAINT "commitments_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenditures" ADD CONSTRAINT "expenditures_commitmentId_fkey" FOREIGN KEY ("commitmentId") REFERENCES "commitments"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "expenditures" ADD CONSTRAINT "expenditures_recordedById_fkey" FOREIGN KEY ("recordedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_adjustments" ADD CONSTRAINT "budget_adjustments_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "allocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_adjustments" ADD CONSTRAINT "budget_adjustments_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "budget_adjustments" ADD CONSTRAINT "budget_adjustments_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
