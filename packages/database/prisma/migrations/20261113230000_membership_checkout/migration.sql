-- Compra de membresía en la web. Aditiva: una tabla nueva, no toca las existentes.
-- Se cobra por el camino de las órdenes (PaymentIntent Banorte → IPN o
-- confirmación demo → Payment); al confirmarse activa o renueva la membresía.

-- CreateTable
CREATE TABLE "MembershipCheckout" (
    "id" TEXT NOT NULL,
    "publicId" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'PENDING',
    "kind" "MembershipPeriodKind" NOT NULL DEFAULT 'NEW',
    "amount" DECIMAL(12,2) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'MXN',
    "paymentMethod" "PaymentMethod" NOT NULL DEFAULT 'CARD',
    "buyerEmail" VARCHAR(255) NOT NULL,
    "buyerName" TEXT NOT NULL,
    "paymentId" TEXT,
    "membershipId" TEXT,
    "periodId" TEXT,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MembershipCheckout_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "MembershipCheckout_publicId_key" ON "MembershipCheckout"("publicId");

-- CreateIndex
CREATE UNIQUE INDEX "MembershipCheckout_periodId_key" ON "MembershipCheckout"("periodId");

-- CreateIndex
CREATE INDEX "MembershipCheckout_organizationId_status_createdAt_idx" ON "MembershipCheckout"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "MembershipCheckout_userId_status_idx" ON "MembershipCheckout"("userId", "status");

-- CreateIndex
CREATE INDEX "MembershipCheckout_planId_status_idx" ON "MembershipCheckout"("planId", "status");

-- AddForeignKey
ALTER TABLE "MembershipCheckout" ADD CONSTRAINT "MembershipCheckout_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MembershipPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipCheckout" ADD CONSTRAINT "MembershipCheckout_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
