-- Version de la clave de firma del QR de cada boleto.
--
-- La clave se deriva de `HMAC(maestro, ticketId:eventId)`, y ninguno de los dos
-- cambia al transferir el boleto. Resultado: el telefono de quien lo regalaba
-- seguia generando codigos validos y el mismo boleto servia a dos personas.
--
-- Con esto, aceptar una transferencia sube la version y la clave anterior muere.
-- El valor 0 reproduce la clave de siempre, de modo que las carteras ya
-- descargadas siguen funcionando y el despliegue no deja a nadie fuera.
ALTER TABLE "Ticket" ADD COLUMN "keyEpoch" INTEGER NOT NULL DEFAULT 0;

-- No puede retroceder: bajar la version resucitaria una clave ya invalidada.
ALTER TABLE "Ticket" ADD CONSTRAINT "Ticket_keyEpoch_nonneg" CHECK ("keyEpoch" >= 0);

-- UNA sola transferencia pendiente por boleto.
--
-- Se podia ofrecer el mismo boleto a dos personas a la vez: ambas recibian su
-- codigo y ambas lo aceptaban. El indice es PARCIAL porque solo las pendientes
-- estorban: un boleto puede acumular todas las transferencias aceptadas,
-- canceladas o expiradas que haga falta a lo largo de su vida.
-- Si el defecto llego a usarse ya existen duplicados, y el indice chocaria a
-- mitad de migracion. Se conserva la oferta MAS RECIENTE de cada boleto y las
-- anteriores se cancelan: es la unica opcion que no inventa un ganador, porque
-- la ultima oferta es la unica que el dueño aun cree vigente.
UPDATE "TicketTransfer" t
   SET "status" = 'CANCELLED'
 WHERE t."status" = 'PENDING'
   AND EXISTS (
     SELECT 1 FROM "TicketTransfer" mas_reciente
      WHERE mas_reciente."ticketId" = t."ticketId"
        AND mas_reciente."status" = 'PENDING'
        AND mas_reciente."createdAt" > t."createdAt"
   );

CREATE UNIQUE INDEX "TicketTransfer_one_pending_per_ticket"
    ON "TicketTransfer"("ticketId")
    WHERE "status" = 'PENDING';
