/**
 * Plazo comprometido de reembolso. ÚNICO sitio donde se define en el front.
 *
 * Espejo de `apps/api/src/modules/notification/refund-policy.ts`. La regla que
 * este archivo existe para hacer cumplir: NINGUNA pantalla escribe un plazo por
 * su cuenta. Si la orden dice «10 días» y el correo «5-7 días hábiles», el
 * comprador no sabe a cuál creerle y llama — que es la queja número uno de las
 * plataformas grandes, por encima de la tardanza misma.
 *
 * Las variables son la pareja `NEXT_PUBLIC_REFUND_*` de las `REFUND_*` del API
 * y deben desplegarse con el MISMO valor. Next.js las sustituye en compilación,
 * así que sirven igual en servidor y en cliente. (Lo correcto sería un paquete
 * compartido entre ambos runtimes, pero `packages/**` queda fuera de este
 * cambio.)
 */

export type RefundPolicy = {
  /** Días hábiles que nos damos para liquidarlo en el portal del banco. */
  settlementBusinessDays: number;
  /** Días hábiles que el banco emisor añade para reflejar el abono. */
  bankBusinessDays: number;
};

const DEFAULT_SETTLEMENT_BUSINESS_DAYS = 5;
const DEFAULT_BANK_BUSINESS_DAYS = 10;

function readDays(raw: string | undefined, fallback: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 1 || value > 90) return fallback;
  return Math.round(value);
}

export const REFUND_POLICY: RefundPolicy = {
  settlementBusinessDays: readDays(
    process.env.NEXT_PUBLIC_REFUND_SETTLEMENT_BUSINESS_DAYS,
    DEFAULT_SETTLEMENT_BUSINESS_DAYS,
  ),
  bankBusinessDays: readDays(
    process.env.NEXT_PUBLIC_REFUND_BANK_BUSINESS_DAYS,
    DEFAULT_BANK_BUSINESS_DAYS,
  ),
};

/**
 * Suma días hábiles saltando fin de semana.
 *
 * No descuenta festivos oficiales: por eso todo texto dice «a más tardar el»,
 * nunca «el». Una fecha exacta que un puente mueve es una promesa incumplida.
 */
export function addBusinessDays(from: Date, days: number): Date {
  const result = new Date(from.getTime());
  let remaining = Math.max(0, Math.round(days));
  while (remaining > 0) {
    result.setDate(result.getDate() + 1);
    const day = result.getDay();
    if (day !== 0 && day !== 6) remaining--;
  }
  return result;
}

export type RefundDeadlines = { sentBy: Date; visibleBy: Date };

/**
 * `from` es la fecha en que se asentó la devolución, no «hoy»: si contara desde
 * el render, la fecha prometida se correría cada vez que el comprador recarga.
 */
export function refundDeadlines(from: Date, policy: RefundPolicy = REFUND_POLICY): RefundDeadlines {
  const sentBy = addBusinessDays(from, policy.settlementBusinessDays);
  return { sentBy, visibleBy: addBusinessDays(sentBy, policy.bankBusinessDays) };
}

export function formatPolicyDate(date: Date): string {
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('es-MX', {
    weekday: 'long',
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
}

/** Fecha corta para listados, donde no cabe la larga. */
export function formatShortDate(value: string | Date | null | undefined): string {
  if (!value) return '—';
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleDateString('es-MX', { day: 'numeric', month: 'long', year: 'numeric' });
}

/** Por qué medio vuelve el dinero. Mismo criterio que el API. */
export function refundMethodLabel(method?: string | null): string {
  switch (String(method ?? '').toUpperCase()) {
    case 'CARD':
    case 'CLIP':
      return 'la misma tarjeta con la que pagaste';
    case 'APPLE_PAY':
      return 'la tarjeta que usaste en Apple Pay';
    case 'GOOGLE_PAY':
      return 'la tarjeta que usaste en Google Pay';
    case 'PAYPAL':
      return 'tu cuenta de PayPal';
    case 'SPEI':
    case 'BANK_TRANSFER':
      return 'transferencia SPEI a la cuenta desde la que pagaste';
    case 'OXXO':
    case 'CASH':
    case 'LOCAL_PAYMENT':
      return 'transferencia SPEI a la cuenta bancaria que nos indiques';
    default:
      return 'el mismo medio con el que pagaste';
  }
}

export function refundNeedsBankAccount(method?: string | null): boolean {
  const value = String(method ?? '').toUpperCase();
  return value === 'OXXO' || value === 'CASH' || value === 'LOCAL_PAYMENT';
}

export type RefundStatusCopy = {
  headline: string;
  detail: string;
  /** Tono visual. Nunca es el único portador del significado (WCAG 1.4.1). */
  tone: 'progress' | 'done' | 'alert';
};

/**
 * Qué se le dice al comprador en cada estado.
 *
 * `PENDING` no se traduce como «pendiente». Esa palabra no informa de nada y es
 * la que provoca la llamada: hay que decir qué falta, quién lo hace y cuándo.
 */
export function refundStatusCopy(
  status: string | null | undefined,
  args: { methodLabel: string; sentBy: string; visibleBy: string },
): RefundStatusCopy {
  switch (String(status ?? 'PENDING').toUpperCase()) {
    case 'COMPLETED':
      return {
        tone: 'done',
        headline: 'Reembolso enviado a tu banco',
        detail:
          `Ya salió de nuestras manos por ${args.methodLabel}. De aquí en adelante depende de tu ` +
          `banco: lo verás abonado a más tardar el ${args.visibleBy}. Si ese día no aparece, ` +
          'escríbenos con el número de orden y lo reclamamos nosotros.',
      };
    case 'FAILED':
      return {
        tone: 'alert',
        headline: 'El envío del reembolso falló',
        detail:
          'El banco rechazó el movimiento. No perdiste el dinero: la devolución sigue registrada ' +
          'a tu nombre y la reintentamos. Te avisamos por correo en cuanto salga.',
      };
    case 'DISPUTED':
      return {
        tone: 'alert',
        headline: 'Reembolso en revisión con el banco',
        detail:
          'Hay una aclaración abierta sobre este cargo. Mientras se resuelve no podemos enviar el ' +
          'abono; te avisamos en cuanto haya respuesta.',
      };
    default:
      return {
        tone: 'progress',
        headline: 'Reembolso aprobado, en camino a tu banco',
        detail:
          `Está autorizado y el importe apartado. Falta un paso nuestro: liquidarlo en el portal ` +
          `del banco, que no es automático. Sale por ${args.methodLabel} a más tardar el ` +
          `${args.sentBy}, y tu banco lo refleja a más tardar el ${args.visibleBy}. No tienes que ` +
          'hacer nada.',
      };
  }
}

export const COMPENSATION_LEGAL_NOTE =
  'La Ley Federal de Protección al Consumidor (art. 92 Bis) obliga a devolver el importe ' +
  'completo —cargo por servicio incluido— y, cuando la cancelación es imputable al organizador, ' +
  'a pagar además una bonificación mínima del 20 %. Esa bonificación no es parte de tu ' +
  'devolución: es una indemnización que se suma.';

/**
 * Fila de `Refund` tal y como la devolvería el API.
 *
 * Opcional a propósito: hoy `GET /orders/:publicId` NO incluye `refunds` (vive
 * en el módulo `orders`, fuera de este cambio). La vista se escribe contra este
 * contrato para que el día que se añada el `include` funcione sin tocar el
 * front, y mientras tanto degrada al estado de la orden.
 */
export type OrderRefund = {
  id?: string;
  amount: string | number;
  status: string;
  reason?: string | null;
  notes?: string | null;
  requestedAt?: string | null;
  processedAt?: string | null;
};

/** Prefijo con el que `EventCancellationService` marca la bonificación. */
const COMPENSATION_NOTE_PREFIX = 'BONIFICACIÓN';

export function isCompensationRefund(refund: OrderRefund): boolean {
  return Boolean(refund.notes?.trimStart().startsWith(COMPENSATION_NOTE_PREFIX));
}

export type RefundSummary = {
  /** Devolución de lo cobrado (sin la bonificación). */
  refundedTotal: number;
  /** Indemnización del art. 92 Bis, aparte. */
  compensationTotal: number;
  /** Estado de la devolución que manda en el mensaje. */
  status: string;
  /** Cuándo se asentó: origen del cómputo del plazo. */
  requestedAt: Date | null;
  /** Motivo legible, si la nota lo trae. */
  reason: string | null;
};

/**
 * Resume los `Refund` de una orden separando devolución de bonificación.
 *
 * Sumarlas sería contar de más y, peor, borrar la distinción que el art. 92 Bis
 * establece: una repara el cobro, la otra indemniza.
 */
export function summarizeRefunds(refunds: OrderRefund[] | null | undefined): RefundSummary | null {
  if (!refunds?.length) return null;

  let refundedTotal = 0;
  let compensationTotal = 0;
  const settlement: OrderRefund[] = [];

  for (const refund of refunds) {
    const amount = Number(refund.amount) || 0;
    if (isCompensationRefund(refund)) {
      compensationTotal += amount;
    } else {
      refundedTotal += amount;
      settlement.push(refund);
    }
  }

  // Si alguna devolución sigue abierta, esa es la que manda: el comprador
  // necesita saber que aún espera, no que «una» ya se cerró.
  const open = settlement.find((r) => String(r.status).toUpperCase() === 'PENDING');
  const failed = settlement.find((r) =>
    ['FAILED', 'DISPUTED'].includes(String(r.status).toUpperCase()),
  );
  const leading = failed ?? open ?? settlement[settlement.length - 1] ?? refunds[0];
  const requestedAt = leading?.requestedAt ? new Date(leading.requestedAt) : null;

  return {
    refundedTotal,
    compensationTotal,
    status: String(leading?.status ?? 'PENDING').toUpperCase(),
    requestedAt: requestedAt && !Number.isNaN(requestedAt.getTime()) ? requestedAt : null,
    reason: leading?.notes?.trim() || null,
  };
}

/**
 * ¿Esta orden tiene dinero de vuelta que contar?
 *
 * `PENDING_REFUND` entra: es dinero cobrado que no se pudo emitir en boletos.
 * Desde fuera es indistinguible de un reembolso, y callarlo deja al comprador
 * con un cargo y sin boletos ni explicación.
 */
export function orderHasRefund(status: string | null | undefined): boolean {
  return ['REFUNDED', 'PARTIALLY_REFUNDED', 'PENDING_REFUND'].includes(
    String(status ?? '').toUpperCase(),
  );
}

/**
 * Mensaje cuando la orden dice que hay reembolso pero el API no trajo detalle.
 *
 * Sin las filas de `Refund` no se puede afirmar un importe ni una fecha, así
 * que aquí NO se inventa ninguno: se dice lo que sí se sabe.
 */
export function refundFallbackCopy(orderStatus: string | null | undefined): RefundStatusCopy | null {
  switch (String(orderStatus ?? '').toUpperCase()) {
    case 'REFUNDED':
      return {
        tone: 'done',
        headline: 'Orden reembolsada',
        detail:
          'Te devolvimos el importe completo de esta orden, con el cargo por servicio y el IVA ' +
          'incluidos, por el mismo medio con el que pagaste. El detalle y las fechas están en el ' +
          'correo de reembolso que te enviamos.',
      };
    case 'PARTIALLY_REFUNDED':
      return {
        tone: 'done',
        headline: 'Orden reembolsada en parte',
        detail:
          'Te devolvimos una parte de esta orden por el mismo medio con el que pagaste. El importe ' +
          'exacto y las fechas están en el correo de reembolso que te enviamos.',
      };
    case 'PENDING_REFUND':
      return {
        tone: 'progress',
        headline: 'Te cobramos, pero no pudimos entregarte los boletos',
        detail:
          'Tu pago llegó fuera de la ventana de reserva o por un importe distinto, así que no se ' +
          'pudieron emitir los boletos. No se queda nada: la devolución está en proceso y te ' +
          'escribimos en cuanto quede autorizada, con el importe y la fecha.',
      };
    default:
      return null;
  }
}
