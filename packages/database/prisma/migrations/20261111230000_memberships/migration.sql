-- Membresías: planes, membresías de usuario, periodos cobrados (alta/renovación),
-- beneficios y sus canjes. Aditiva: no toca tablas existentes.

-- CreateEnum
CREATE TYPE "MembershipBillingPeriod" AS ENUM ('MONTHLY', 'ANNUAL', 'SEASON');

-- CreateEnum
CREATE TYPE "MembershipStatus" AS ENUM ('ACTIVE', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MembershipPeriodKind" AS ENUM ('NEW', 'RENEWAL');

-- CreateTable
CREATE TABLE "MembershipPlan" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "tier" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL(12,2) NOT NULL,
    "currency" "Currency" NOT NULL DEFAULT 'MXN',
    "billingPeriod" "MembershipBillingPeriod" NOT NULL DEFAULT 'ANNUAL',
    "maxMembers" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MembershipPlan_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Membership" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "MembershipStatus" NOT NULL DEFAULT 'ACTIVE',
    "startedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "cancelledAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Membership_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MembershipPeriod" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "kind" "MembershipPeriodKind" NOT NULL DEFAULT 'NEW',
    "startsAt" TIMESTAMP(3) NOT NULL,
    "endsAt" TIMESTAMP(3) NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "recordedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MembershipPeriod_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MembershipBenefit" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "description" TEXT,
    "redemptionLimit" INTEGER,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "MembershipBenefit_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MembershipBenefitRedemption" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "benefitId" TEXT NOT NULL,
    "membershipId" TEXT NOT NULL,
    "note" TEXT,
    "recordedById" TEXT,
    "redeemedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MembershipBenefitRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "MembershipPlan_organizationId_idx" ON "MembershipPlan"("organizationId");

-- CreateIndex
CREATE UNIQUE INDEX "MembershipPlan_organizationId_slug_key" ON "MembershipPlan"("organizationId", "slug");

-- CreateIndex
CREATE INDEX "Membership_organizationId_idx" ON "Membership"("organizationId");

-- CreateIndex
CREATE INDEX "Membership_organizationId_expiresAt_idx" ON "Membership"("organizationId", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Membership_planId_userId_key" ON "Membership"("planId", "userId");

-- CreateIndex
CREATE INDEX "MembershipPeriod_membershipId_startsAt_idx" ON "MembershipPeriod"("membershipId", "startsAt");

-- CreateIndex
CREATE INDEX "MembershipPeriod_organizationId_startsAt_idx" ON "MembershipPeriod"("organizationId", "startsAt");

-- CreateIndex
CREATE INDEX "MembershipBenefit_organizationId_idx" ON "MembershipBenefit"("organizationId");

-- CreateIndex
CREATE INDEX "MembershipBenefit_planId_idx" ON "MembershipBenefit"("planId");

-- CreateIndex
CREATE INDEX "MembershipBenefitRedemption_benefitId_idx" ON "MembershipBenefitRedemption"("benefitId");

-- CreateIndex
CREATE INDEX "MembershipBenefitRedemption_membershipId_idx" ON "MembershipBenefitRedemption"("membershipId");

-- CreateIndex
CREATE INDEX "MembershipBenefitRedemption_organizationId_redeemedAt_idx" ON "MembershipBenefitRedemption"("organizationId", "redeemedAt");

-- AddForeignKey
ALTER TABLE "MembershipPlan" ADD CONSTRAINT "MembershipPlan_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MembershipPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Membership" ADD CONSTRAINT "Membership_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipPeriod" ADD CONSTRAINT "MembershipPeriod_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipBenefit" ADD CONSTRAINT "MembershipBenefit_planId_fkey" FOREIGN KEY ("planId") REFERENCES "MembershipPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipBenefitRedemption" ADD CONSTRAINT "MembershipBenefitRedemption_benefitId_fkey" FOREIGN KEY ("benefitId") REFERENCES "MembershipBenefit"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MembershipBenefitRedemption" ADD CONSTRAINT "MembershipBenefitRedemption_membershipId_fkey" FOREIGN KEY ("membershipId") REFERENCES "Membership"("id") ON DELETE CASCADE ON UPDATE CASCADE;
