-- CreateEnum
CREATE TYPE "RiskDetectorType" AS ENUM ('PRICE_ANOMALY', 'BID_COLLUSION', 'SPLIT_PROCUREMENT', 'SUPPLIER_RISK');

-- CreateEnum
CREATE TYPE "RiskAlertSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- CreateEnum
CREATE TYPE "RiskAlertStatus" AS ENUM ('OPEN', 'UNDER_REVIEW', 'CONFIRMED', 'DISMISSED');

-- CreateTable
CREATE TABLE "risk_alerts" (
    "id" TEXT NOT NULL,
    "detectorType" "RiskDetectorType" NOT NULL,
    "severity" "RiskAlertSeverity" NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "evidence" JSONB NOT NULL,
    "status" "RiskAlertStatus" NOT NULL DEFAULT 'OPEN',
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNotes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "risk_alerts_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "risk_alerts_resourceType_resourceId_idx" ON "risk_alerts"("resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "risk_alerts_status_idx" ON "risk_alerts"("status");

-- AddForeignKey
ALTER TABLE "risk_alerts" ADD CONSTRAINT "risk_alerts_reviewedById_fkey" FOREIGN KEY ("reviewedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
