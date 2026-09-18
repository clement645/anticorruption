-- CreateEnum
CREATE TYPE "SupplierStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'BLACKLISTED');

-- CreateEnum
CREATE TYPE "ProcurementPlanStatus" AS ENUM ('DRAFT', 'APPROVED');

-- CreateEnum
CREATE TYPE "ProcurementRequestStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED');

-- CreateEnum
CREATE TYPE "TenderStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'CLOSED', 'AWARDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "BidStatus" AS ENUM ('SUBMITTED', 'EVALUATED', 'AWARDED', 'REJECTED');

-- CreateTable
CREATE TABLE "suppliers" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "registrationNumber" TEXT NOT NULL,
    "email" TEXT,
    "phone" TEXT,
    "status" "SupplierStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "suppliers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procurement_plans" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "fiscalYearId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" "ProcurementPlanStatus" NOT NULL DEFAULT 'DRAFT',
    "createdById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "procurement_plans_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "procurement_requests" (
    "id" TEXT NOT NULL,
    "procurementPlanId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "allocationId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "estimatedAmount" DECIMAL(18,2) NOT NULL,
    "status" "ProcurementRequestStatus" NOT NULL DEFAULT 'DRAFT',
    "commitmentId" TEXT,
    "requestedById" TEXT,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "procurement_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tenders" (
    "id" TEXT NOT NULL,
    "procurementRequestId" TEXT NOT NULL,
    "tenderNumber" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "status" "TenderStatus" NOT NULL DEFAULT 'DRAFT',
    "publishedAt" TIMESTAMP(3),
    "closingDate" TIMESTAMP(3) NOT NULL,
    "closedAt" TIMESTAMP(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "tenders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "tender_lots" (
    "id" TEXT NOT NULL,
    "tenderId" TEXT NOT NULL,
    "lotNumber" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "estimatedAmount" DECIMAL(18,2) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "tender_lots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bids" (
    "id" TEXT NOT NULL,
    "tenderLotId" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "amount" DECIMAL(18,2) NOT NULL,
    "status" "BidStatus" NOT NULL DEFAULT 'SUBMITTED',
    "technicalScore" DECIMAL(5,2),
    "financialScore" DECIMAL(5,2),
    "submittedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "bids_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bid_evaluations" (
    "id" TEXT NOT NULL,
    "bidId" TEXT NOT NULL,
    "technicalScore" DECIMAL(5,2) NOT NULL,
    "financialScore" DECIMAL(5,2) NOT NULL,
    "comments" TEXT,
    "evaluatedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bid_evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "awards" (
    "id" TEXT NOT NULL,
    "tenderLotId" TEXT NOT NULL,
    "bidId" TEXT NOT NULL,
    "awardedAmount" DECIMAL(18,2) NOT NULL,
    "awardedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "awards_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "suppliers_registrationNumber_key" ON "suppliers"("registrationNumber");

-- CreateIndex
CREATE UNIQUE INDEX "procurement_plans_organizationId_fiscalYearId_name_key" ON "procurement_plans"("organizationId", "fiscalYearId", "name");

-- CreateIndex
CREATE UNIQUE INDEX "procurement_requests_commitmentId_key" ON "procurement_requests"("commitmentId");

-- CreateIndex
CREATE INDEX "procurement_requests_procurementPlanId_idx" ON "procurement_requests"("procurementPlanId");

-- CreateIndex
CREATE INDEX "procurement_requests_allocationId_idx" ON "procurement_requests"("allocationId");

-- CreateIndex
CREATE UNIQUE INDEX "tenders_tenderNumber_key" ON "tenders"("tenderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "tender_lots_tenderId_lotNumber_key" ON "tender_lots"("tenderId", "lotNumber");

-- CreateIndex
CREATE INDEX "bids_tenderLotId_idx" ON "bids"("tenderLotId");

-- CreateIndex
CREATE UNIQUE INDEX "bids_tenderLotId_supplierId_key" ON "bids"("tenderLotId", "supplierId");

-- CreateIndex
CREATE INDEX "bid_evaluations_bidId_idx" ON "bid_evaluations"("bidId");

-- CreateIndex
CREATE UNIQUE INDEX "awards_tenderLotId_key" ON "awards"("tenderLotId");

-- CreateIndex
CREATE UNIQUE INDEX "awards_bidId_key" ON "awards"("bidId");

-- AddForeignKey
ALTER TABLE "procurement_plans" ADD CONSTRAINT "procurement_plans_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_plans" ADD CONSTRAINT "procurement_plans_fiscalYearId_fkey" FOREIGN KEY ("fiscalYearId") REFERENCES "fiscal_years"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_plans" ADD CONSTRAINT "procurement_plans_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_plans" ADD CONSTRAINT "procurement_plans_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_requests" ADD CONSTRAINT "procurement_requests_procurementPlanId_fkey" FOREIGN KEY ("procurementPlanId") REFERENCES "procurement_plans"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_requests" ADD CONSTRAINT "procurement_requests_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_requests" ADD CONSTRAINT "procurement_requests_allocationId_fkey" FOREIGN KEY ("allocationId") REFERENCES "allocations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_requests" ADD CONSTRAINT "procurement_requests_commitmentId_fkey" FOREIGN KEY ("commitmentId") REFERENCES "commitments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_requests" ADD CONSTRAINT "procurement_requests_requestedById_fkey" FOREIGN KEY ("requestedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "procurement_requests" ADD CONSTRAINT "procurement_requests_approvedById_fkey" FOREIGN KEY ("approvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenders" ADD CONSTRAINT "tenders_procurementRequestId_fkey" FOREIGN KEY ("procurementRequestId") REFERENCES "procurement_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tenders" ADD CONSTRAINT "tenders_createdById_fkey" FOREIGN KEY ("createdById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "tender_lots" ADD CONSTRAINT "tender_lots_tenderId_fkey" FOREIGN KEY ("tenderId") REFERENCES "tenders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bids" ADD CONSTRAINT "bids_tenderLotId_fkey" FOREIGN KEY ("tenderLotId") REFERENCES "tender_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bids" ADD CONSTRAINT "bids_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bids" ADD CONSTRAINT "bids_submittedById_fkey" FOREIGN KEY ("submittedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_evaluations" ADD CONSTRAINT "bid_evaluations_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "bids"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bid_evaluations" ADD CONSTRAINT "bid_evaluations_evaluatedById_fkey" FOREIGN KEY ("evaluatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "awards" ADD CONSTRAINT "awards_tenderLotId_fkey" FOREIGN KEY ("tenderLotId") REFERENCES "tender_lots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "awards" ADD CONSTRAINT "awards_bidId_fkey" FOREIGN KEY ("bidId") REFERENCES "bids"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "awards" ADD CONSTRAINT "awards_awardedById_fkey" FOREIGN KEY ("awardedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
