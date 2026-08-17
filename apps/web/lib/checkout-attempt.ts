'use client';

/**
 * `Idempotency-Key` estable por intento de compra.
 *
 * El API responde a una clave repetida devolviendo la orden ya creada en vez de
 * volver a cobrar. Eso solo sirve si el cliente MANTIENE la clave: generar un
 * `crypto.randomUUID()` dentro del `onClick` —como se hacía— convertía cada
 * reintento tras un timeout en un cobro nuevo, que es exactamente el caso que
 * la cabecera existe para evitar.
 *
 * La clave vive en `sessionStorage` (dura lo que la pestaña, no el navegador) y
 * está atada a una huella del intento. Si cambia lo que se cobra —otras
 * butacas, otro método, otro cupón— la huella cambia y nace una clave nueva:
 * reutilizarla devolvería la orden anterior y el comprador pagaría algo
 * distinto de lo que ve.
 */

const STORAGE_KEY = 'boletera_checkout_attempt';

type StoredAttempt = { fingerprint: string; key: string };

function randomKey(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 14)}`;
}

/**
 * Huella del intento: todo lo que, si cambia, tiene que producir otra orden.
 * Los holds se ordenan para que reordenar la selección no invente un intento
 * nuevo.
 */
export function checkoutFingerprint(input: {
  eventId: string;
  holdIds: string[];
  paymentMethod: string;
  promotionCode?: string;
}): string {
  return [
    input.eventId,
    [...input.holdIds].sort().join(','),
    input.paymentMethod,
    input.promotionCode?.trim().toUpperCase() ?? '',
  ].join('|');
}

/** Clave para esta huella: la misma mientras el intento no cambie. */
export function getCheckoutIdempotencyKey(fingerprint: string): string {
  if (typeof window === 'undefined') return randomKey();
  try {
    const raw = window.sessionStorage.getItem(STORAGE_KEY);
    if (raw) {
      const stored = JSON.parse(raw) as StoredAttempt;
      if (stored?.fingerprint === fingerprint && stored.key) return stored.key;
    }
    const fresh: StoredAttempt = { fingerprint, key: randomKey() };
    window.sessionStorage.setItem(STORAGE_KEY, JSON.stringify(fresh));
    return fresh.key;
  } catch {
    return randomKey();
  }
}

/** Se llama al confirmar la orden: el intento terminó, la clave ya no aplica. */
export function clearCheckoutAttempt(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(STORAGE_KEY);
  } catch {
    /* nada que hacer */
  }
}
