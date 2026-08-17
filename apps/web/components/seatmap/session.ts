/**
 * Punto único de entrada del subsistema de mapa a la identidad de invitado.
 *
 * La implementación vive en `@/lib/guest-session` (la escribió el trabajo de
 * checkout en paralelo). Es DELIBERADO no tener una copia aquí: el API cuenta
 * el tope de 10 boletos y comprueba la propiedad del hold POR `sessionId`, así
 * que dos módulos con dos claves de `localStorage` distintas darían dos
 * identidades en el mismo navegador — el comprador vería «tope alcanzado» con
 * 5 boletos y no podría liberar sus propios holds.
 *
 * Este archivo se queda como indirección: si la implementación se mueve, sólo
 * cambia esta línea y no los cinco sitios que la usan.
 */

export {
  getGuestSessionId,
  peekGuestSessionId,
  resetGuestSessionId,
  withGuestSession,
  GUEST_SESSION_STORAGE_KEY,
} from '@/lib/guest-session';
