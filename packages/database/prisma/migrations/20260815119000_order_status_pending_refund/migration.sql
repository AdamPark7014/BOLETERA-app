-- Se separa en su propia migración: en PostgreSQL un valor de enum recién
-- añadido no puede usarse dentro de la misma transacción que lo crea.
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'PENDING_REFUND';
