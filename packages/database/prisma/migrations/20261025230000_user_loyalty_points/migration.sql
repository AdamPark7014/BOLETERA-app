-- Saldo de puntos de lealtad. Lo escribe awardLoyaltyPoints al pagar.
ALTER TABLE "User" ADD COLUMN "loyaltyPoints" INTEGER NOT NULL DEFAULT 0;
