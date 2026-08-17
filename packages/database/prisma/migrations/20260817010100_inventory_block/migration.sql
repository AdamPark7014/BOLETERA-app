-- CreateTable
CREATE TABLE "InventoryBlock" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "ticketId" TEXT NOT NULL,
    "seatId" TEXT,
    "reason" TEXT NOT NULL,
    "category" TEXT NOT NULL DEFAULT 'OTRO',
    "label" TEXT,
    "blockedBy" TEXT NOT NULL,
    "releasedAt" TIMESTAMP(3),
    "releasedBy" TEXT,
    "releaseReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "InventoryBlock_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "InventoryBlock_eventId_idx" ON "InventoryBlock"("eventId");

-- CreateIndex
CREATE INDEX "InventoryBlock_eventId_releasedAt_idx" ON "InventoryBlock"("eventId", "releasedAt");

-- CreateIndex
CREATE INDEX "InventoryBlock_ticketId_releasedAt_idx" ON "InventoryBlock"("ticketId", "releasedAt");

-- CreateIndex
CREATE INDEX "InventoryBlock_seatId_idx" ON "InventoryBlock"("seatId");

-- AddForeignKey
ALTER TABLE "InventoryBlock" ADD CONSTRAINT "InventoryBlock_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryBlock" ADD CONSTRAINT "InventoryBlock_ticketId_fkey" FOREIGN KEY ("ticketId") REFERENCES "Ticket"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "InventoryBlock" ADD CONSTRAINT "InventoryBlock_seatId_fkey" FOREIGN KEY ("seatId") REFERENCES "Seat"("id") ON DELETE SET NULL ON UPDATE CASCADE;

