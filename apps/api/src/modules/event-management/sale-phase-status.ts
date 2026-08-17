import { SalePhaseStatus } from '@prisma/client';

export type PhaseStatusInput = {
  status: SalePhaseStatus;
  startsAt: Date;
  endsAt: Date;
};

/**
 * Estado real de una fase en un instante dado.
 *
 * Es una FUNCIÓN PURA a propósito: el estado que se muestra se deriva del reloj
 * en cada lectura, así que no puede quedarse congelado aunque el proceso que lo
 * persiste no llegue a correr. Persistirlo (ver `syncPhaseStatuses`) sirve para
 * que los informes y las consultas por estado cuadren, no para que la API diga
 * la verdad — eso ya lo garantiza esta función.
 *
 * `CANCELLED` y `ENDED` son PEGAJOSOS: los pone una persona (cancelar la fase,
 * o cerrarla antes de su hora) y el reloj no puede revertir esa decisión. Es la
 * misma regla que ya aplica `checkSaleWindow` al excluirlos de la consulta.
 * Quien quiera revivir una fase terminada debe mover sus fechas: `updateSalePhase`
 * recalcula el estado cuando eso pasa.
 */
export function resolvePhaseStatus(phase: PhaseStatusInput, at: Date = new Date()): SalePhaseStatus {
  if (phase.status === SalePhaseStatus.CANCELLED || phase.status === SalePhaseStatus.ENDED) {
    return phase.status;
  }
  if (at < phase.startsAt) return SalePhaseStatus.SCHEDULED;
  if (at >= phase.endsAt) return SalePhaseStatus.ENDED;
  return SalePhaseStatus.ACTIVE;
}

/** Reescribe el estado de una fase con el derivado, sin tocar el resto. */
export function withResolvedStatus<T extends PhaseStatusInput>(phase: T, at: Date = new Date()): T {
  return { ...phase, status: resolvePhaseStatus(phase, at) };
}
