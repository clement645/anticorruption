-- CreateEnum
CREATE TYPE "BlockchainTransactionStatus" AS ENUM ('PENDING', 'CONFIRMED', 'FAILED');

-- CreateTable
CREATE TABLE "blockchain_transactions" (
    "id" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "status" "BlockchainTransactionStatus" NOT NULL DEFAULT 'PENDING',
    "metadata" JSONB,
    "blockId" TEXT,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "confirmedAt" TIMESTAMP(3),

    CONSTRAINT "blockchain_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "blockchain_anchors" (
    "id" TEXT NOT NULL,
    "sequence" BIGSERIAL NOT NULL,
    "previousBlockHash" TEXT NOT NULL,
    "blockHash" TEXT NOT NULL,
    "rootHash" TEXT NOT NULL,
    "transactionCount" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "blockchain_anchors_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "blockchain_transactions_eventType_idx" ON "blockchain_transactions"("eventType");

-- CreateIndex
CREATE INDEX "blockchain_transactions_status_idx" ON "blockchain_transactions"("status");

-- CreateIndex
CREATE INDEX "blockchain_transactions_blockId_idx" ON "blockchain_transactions"("blockId");

-- CreateIndex
CREATE UNIQUE INDEX "blockchain_anchors_sequence_key" ON "blockchain_anchors"("sequence");

-- AddForeignKey
ALTER TABLE "blockchain_transactions" ADD CONSTRAINT "blockchain_transactions_blockId_fkey" FOREIGN KEY ("blockId") REFERENCES "blockchain_anchors"("id") ON DELETE SET NULL ON UPDATE CASCADE;
