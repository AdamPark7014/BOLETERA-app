-- AlterTable
ALTER TABLE "Order" ADD COLUMN     "accessTokenAt" TIMESTAMP(3),
ADD COLUMN     "accessTokenHash" TEXT;

-- CreateTable
CREATE TABLE "OrgInvitation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "role" "UserRole" NOT NULL,
    "invitedById" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "acceptedAt" TIMESTAMP(3),
    "acceptedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrgInvitation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "OrgInvitation_email_acceptedAt_idx" ON "OrgInvitation"("email", "acceptedAt");

-- CreateIndex
CREATE INDEX "OrgInvitation_expiresAt_idx" ON "OrgInvitation"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "OrgInvitation_organizationId_email_key" ON "OrgInvitation"("organizationId", "email");

-- CreateIndex
CREATE INDEX "SeatHold_status_expiresAt_idx" ON "SeatHold"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "SeatHold_eventId_seatId_status_idx" ON "SeatHold"("eventId", "seatId", "status");

-- CreateIndex
CREATE INDEX "Ticket_eventId_updatedAt_idx" ON "Ticket"("eventId", "updatedAt");

-- CreateIndex
CREATE INDEX "Ticket_eventId_offerId_status_idx" ON "Ticket"("eventId", "offerId", "status");

-- AddForeignKey
ALTER TABLE "OrgInvitation" ADD CONSTRAINT "OrgInvitation_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;


-- ============================================================================
-- Invariantes que Prisma no puede expresar en el datamodel.
-- Éstas son la red de seguridad: aunque el código tenga una carrera, la base
-- rechaza el segundo escritor en vez de sobrevender en silencio.
-- ============================================================================

-- F1-09: como máximo UN hold ACTIVE por (evento, asiento).
-- El worker mueve los vencidos a EXPIRED, así que el predicado se mantiene fino.
CREATE UNIQUE INDEX IF NOT EXISTS "SeatHold_active_seat_unique"
  ON "SeatHold" ("eventId", "seatId")
  WHERE "status" = 'ACTIVE' AND "seatId" IS NOT NULL;

-- F1-02(c): el inventario restante nunca puede ser negativo.
-- NOT VALID: aplica a escrituras nuevas sin fallar por datos históricos ya
-- corruptos. Ejecutar VALIDATE CONSTRAINT tras limpiar el histórico.
ALTER TABLE "Offer"
  DROP CONSTRAINT IF EXISTS "Offer_remaining_non_negative";
ALTER TABLE "Offer"
  ADD CONSTRAINT "Offer_remaining_non_negative"
  CHECK ("remainingQuantity" >= 0) NOT VALID;

-- F1-02: vendidos + restantes nunca puede exceder el total del offer.
ALTER TABLE "Offer"
  DROP CONSTRAINT IF EXISTS "Offer_sold_within_total";
ALTER TABLE "Offer"
  ADD CONSTRAINT "Offer_sold_within_total"
  CHECK ("soldQuantity" <= "totalQuantity") NOT VALID;

-- Acelera el barrido de holds GA vencidos (seatId IS NULL), que hoy nunca
-- se liberan (F1-10) y por tanto no tienen ningún índice que los sirva.
CREATE INDEX IF NOT EXISTS "SeatHold_ga_expiry"
  ON "SeatHold" ("expiresAt")
  WHERE "status" = 'ACTIVE' AND "seatId" IS NULL;
