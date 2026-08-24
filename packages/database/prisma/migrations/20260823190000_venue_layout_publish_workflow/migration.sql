-- Venue layout publish/versioning workflow (Draft → Review → Published → Archived)

CREATE TYPE "LayoutPublishStatus" AS ENUM ('DRAFT', 'IN_REVIEW', 'PUBLISHED', 'ARCHIVED');

ALTER TABLE "VenueLayout"
  ADD COLUMN "publishStatus" "LayoutPublishStatus" NOT NULL DEFAULT 'DRAFT',
  ADD COLUMN "publishedAt" TIMESTAMP(3),
  ADD COLUMN "publishedBy" TEXT,
  ADD COLUMN "reviewSubmittedAt" TIMESTAMP(3),
  ADD COLUMN "reviewSubmittedBy" TEXT,
  ADD COLUMN "archivedAt" TIMESTAMP(3),
  ADD COLUMN "archivedBy" TEXT;

CREATE INDEX "VenueLayout_venueId_publishStatus_idx" ON "VenueLayout"("venueId", "publishStatus");

CREATE TABLE "VenueLayoutSnapshot" (
  "id" TEXT NOT NULL,
  "layoutId" TEXT NOT NULL,
  "version" INTEGER NOT NULL,
  "mapData" JSONB NOT NULL,
  "metadata" JSONB,
  "publishStatus" "LayoutPublishStatus" NOT NULL,
  "label" TEXT,
  "createdBy" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

  CONSTRAINT "VenueLayoutSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "VenueLayoutSnapshot_layoutId_version_idx" ON "VenueLayoutSnapshot"("layoutId", "version");
CREATE INDEX "VenueLayoutSnapshot_layoutId_createdAt_idx" ON "VenueLayoutSnapshot"("layoutId", "createdAt");

ALTER TABLE "VenueLayoutSnapshot"
  ADD CONSTRAINT "VenueLayoutSnapshot_layoutId_fkey"
  FOREIGN KEY ("layoutId") REFERENCES "VenueLayout"("id") ON DELETE CASCADE ON UPDATE CASCADE;
