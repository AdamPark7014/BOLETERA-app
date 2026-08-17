/**
 * Plazo comprometido de reembolso. ÚNICO sitio donde se define en el API.
 *
 * La queja que más se repite en las plataformas grandes no es que el reembolso
 * tarde: es que nadie dice cuánto. «Me prometieron 5-7 días, llevo 8 y ahora me
 * dicen 90». Por eso el plazo no se escribe en cada plantilla ni en cada
 * pantalla —ahí se contradicen— sino aquí, y sale de variables de entorno para
 * que Operaciones lo ajuste sin tocar código ni desplegar copys distintos.
 *
 * El plazo tiene DOS tramos porque el dinero pasa por dos manos y el comprador
 * merece saber cuál está esperando:
 *
 *   1. `settlementBusinessDays` — lo que dependemos de nosotros. En producción
 *      Banorte no reembolsa por API: alguien cierra la devolución a mano en su
 *      portal. Mientras eso no pasa, el `Refund` está `PENDING`. Es NUESTRO
 *      compromiso, y por eso es el único tramo que prometemos como fecha.
 *   2. `bankBusinessDays` — lo que tarda el banco emisor en abonarlo una vez
 *      enviado. No lo controlamos; se comunica como techo, no como promesa.
 *
 * El espejo de este archivo en el front es `apps/web/lib/refund-policy.ts`.
 * Ambos leen la MISMA pareja de valores (`REFUND_*` y su gemelo
 * `NEXT_PUBLIC_REFUND_*`): si se despliegan distintos, el correo y la pantalla
 * dirían fechas diferentes, que es justo el fallo que esto viene a cerrar.
 * (El sitio natural sería un paquete compartido, pero `packages/**` está fuera
 * del alcance de este cambio.)
 */

export type RefundPolicy = {
  /** Días hábiles que nos damos para cerrar la devolución en el portal del banco. */
  settlementBusinessDays: number;
  /** Días hábiles que el banco emisor añade para reflejar el abono. */
  bankBusinessDays: number;
};

const DEFAULT_SETTLEMENT_BUSINESS_DAYS = 5;
const DEFAULT_BANK_BUSINESS_DAYS = 10;

/** Lector defensivo: un env mal escrito no puede convertirse en «0 días». */
function readDays(raw: unknown, fallback: number): number {
  const value = Number(raw);
  if (!Number.isFinite(value) || value < 1 || value > 90) return fallback;
  return Math.round(value);
}

export function refundPolicy(config?: { get(key: string): unknown }): RefundPolicy {
  const read = (key: string) => config?.get(key) ?? process.env[key];
  return {
    settlementBusinessDays: readDays(
      read('REFUND_SETTLEMENT_BUSINESS_DAYS'),
      DEFAULT_SETTLEMENT_BUSINESS_DAYS,
    ),
    bankBusinessDays: readDays(read('REFUND_BANK_BUSINESS_DAYS'), DEFAULT_BANK_BUSINESS_DAYS),
  };
}

/**
 * Suma días hábiles saltando sábado y domingo.
 *
 * NO descuenta los días festivos oficiales mexicanos: por eso los textos dicen
 * «a más tardar el», nunca «el». Prometer una fecha exacta que un puente mueve
 * es exactamente la promesa incumplida que genera la queja.
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

export type RefundDeadlines = {
  /** Fecha tope para que salga de nuestras manos hacia el banco. */
  sentBy: Date;
  /** Fecha tope para que el comprador lo vea abonado. */
  visibleBy: Date;
};

export function refundDeadlines(policy: RefundPolicy, from: Date = new Date()): RefundDeadlines {
  const sentBy = addBusinessDays(from, policy.settlementBusinessDays);
  return {
    sentBy,
    visibleBy: addBusinessDays(sentBy, policy.bankBusinessDays),
  };
}

/** Fecha larga en español, sin hora: el comprador razona en días, no en horas. */
export function formatPolicyDate(date: Date, timezone = 'America/Mexico_City'): string {
  try {
    return new Intl.DateTimeFormat('es-MX', {
      timeZone: timezone,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(date);
  } catch {
    return date.toISOString().slice(0, 10);
  }
}

/**
 * Por qué medio vuelve el dinero.
 *
 * La ley y el sentido común coinciden: se devuelve por el mismo medio con el
 * que se pagó. OXXO y efectivo son la excepción física —no hay a dónde
 * «devolver» un billete— y ahí se dice la verdad: hace falta una cuenta.
 */
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
      return 'transferencia SPEI a la cuenta bancaria que nos indiques (pagaste en efectivo, así que necesitamos una CLABE)';
    default:
      return 'el mismo medio con el que pagaste';
  }
}

/** ¿Hay que pedirle una CLABE al comprador para poder pagarle? */
export function refundNeedsBankAccount(method?: string | null): boolean {
  const value = String(method ?? '').toUpperCase();
  return value === 'OXXO' || value === 'CASH' || value === 'LOCAL_PAYMENT';
}

export type RefundStatusCopy = {
  /** Titular corto, en palabras del comprador. */
  headline: string;
  /** Qué significa exactamente y qué sigue. */
  detail: string;
};

/**
 * Qué se le dice al comprador en cada estado.
 *
 * `PENDING` NO se traduce como «pendiente»: esa palabra no dice nada y es la
 * que dispara la llamada al call center. Se dice qué falta, quién lo hace y
 * para cuándo.
 */
export function refundStatusCopy(
  status: 'PENDING' | 'COMPLETED' | 'FAILED' | 'DISPUTED' | string,
  args: { methodLabel: string; sentBy: string; visibleBy: string },
): RefundStatusCopy {
  switch (String(status).toUpperCase()) {
    case 'COMPLETED':
      return {
        headline: 'Reembolso enviado a tu banco',
        detail:
          `Ya lo enviamos por ${args.methodLabel}. A partir de aquí depende de tu banco: ` +
          `verás el abono a más tardar el ${args.visibleBy}. Si para esa fecha no aparece, ` +
          'escríbenos con el número de orden y lo reclamamos nosotros.',
      };
    case 'FAILED':
      return {
        headline: 'El envío del reembolso falló',
        detail:
          'El banco rechazó el movimiento. No perdiste el dinero: la devolución sigue ' +
          'registrada a tu nombre y la reintentamos. Te escribimos en cuanto salga.',
      };
    case 'DISPUTED':
      return {
        headline: 'Reembolso en revisión con el banco',
        detail:
          'Hay una aclaración abierta con el banco sobre este cargo. Mientras se resuelve ' +
          'no podemos enviar el abono; te avisamos en cuanto tengamos respuesta.',
      };
    default:
      return {
        headline: 'Reembolso aprobado, en camino a tu banco',
        detail:
          `Ya está autorizado y el importe está apartado. Falta un paso nuestro: liquidarlo ` +
          `en el portal del banco, que no es automático. Lo enviamos por ${args.methodLabel} ` +
          `a más tardar el ${args.sentBy}, y tu banco lo refleja a más tardar el ${args.visibleBy}. ` +
          'No tienes que hacer nada ni volver a llamar.',
      };
  }
}

/** Texto legal de la bonificación. Se repite igual en correo y pantalla. */
export const COMPENSATION_LEGAL_NOTE =
  'La Ley Federal de Protección al Consumidor (art. 92 Bis) obliga a devolver el importe ' +
  'completo —cargo por servicio incluido— y, cuando la cancelación es imputable al ' +
  'organizador, a pagar además una bonificación mínima del 20 %. Esa bonificación no es ' +
  'parte de tu devolución: es una indemnización que se suma.';

/**
 * Marca con la que `EventCancellationService` asienta la bonificación del
 * art. 92 Bis dentro de `Refund.notes`.
 *
 * Es la ÚNICA señal en el registro de que esa fila indemniza en vez de
 * devolver. Si el texto cambia allá y no aquí, la bonificación se cuenta como
 * dinero devuelto y tanto el correo como la pantalla dicen de más.
 */
export const COMPENSATION_NOTE_PREFIX = 'BONIFICACIÓN';

/** Prefijo de la nota que deja una cancelación de evento. */
const CANCELLATION_NOTE_PREFIX = 'Cancelación de "';

/**
 * Separador con el que `completeRefund` encadena anotaciones sobre la nota ya
 * existente (`notes | Banorte ref: …`).
 */
const NOTE_SEGMENT_SEPARATOR = ' | ';

/**
 * Recorta `Refund.notes` a lo que el comprador puede leer.
 *
 * `notes` es un campo mixto y NO es publicable en crudo. Según quién asiente la
 * devolución acaba conteniendo, entre otras cosas:
 *
 *   - el error que devolvió el gateway (`payment.service`),
 *   - la instrucción interna «call POST /payments/refunds/:id/complete when
 *     done», que describe nuestra API a quien no debería conocerla,
 *   - la referencia de Banorte que `completeRefund` anexa al liquidar,
 *   - «Void desde taquilla», «asentado por staff» y demás jerga de operación,
 *   - texto libre que un administrador escribe desde el panel, sin más
 *     restricción que su criterio.
 *
 * Solo dos cosas de ese campo son del comprador, y ambas se escribieron para
 * que las lea: la bonificación del art. 92 Bis —cuya explicación legal vive en
 * la propia nota— y el motivo de cancelación, que además ya le llega por
 * `Event.cancellationReason`, así que dejarlo pasar no descubre nada nuevo.
 *
 * La lista es de admisión, no de exclusión: se trocea por el separador y se
 * conserva únicamente lo reconocido. Un `notes` con forma nueva —o un origen
 * que todavía no existe— se cae solo, que es la única manera de que esto no se
 * convierta en una fuga la próxima vez que alguien añada un escritor.
 *
 * Efecto colateral asumido: un título de evento o un motivo que contengan
 * « | » pierden la cola del texto. Se prefiere una frase recortada a una nota
 * interna publicada.
 */
export function buyerVisibleRefundNote(notes: string | null | undefined): string | null {
  if (!notes) return null;
  const visible = notes
    .split(NOTE_SEGMENT_SEPARATOR)
    .map((segment) => segment.trim())
    .filter(
      (segment) =>
        segment.startsWith(COMPENSATION_NOTE_PREFIX) ||
        segment.startsWith(CANCELLATION_NOTE_PREFIX),
    );
  return visible.length > 0 ? visible.join(' ') : null;
}
