-- CreateTable
CREATE TABLE "audit_events" (
    "id" TEXT NOT NULL,
    "sequence" BIGSERIAL NOT NULL,
    "eventType" TEXT NOT NULL,
    "actorId" TEXT,
    "actorEmail" TEXT,
    "organizationId" TEXT,
    "resourceType" TEXT,
    "resourceId" TEXT,
    "action" TEXT NOT NULL,
    "payload" JSONB,
    "payloadHash" TEXT NOT NULL,
    "previousHash" TEXT NOT NULL,
    "currentHash" TEXT NOT NULL,
    "signature" TEXT NOT NULL,
    "signatureKeyId" TEXT NOT NULL,
    "ipAddress" TEXT,
    "userAgent" TEXT,
    "requestId" TEXT,
    "correlationId" TEXT,
    "blockchainTxRef" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_events_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "audit_events_sequence_key" ON "audit_events"("sequence");

-- CreateIndex
CREATE INDEX "audit_events_eventType_idx" ON "audit_events"("eventType");

-- CreateIndex
CREATE INDEX "audit_events_actorId_idx" ON "audit_events"("actorId");

-- CreateIndex
CREATE INDEX "audit_events_resourceType_resourceId_idx" ON "audit_events"("resourceType", "resourceId");

-- CreateIndex
CREATE INDEX "audit_events_createdAt_idx" ON "audit_events"("createdAt");

-- AddForeignKey
ALTER TABLE "audit_events" ADD CONSTRAINT "audit_events_actorId_fkey" FOREIGN KEY ("actorId") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
