-- CreateEnum
CREATE TYPE "SupplierBusinessType" AS ENUM ('SOLE_PROPRIETORSHIP', 'PARTNERSHIP', 'LIMITED_COMPANY', 'COOPERATIVE', 'NGO', 'OTHER');

-- CreateEnum
CREATE TYPE "SupplierDocumentType" AS ENUM ('REGISTRATION_CERTIFICATE', 'TAX_COMPLIANCE_CERTIFICATE', 'CR12', 'PIN_CERTIFICATE', 'OTHER');

-- CreateEnum
CREATE TYPE "SupplierDocumentStatus" AS ENUM ('PENDING', 'VERIFIED', 'REJECTED');

-- CreateEnum
CREATE TYPE "SupplierRiskLevel" AS ENUM ('LOW', 'MEDIUM', 'HIGH', 'CRITICAL');

-- AlterTable
ALTER TABLE "suppliers" ADD COLUMN     "businessType" "SupplierBusinessType",
ADD COLUMN     "contactPersonName" TEXT,
ADD COLUMN     "county" TEXT,
ADD COLUMN     "physicalAddress" TEXT,
ADD COLUMN     "taxIdentifier" TEXT;

-- CreateTable
CREATE TABLE "supplier_owners" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "fullName" TEXT NOT NULL,
    "nationalIdOrPassport" TEXT NOT NULL,
    "ownershipPercentage" DECIMAL(5,2) NOT NULL,
    "position" TEXT,
    "isPoliticallyExposedPerson" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "supplier_owners_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_documents" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "documentType" "SupplierDocumentType" NOT NULL,
    "fileName" TEXT NOT NULL,
    "fileHash" TEXT NOT NULL,
    "fileSizeBytes" INTEGER NOT NULL,
    "mimeType" TEXT NOT NULL,
    "status" "SupplierDocumentStatus" NOT NULL DEFAULT 'PENDING',
    "expiryDate" TIMESTAMP(3),
    "uploadedById" TEXT,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_documents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "supplier_risk_profiles" (
    "id" TEXT NOT NULL,
    "supplierId" TEXT NOT NULL,
    "riskLevel" "SupplierRiskLevel" NOT NULL,
    "score" DECIMAL(5,2) NOT NULL,
    "factors" JSONB NOT NULL,
    "notes" TEXT,
    "assessedById" TEXT,
    "assessedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "supplier_risk_profiles_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "supplier_owners_supplierId_idx" ON "supplier_owners"("supplierId");

-- CreateIndex
CREATE INDEX "supplier_documents_supplierId_idx" ON "supplier_documents"("supplierId");

-- CreateIndex
CREATE INDEX "supplier_risk_profiles_supplierId_idx" ON "supplier_risk_profiles"("supplierId");

-- AddForeignKey
ALTER TABLE "supplier_owners" ADD CONSTRAINT "supplier_owners_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_documents" ADD CONSTRAINT "supplier_documents_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_documents" ADD CONSTRAINT "supplier_documents_uploadedById_fkey" FOREIGN KEY ("uploadedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_documents" ADD CONSTRAINT "supplier_documents_verifiedById_fkey" FOREIGN KEY ("verifiedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_risk_profiles" ADD CONSTRAINT "supplier_risk_profiles_supplierId_fkey" FOREIGN KEY ("supplierId") REFERENCES "suppliers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "supplier_risk_profiles" ADD CONSTRAINT "supplier_risk_profiles_assessedById_fkey" FOREIGN KEY ("assessedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
