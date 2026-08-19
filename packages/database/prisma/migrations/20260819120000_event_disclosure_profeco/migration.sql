-- Divulgacion previa a la venta exigida por PROFECO.
--
-- Lineamientos publicados en el DOF el 19 de febrero de 2026: para eventos de
-- mas de 20.000 asistentes hay que publicar, al menos 24 HORAS antes de la
-- primera venta, el plano con secciones, el numero de asientos por seccion, los
-- terminos y el PRECIO TOTAL por seccion.
--
-- Se guarda el contenido entero, no una fecha: ante una auditoria hay que poder
-- probar QUE se publico, no solo cuando. Las filas no se actualizan nunca —
-- republicar inserta otra— porque el historial es la prueba.

CREATE TABLE "EventDisclosure" (
    "id" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "publishedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "payload" JSONB NOT NULL,
    "contentHash" TEXT NOT NULL,
    "capacity" INTEGER NOT NULL,
    "publishedBy" TEXT,

    CONSTRAINT "EventDisclosure_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "EventDisclosure_eventId_publishedAt_idx"
    ON "EventDisclosure"("eventId", "publishedAt");

ALTER TABLE "EventDisclosure"
    ADD CONSTRAINT "EventDisclosure_eventId_fkey"
    FOREIGN KEY ("eventId") REFERENCES "Event"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- El aforo no puede ser negativo: decide si aplicaban los lineamientos, asi que
-- un valor absurdo aqui es una defensa legal invalida.
ALTER TABLE "EventDisclosure"
    ADD CONSTRAINT "EventDisclosure_capacity_nonneg" CHECK ("capacity" >= 0);
