-- AlterTable
ALTER TABLE "audit_events" ADD COLUMN     "actorKeyId" TEXT,
ADD COLUMN     "actorSignature" TEXT,
ADD COLUMN     "actorSignedPayload" TEXT;

-- CreateTable
CREATE TABLE "signature_nonces" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "nonce" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "signature_nonces_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "signature_nonces_nonce_key" ON "signature_nonces"("nonce");

-- CreateIndex
CREATE INDEX "signature_nonces_userId_idx" ON "signature_nonces"("userId");

-- CreateIndex
CREATE INDEX "signature_nonces_createdAt_idx" ON "signature_nonces"("createdAt");

-- AddForeignKey
ALTER TABLE "signature_nonces" ADD CONSTRAINT "signature_nonces_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
