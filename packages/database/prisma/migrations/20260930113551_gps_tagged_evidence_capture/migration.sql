-- AlterEnum
ALTER TYPE "RiskDetectorType" ADD VALUE 'EVIDENCE_LOCATION_MISMATCH';

-- AlterTable
ALTER TABLE "project_evidence" ADD COLUMN     "capturedAt" TIMESTAMP(3),
ADD COLUMN     "gpsAccuracyMeters" DOUBLE PRECISION,
ADD COLUMN     "latitude" DOUBLE PRECISION,
ADD COLUMN     "longitude" DOUBLE PRECISION;

-- AlterTable
ALTER TABLE "projects" ADD COLUMN     "siteLatitude" DOUBLE PRECISION,
ADD COLUMN     "siteLongitude" DOUBLE PRECISION;
