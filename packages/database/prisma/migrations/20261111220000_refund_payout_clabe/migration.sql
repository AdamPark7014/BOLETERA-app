-- CLABE del comprador para reembolsos SPEI/OXXO. Aditiva: columnas opcionales.
ALTER TABLE "Refund" ADD COLUMN "payoutClabe" VARCHAR(18);
ALTER TABLE "Refund" ADD COLUMN "payoutAccountHolder" VARCHAR(120);
ALTER TABLE "Refund" ADD COLUMN "payoutClabeAt" TIMESTAMP(3);
