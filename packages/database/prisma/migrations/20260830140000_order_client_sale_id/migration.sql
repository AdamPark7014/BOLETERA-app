-- Durable POS client sale id on Order (replaces JSON-only dedupe in taquilla sync).
ALTER TABLE "Order" ADD COLUMN "clientSaleId" TEXT;

-- Backfill from posOps JSON. If duplicates already exist (the race this
-- migration hardens against), keep the oldest row's key and leave the rest NULL.
WITH ranked AS (
  SELECT
    id,
    "organizationId",
    "posOps"->>'clientSaleId' AS sale_id,
    ROW_NUMBER() OVER (
      PARTITION BY "organizationId", "posOps"->>'clientSaleId'
      ORDER BY "createdAt" ASC
    ) AS rn
  FROM "Order"
  WHERE "posOps" IS NOT NULL
    AND NULLIF(TRIM("posOps"->>'clientSaleId'), '') IS NOT NULL
)
UPDATE "Order" o
SET "clientSaleId" = ranked.sale_id
FROM ranked
WHERE o.id = ranked.id
  AND ranked.rn = 1;

-- Partial unique: multiple NULL clientSaleId values remain allowed (non-POS orders).
CREATE UNIQUE INDEX "Order_organizationId_clientSaleId_key"
  ON "Order"("organizationId", "clientSaleId");
