-- Fase 1 dinero: cotización al apartar + pago a vendedores de reventa
ALTER TABLE "SeatHold" ADD COLUMN IF NOT EXISTS "quotedSubtotal" DECIMAL(12,2);
ALTER TABLE "SeatHold" ADD COLUMN IF NOT EXISTS "quotedFees" DECIMAL(12,2);
ALTER TABLE "SeatHold" ADD COLUMN IF NOT EXISTS "quotedTaxes" DECIMAL(12,2);
ALTER TABLE "SeatHold" ADD COLUMN IF NOT EXISTS "quotedTotal" DECIMAL(12,2);

ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "resalePayoutClabe" VARCHAR(18);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "resalePayoutClabeAt" TIMESTAMP(3);

ALTER TABLE "ResaleCheckout" ADD COLUMN IF NOT EXISTS "sellerClabe" VARCHAR(18);
ALTER TABLE "ResaleCheckout" ADD COLUMN IF NOT EXISTS "payoutReference" TEXT;
ALTER TABLE "ResaleCheckout" ADD COLUMN IF NOT EXISTS "payoutPaidAt" TIMESTAMP(3);
ALTER TABLE "ResaleCheckout" ADD COLUMN IF NOT EXISTS "payoutPaidById" TEXT;

CREATE INDEX IF NOT EXISTS "ResaleCheckout_organizationId_payoutStatus_idx"
  ON "ResaleCheckout"("organizationId", "payoutStatus");
