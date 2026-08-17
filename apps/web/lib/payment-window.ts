/**
 * Ventana de pago por método, vista desde el cliente.
 *
 * El servidor es la única fuente de verdad (`apps/api/src/common/payment-window.ts`,
 * configurable por entorno) y devuelve la fecha límite real en `order.expiresAt`
 * al crear la orden. Aquí solo hay dos cosas:
 *
 *   1. Valores por defecto para REDACTAR antes de que exista la orden. Se
 *      enuncian como aproximación («hasta 24 h») y nunca como una promesa con
 *      hora exacta, porque el promotor puede haberlos acortado por entorno.
 *   2. Formato de las cuentas atrás y de las fechas límite reales.
 *
 * Un contador de 15 minutos delante de una referencia OXXO que vive 24 h miente
 * igual de mal que uno de 24 h delante de un hold que muere en 15.
 */

export type PaymentMethodId = 'CARD' | 'SPEI' | 'OXXO';

/** Aproximación por defecto del API; solo para textos previos a la orden. */
const DEFAULT_WINDOW_HOURS: Record<PaymentMethodId, number> = {
  CARD: 0.5,
  SPEI: 12,
  OXXO: 24,
};

export function isDeferredMethod(method: string | null | undefined): boolean {
  const m = (method ?? '').toUpperCase();
  return m === 'OXXO' || m === 'SPEI';
}

/** «hasta 24 horas», «unos 30 minutos». Aproximado a propósito. */
export function approxPaymentWindowLabel(method: string | null | undefined): string {
  const hours = DEFAULT_WINDOW_HOURS[(method ?? '').toUpperCase() as PaymentMethodId];
  if (!hours) return 'unos minutos';
  if (hours < 1) return `unos ${Math.round(hours * 60)} minutos`;
  return `hasta ${hours} horas`;
}

/** Frase completa para el selector de método, antes de generar la referencia. */
export function paymentWindowNotice(method: string | null | undefined): string {
  const upper = (method ?? '').toUpperCase();
  if (upper === 'OXXO') {
    return `Al confirmar generamos tu referencia OXXO y apartamos tus lugares ${approxPaymentWindowLabel('OXXO')}. Te mostramos la fecha límite exacta en la siguiente pantalla.`;
  }
  if (upper === 'SPEI') {
    return `Al confirmar generamos tu CLABE y referencia SPEI y apartamos tus lugares ${approxPaymentWindowLabel('SPEI')}. Te mostramos la fecha límite exacta en la siguiente pantalla.`;
  }
  return 'El cargo se realiza en el momento. Tus lugares están apartados mientras completas el formulario.';
}

export function secondsUntil(iso: string | null | undefined): number {
  if (!iso) return 0;
  const ms = new Date(iso).getTime();
  if (!Number.isFinite(ms)) return 0;
  return Math.max(0, Math.floor((ms - Date.now()) / 1000));
}

/**
 * `mm:ss` si queda menos de una hora, `h:mm:ss` si queda más. Sin esto, una
 * ventana de 24 h se veía como «1440:00», que no se lee como tiempo.
 */
export function formatCountdown(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  const mm = String(minutes).padStart(2, '0');
  const ss = String(seconds).padStart(2, '0');
  return hours > 0 ? `${hours}:${mm}:${ss}` : `${mm}:${ss}`;
}

/** Versión hablada, para lectores de pantalla y avisos. */
export function describeRemaining(totalSeconds: number): string {
  const safe = Math.max(0, Math.floor(totalSeconds));
  if (safe === 0) return 'sin tiempo restante';
  const hours = Math.floor(safe / 3600);
  const minutes = Math.floor((safe % 3600) / 60);
  const seconds = safe % 60;
  if (hours > 0) {
    return `${hours} hora${hours === 1 ? '' : 's'} y ${minutes} minuto${minutes === 1 ? '' : 's'}`;
  }
  if (minutes > 0) {
    return `${minutes} minuto${minutes === 1 ? '' : 's'} y ${seconds} segundo${seconds === 1 ? '' : 's'}`;
  }
  return `${seconds} segundo${seconds === 1 ? '' : 's'}`;
}

/** Fecha límite absoluta y legible: «sáb 16 ago, 18:45 h». */
export function formatDeadline(iso: string | null | undefined): string | null {
  if (!iso) return null;
  const date = new Date(iso);
  if (!Number.isFinite(date.getTime())) return null;
  const formatted = date.toLocaleString('es-MX', {
    weekday: 'short',
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  });
  return `${formatted} h`;
}
