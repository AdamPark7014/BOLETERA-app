-- siteContent estaba en el schema sin migración: una base creada solo con
-- `migrate deploy` no tenía la columna. IF NOT EXISTS: las bases que ya la
-- recibieron con `db push` no cambian.
ALTER TABLE "TenantTheme" ADD COLUMN IF NOT EXISTS "siteContent" JSONB;
