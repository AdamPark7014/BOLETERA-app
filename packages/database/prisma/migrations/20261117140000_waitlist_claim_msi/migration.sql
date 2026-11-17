-- Lista de espera estilo DICE: claim con token y plazo de 60 min.
-- MSI: meses sin intereses en PaymentIntent (presentación; Banorte aún no lo cobra).

ALTER TABLE "WaitlistEntry" ADD COLUMN IF NOT EXISTS "claimToken" TEXT;
ALTER TABLE "WaitlistEntry" ADD COLUMN IF NOT EXISTS "claimExpiresAt" TIMESTAMP(3);
ALTER TABLE "WaitlistEntry" ADD COLUMN IF NOT EXISTS "reservedTicketId" TEXT;
ALTER TABLE "WaitlistEntry" ADD COLUMN IF NOT EXISTS "reservedHoldId" TEXT;
ALTER TABLE "WaitlistEntry" ADD COLUMN IF NOT EXISTS "facePrice" DECIMAL(12,2);

CREATE UNIQUE INDEX IF NOT EXISTS "WaitlistEntry_claimToken_key" ON "WaitlistEntry"("claimToken");
CREATE INDEX IF NOT EXISTS "WaitlistEntry_claimExpiresAt_idx" ON "WaitlistEntry"("claimExpiresAt");

ALTER TABLE "PaymentIntent" ADD COLUMN IF NOT EXISTS "installments" INTEGER;
