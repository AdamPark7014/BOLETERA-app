-- Recomendaciones de precio encoladas o aplicadas (cola de aprobación).
-- Aditiva: al aplicar se escribe Offer.basePrice y DynamicPrice como historial.

-- CreateEnum
CREATE TYPE "PricingRecommendationStatus" AS ENUM ('PENDING', 'APPLIED', 'REJECTED', 'SUPERSEDED');

-- CreateTable
CREATE TABLE "PricingRecommendation" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "offerId" TEXT NOT NULL,
    "status" "PricingRecommendationStatus" NOT NULL DEFAULT 'PENDING',
    "fromPrice" DECIMAL(12,2) NOT NULL,
    "proposedPrice" DECIMAL(12,2) NOT NULL,
    "multiplier" DOUBLE PRECISION NOT NULL,
    "direction" TEXT NOT NULL,
    "deltaPercent" DOUBLE PRECISION NOT NULL,
    "explanation" TEXT NOT NULL,
    "payload" JSONB NOT NULL,
    "createdById" TEXT,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "reviewNote" TEXT,
    "appliedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PricingRecommendation_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "PricingRecommendation_eventId_status_idx" ON "PricingRecommendation"("eventId", "status");

-- CreateIndex
CREATE INDEX "PricingRecommendation_offerId_status_idx" ON "PricingRecommendation"("offerId", "status");

-- CreateIndex
CREATE INDEX "PricingRecommendation_organizationId_idx" ON "PricingRecommendation"("organizationId");

-- AddForeignKey
ALTER TABLE "PricingRecommendation" ADD CONSTRAINT "PricingRecommendation_eventId_fkey" FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PricingRecommendation" ADD CONSTRAINT "PricingRecommendation_offerId_fkey" FOREIGN KEY ("offerId") REFERENCES "Offer"("id") ON DELETE CASCADE ON UPDATE CASCADE;
