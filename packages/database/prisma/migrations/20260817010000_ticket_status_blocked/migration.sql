-- Valor de enum en migración propia: en PostgreSQL un valor recién añadido no
-- puede usarse dentro de la misma transacción que lo crea, así que la tabla
-- `InventoryBlock` (que escribe boletos en BLOCKED) va en la migración siguiente.

-- AlterEnum
ALTER TYPE "TicketStatus" ADD VALUE 'BLOCKED';
