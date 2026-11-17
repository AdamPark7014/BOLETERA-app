-- Compra «ya» de anuncios de reventa con cobro real y pago al vendedor.
CREATE TABLE IF NOT EXISTS "ResaleCheckout" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "listingId" TEXT NOT NULL,
    "buyerId" TEXT NOT NULL,
    "buyerEmail" VARCHAR(255) NOT NULL,
    "buyerName" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "amount" DECIMAL(12,2) NOT NULL,
    "fee" DECIMAL(12,2) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'MXN',
    "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'CARD',
    "sellerPayout" DECIMAL(12,2) NOT NULL,
    "payoutStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "paymentId" TEXT,
    "orderId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ResaleCheckout_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "ResaleCheckout_publicId_key" ON "ResaleCheckout"("publicId");
CREATE INDEX IF NOT EXISTS "ResaleCheckout_listingId_status_idx" ON "ResaleCheckout"("listingId", "status");
CREATE INDEX IF NOT EXISTS "ResaleCheckout_buyerId_status_idx" ON "ResaleCheckout"("buyerId", "status");
CREATE INDEX IF NOT EXISTS "ResaleCheckout_organizationId_status_createdAt_idx" ON "ResaleCheckout"("organizationId", "status", "createdAt");

DO $$ BEGIN
  ALTER TABLE "ResaleCheckout" ADD CONSTRAINT "ResaleCheckout_listingId_fkey"
    FOREIGN KEY ("listingId") REFERENCES "ResaleListing"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
