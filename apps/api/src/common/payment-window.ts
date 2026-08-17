/**
 * Ventana de pago por método — fuente única de verdad.
 *
 * Tres relojes tienen que contar lo mismo, y antes contaban distinto:
 *
 *   1. `SeatHold.expiresAt`  — cuándo el worker devuelve la butaca a la venta
 *   2. `Order.expiresAt`     — cuándo la orden se considera abandonada
 *   3. `PaymentIntent.expiresAt` — hasta cuándo vale la referencia OXXO/SPEI
 *
 * El hold duraba 15 min y la referencia OXXO no caducaba nunca. Resultado: el
 * worker liberaba la butaca, se revendía, y el pago tardío la reasignaba
 * pisando al comprador legítimo (F1-03). Tras el endurecimiento ese robo ya no
 * ocurre —el pago tardío termina en `PENDING_REFUND`—, pero si los relojes
 * siguen descuadrados el sistema le promete al comprador días para pagar en el
 * OXXO y le suelta el lugar a los quince minutos. Eso no es un fallo técnico:
 * es prometer algo que no se piensa cumplir, y se paga en devoluciones.
 *
 * Por eso la ventana es una sola y gobierna los tres relojes.
 *
 * DECISIÓN DE NEGOCIO, no técnica: mantener inventario reservado 24 h por una
 * referencia OXXO impagada tiene un costo real en un onsale con demanda. Los
 * valores por defecto son conservadores; ajústalos con las variables de entorno
 * según lo que el promotor esté dispuesto a inmovilizar.
 */

const HOURS = 60 * 60 * 1000;
const MINUTES = 60 * 1000;

function envMs(name: string, fallbackMs: number): number {
  const hours = Number(process.env[name]);
  return Number.isFinite(hours) && hours > 0 ? hours * HOURS : fallbackMs;
}

/** Milisegundos que el comprador tiene para pagar, y que el lugar queda reservado. */
export function paymentWindowMs(method: string | null | undefined): number {
  switch ((method ?? '').toUpperCase()) {
    case 'OXXO':
      return envMs('PAYMENT_WINDOW_OXXO_HOURS', 24 * HOURS);
    case 'SPEI':
      return envMs('PAYMENT_WINDOW_SPEI_HOURS', 12 * HOURS);
    default:
      // Tarjeta y efectivo se resuelven en el acto; la ventana solo cubre el
      // tiempo de completar el formulario y volver de la pasarela.
      return envMs('PAYMENT_WINDOW_DEFAULT_MINUTES', 30 * MINUTES);
  }
}

/** Fecha límite absoluta a partir de ahora. */
export function paymentDeadline(method: string | null | undefined, from = Date.now()): Date {
  return new Date(from + paymentWindowMs(method));
}

/** `true` si el método se liquida fuera de línea y necesita ventana larga. */
export function isDeferredMethod(method: string | null | undefined): boolean {
  const m = (method ?? '').toUpperCase();
  return m === 'OXXO' || m === 'SPEI';
}
