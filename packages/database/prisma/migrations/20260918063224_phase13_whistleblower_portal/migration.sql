-- CreateEnum
CREATE TYPE "ReportCategory" AS ENUM ('CORRUPTION', 'FRAUD', 'PROCUREMENT_IRREGULARITY', 'CONFLICT_OF_INTEREST', 'ABUSE_OF_OFFICE', 'OTHER');

-- CreateEnum
CREATE TYPE "ReportStatus" AS ENUM ('SUBMITTED', 'UNDER_REVIEW', 'SUBSTANTIATED', 'UNSUBSTANTIATED');

-- CreateEnum
CREATE TYPE "ReportUpdateAuthor" AS ENUM ('INVESTIGATOR', 'REPORTER');

-- CreateTable
CREATE TABLE "whistleblower_reports" (
    "id" TEXT NOT NULL,
    "trackingCodeHash" TEXT NOT NULL,
    "category" "ReportCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "organizationId" TEXT,
    "status" "ReportStatus" NOT NULL DEFAULT 'SUBMITTED',
    "contactEncrypted" TEXT,
    "assignedToId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "whistleblower_reports_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whistleblower_evidence" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "storageKey" TEXT NOT NULL,
    "blockchainTxRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whistleblower_evidence_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "whistleblower_report_updates" (
    "id" TEXT NOT NULL,
    "reportId" TEXT NOT NULL,
    "author" "ReportUpdateAuthor" NOT NULL,
    "message" TEXT NOT NULL,
    "postedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "whistleblower_report_updates_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "whistleblower_reports_trackingCodeHash_key" ON "whistleblower_reports"("trackingCodeHash");

-- CreateIndex
CREATE INDEX "whistleblower_reports_status_idx" ON "whistleblower_reports"("status");

-- CreateIndex
CREATE INDEX "whistleblower_reports_organizationId_idx" ON "whistleblower_reports"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "whistleblower_evidence_storageKey_key" ON "whistleblower_evidence"("storageKey");

-- CreateIndex
CREATE INDEX "whistleblower_evidence_reportId_idx" ON "whistleblower_evidence"("reportId");

-- CreateIndex
CREATE INDEX "whistleblower_report_updates_reportId_idx" ON "whistleblower_report_updates"("reportId");

-- AddForeignKey
ALTER TABLE "whistleblower_reports" ADD CONSTRAINT "whistleblower_reports_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "organizations"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whistleblower_reports" ADD CONSTRAINT "whistleblower_reports_assignedToId_fkey" FOREIGN KEY ("assignedToId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whistleblower_evidence" ADD CONSTRAINT "whistleblower_evidence_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "whistleblower_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whistleblower_report_updates" ADD CONSTRAINT "whistleblower_report_updates_reportId_fkey" FOREIGN KEY ("reportId") REFERENCES "whistleblower_reports"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "whistleblower_report_updates" ADD CONSTRAINT "whistleblower_report_updates_postedById_fkey" FOREIGN KEY ("postedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
