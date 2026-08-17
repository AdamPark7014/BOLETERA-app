/**
 * Contenido de los correos transaccionales (español de México).
 *
 * Aquí solo se decide QUÉ dice cada correo; el cómo se pinta vive en
 * `email-layout.ts`. Los datos llegan ya resueltos desde el procesador, que es
 * quien habla con la base: así estas funciones son puras y se pueden revisar (o
 * probar) sin levantar Prisma.
 *
 * REGLA DE ORO DE ESTE MÓDULO: en un correo NUNCA se incrusta el QR de acceso.
 * La firma del QR rota cada 15 s y solo se acepta la ventana anterior, así que
 * un PNG enviado por correo lleva muerto desde el segundo 30. Todos los correos
 * llevan al comprador a la vista web, donde el código se genera en el momento.
 * Ver el comentario extenso en `ticket-pdf.service.ts`.
 */

import {
  EmailDocument,
  EmailDetailRow,
  formatDate,
  formatEventDateTime,
  formatMoney,
} from './email-layout';

export type TicketLine = {
  code: string;
  section?: string | null;
  row?: string | null;
  seatNumber?: string | null;
  offerName?: string | null;
};

export type EventContext = {
  title: string;
  startsAt?: Date | string | null;
  endsAt?: Date | string | null;
  timezone?: string | null;
  venueName?: string | null;
  venueAddress?: string | null;
  venueCity?: string | null;
  venueState?: string | null;
  /** Políticas del evento; se imprimen tal cual en el correo y en el PDF. */
  transferAllowed?: boolean;
  refundable?: boolean;
};

export type OrderEmailContext = {
  publicId: string;
  buyerName: string;
  totalAmount: unknown;
  currency: string;
  paymentMethod?: string | null;
  tickets: TicketLine[];
  event: EventContext;
  /** URL de la vista web de la orden, con `?t=` si hay credencial. */
  accessUrl: string;
  /** Si es falso, el enlace solo sirve a quien tenga sesión iniciada. */
  hasAccessToken: boolean;
};

/** Etiqueta de butaca legible: "Sección A · Fila 3 · Asiento 12". */
export function seatLabel(ticket: TicketLine): string {
  const parts = [
    ticket.section ? `Sección ${ticket.section}` : null,
    ticket.row ? `Fila ${ticket.row}` : null,
    ticket.seatNumber ? `Asiento ${ticket.seatNumber}` : null,
  ].filter(Boolean);
  if (parts.length) return parts.join(' · ');
  return ticket.offerName ? `${ticket.offerName} · Entrada general` : 'Entrada general';
}

/** Recinto en una línea: nombre, dirección y ciudad. */
export function venueLine(event: EventContext): string {
  const parts = [event.venueName, event.venueAddress, [event.venueCity, event.venueState].filter(Boolean).join(', ')]
    .filter(Boolean)
    .map((p) => String(p).trim())
    .filter((p) => p.length > 0);
  return parts.length ? parts.join(' — ') : 'Recinto por confirmar';
}

/** Ficha común a todos los correos de una orden. */
function orderDetailRows(ctx: OrderEmailContext, extra: EmailDetailRow[] = []): EmailDetailRow[] {
  return [
    { label: 'Evento', value: ctx.event.title },
    { label: 'Fecha y hora', value: formatEventDateTime(ctx.event.startsAt, ctx.event.timezone) },
    { label: 'Recinto', value: venueLine(ctx.event) },
    { label: 'Orden', value: ctx.publicId },
    { label: 'Boletos', value: String(ctx.tickets.length) },
    ...extra,
  ];
}

/** Lista "Boleto · butaca · código" para el cuerpo del correo. */
function ticketItems(ctx: OrderEmailContext): string[] {
  return ctx.tickets.map((t) => `${seatLabel(t)} — código ${t.code}`);
}

/**
 * Instrucciones de acceso. Es el bloque que más consultas de soporte evita:
 * explica por qué no hay un QR adjunto y qué hacer si no se lleva teléfono.
 */
function doorInstructions(): string[] {
  return [
    'Abre "Ver mis boletos" desde tu teléfono al llegar: el código QR se genera ahí y cambia cada pocos segundos por seguridad.',
    'Una captura de pantalla o una foto del QR NO funciona en el acceso: al mostrarla ya habrá caducado.',
    'Lleva una identificación oficial con el mismo nombre de la compra.',
    'Si no llevas teléfono, preséntate en taquilla con el código de tu boleto (BLT-…) y una identificación: ahí lo validan a mano.',
    'Te recomendamos llegar con 45 minutos de anticipación.',
  ];
}

/** Aviso sobre la credencial del enlace cuando el comprador no tiene cuenta. */
function accessHelper(ctx: OrderEmailContext): string {
  return ctx.hasAccessToken
    ? 'Este enlace es personal: incluye la credencial de acceso a tu orden. No lo compartas ni lo publiques.'
    : 'Inicia sesión con el correo de la compra para ver tus boletos.';
}

// ==================== COMPRADOR ====================

export function orderConfirmationEmail(ctx: OrderEmailContext): EmailDocument {
  return {
    subject: `Confirmación de tu compra · ${ctx.event.title}`,
    preheader: `Orden ${ctx.publicId} · ${ctx.tickets.length} boleto(s) · ${formatEventDateTime(ctx.event.startsAt, ctx.event.timezone)}`,
    heading: `¡Listo, ${ctx.buyerName}! Tu compra está confirmada`,
    blocks: [
      {
        kind: 'paragraph',
        text: `Ya tienes ${ctx.tickets.length} boleto(s) para ${ctx.event.title}. Guarda este correo: es la única forma de llegar a tus boletos si compraste sin cuenta.`,
      },
      {
        kind: 'details',
        title: 'Tu compra',
        rows: orderDetailRows(ctx, [
          { label: 'Total pagado', value: formatMoney(ctx.totalAmount, ctx.currency) },
          ...(ctx.paymentMethod ? [{ label: 'Método de pago', value: paymentMethodLabel(ctx.paymentMethod) }] : []),
        ]),
      },
      { kind: 'cta', url: ctx.accessUrl, label: 'Ver mis boletos', helper: accessHelper(ctx) },
      { kind: 'list', title: `Tus boletos (${ctx.tickets.length})`, items: ticketItems(ctx) },
      {
        kind: 'callout',
        tone: 'info',
        title: 'El QR se genera en el momento',
        text: 'Por seguridad no enviamos el código de acceso por correo: se genera al abrir tus boletos y se renueva solo cada pocos segundos. Ábrelos en la puerta, con tiempo y batería.',
      },
      { kind: 'list', title: 'Qué llevar el día del evento', items: doorInstructions(), ordered: true },
      { kind: 'divider' },
      { kind: 'paragraph', muted: true, text: policyLine(ctx.event) },
    ],
    footerNote: `En unos minutos recibirás además un PDF con tus boletos para imprimir. Orden ${ctx.publicId}.`,
  };
}

export function ticketsPdfEmail(ctx: OrderEmailContext): EmailDocument {
  return {
    subject: `Tus boletos en PDF · ${ctx.event.title}`,
    preheader: `Adjuntamos ${ctx.tickets.length} boleto(s) de la orden ${ctx.publicId}.`,
    heading: 'Tus boletos en PDF',
    blocks: [
      {
        kind: 'paragraph',
        text: `Adjuntamos el PDF con tus ${ctx.tickets.length} boleto(s) para ${ctx.event.title}. Sirve como respaldo imprimible y se lee bien en blanco y negro.`,
      },
      {
        kind: 'callout',
        tone: 'warning',
        title: 'El PDF no sustituye al QR de acceso',
        text: 'El PDF trae el código de cada boleto para validarlo en taquilla. Para entrar directo por el acceso automático usa "Ver mis boletos": ese QR se renueva solo y es el que leen los escáneres de la puerta.',
      },
      { kind: 'cta', url: ctx.accessUrl, label: 'Ver mis boletos', helper: accessHelper(ctx) },
      { kind: 'details', title: 'Tu compra', rows: orderDetailRows(ctx) },
      { kind: 'paragraph', muted: true, text: policyLine(ctx.event) },
    ],
    footerNote: `Orden ${ctx.publicId}.`,
  };
}

/** Pago pendiente de OXXO/SPEI, con la referencia y su fecha límite real. */
export function paymentPendingEmail(
  ctx: OrderEmailContext & {
    reference?: string | null;
    clabe?: string | null;
    concept?: string | null;
    /** Vencimiento real del intento de pago, no un plazo inventado. */
    expiresAt?: Date | string | null;
    methodType?: string | null;
  },
): EmailDocument {
  const isSpei = String(ctx.methodType ?? '').toUpperCase() === 'SPEI';
  const method = isSpei ? 'transferencia SPEI' : 'pago en OXXO';
  const deadline = ctx.expiresAt
    ? formatDate(ctx.expiresAt, ctx.event.timezone)
    : 'Consulta la fecha límite en tu orden';

  const rows: EmailDetailRow[] = [
    { label: 'Evento', value: ctx.event.title },
    { label: 'Fecha del evento', value: formatEventDateTime(ctx.event.startsAt, ctx.event.timezone) },
    { label: 'Orden', value: ctx.publicId },
    { label: 'Importe a pagar', value: formatMoney(ctx.totalAmount, ctx.currency) },
    { label: 'Pagar antes de', value: deadline },
  ];
  if (isSpei && ctx.clabe) rows.push({ label: 'CLABE destino', value: ctx.clabe });
  if (isSpei && ctx.concept) rows.push({ label: 'Concepto', value: ctx.concept });

  return {
    subject: `Tu pago está pendiente · Orden ${ctx.publicId}`,
    preheader: `Completa tu ${method} antes del ${deadline} o perderás tus lugares.`,
    heading: 'Tu apartado está listo, falta el pago',
    blocks: [
      {
        kind: 'paragraph',
        text: `Apartamos ${ctx.tickets.length} boleto(s) para ${ctx.event.title}. Para confirmarlos completa tu ${method} con la referencia de abajo.`,
      },
      ...(ctx.reference
        ? ([
            {
              kind: 'code' as const,
              label: isSpei ? 'Referencia SPEI' : 'Referencia OXXO',
              value: ctx.reference,
              helper: isSpei
                ? 'Captura la referencia en el concepto de la transferencia; sin ella el pago no se puede asociar a tu orden.'
                : 'Dicta esta referencia en la caja de cualquier OXXO. Guarda tu comprobante.',
            },
          ] as const)
        : []),
      { kind: 'details', title: 'Datos del pago', rows },
      {
        kind: 'callout',
        tone: 'warning',
        title: 'Tus lugares están apartados solo hasta esa fecha',
        text: `Si el pago no se registra antes del ${deadline}, la reserva se libera automáticamente y los boletos vuelven a la venta.`,
      },
      {
        kind: 'paragraph',
        text: 'Cuando el pago se registre (puede tardar hasta 24 h después de pagar) te enviaremos la confirmación con el acceso a tus boletos.',
      },
      { kind: 'cta', url: ctx.accessUrl, label: 'Ver el estado de mi orden', helper: accessHelper(ctx) },
    ],
    footerNote: `Orden ${ctx.publicId}.`,
  };
}

/** Acuse de pago recibido (previo o complementario a la confirmación). */
export function paymentReceivedEmail(ctx: OrderEmailContext): EmailDocument {
  return {
    subject: `Recibimos tu pago · Orden ${ctx.publicId}`,
    preheader: `Pago de ${formatMoney(ctx.totalAmount, ctx.currency)} aplicado a tu orden ${ctx.publicId}.`,
    heading: 'Recibimos tu pago',
    blocks: [
      {
        kind: 'paragraph',
        text: `Confirmamos el pago de ${formatMoney(ctx.totalAmount, ctx.currency)} de la orden ${ctx.publicId}. Tus boletos para ${ctx.event.title} ya están emitidos.`,
      },
      { kind: 'details', title: 'Tu compra', rows: orderDetailRows(ctx, [{ label: 'Total pagado', value: formatMoney(ctx.totalAmount, ctx.currency) }]) },
      { kind: 'cta', url: ctx.accessUrl, label: 'Ver mis boletos', helper: accessHelper(ctx) },
      { kind: 'paragraph', muted: true, text: 'Este correo es tu comprobante de pago. Si necesitas factura, solicítala desde la vista de tu orden.' },
    ],
    footerNote: `Orden ${ctx.publicId}.`,
  };
}

export function refundEmail(ctx: {
  publicId: string;
  buyerName?: string | null;
  amount: unknown;
  currency: string;
  eventTitle: string;
  reason?: string | null;
  partial?: boolean;
}): EmailDocument {
  return {
    subject: `Reembolso ${ctx.partial ? 'parcial ' : ''}procesado · Orden ${ctx.publicId}`,
    preheader: `Reembolso de ${formatMoney(ctx.amount, ctx.currency)} de tu orden ${ctx.publicId}.`,
    heading: 'Tu reembolso está en camino',
    blocks: [
      {
        kind: 'paragraph',
        text: `${ctx.buyerName ? `Hola ${ctx.buyerName}. ` : ''}Procesamos un reembolso ${ctx.partial ? 'parcial ' : ''}de tu orden ${ctx.publicId} para ${ctx.eventTitle}.`,
      },
      {
        kind: 'details',
        title: 'Detalle del reembolso',
        rows: [
          { label: 'Evento', value: ctx.eventTitle },
          { label: 'Orden', value: ctx.publicId },
          { label: 'Importe reembolsado', value: formatMoney(ctx.amount, ctx.currency) },
          ...(ctx.reason ? [{ label: 'Motivo', value: ctx.reason }] : []),
        ],
      },
      {
        kind: 'callout',
        tone: 'info',
        title: 'Cuándo verás el dinero',
        text: 'El banco emisor aplica el abono en 3 a 10 días hábiles según el método de pago. Si pagaste con tarjeta aparecerá en el mismo plástico; si pagaste en OXXO o por SPEI, en la cuenta que nos indicaste.',
      },
      {
        kind: 'paragraph',
        muted: true,
        text: 'Los boletos reembolsados quedan cancelados: ya no permiten el acceso al evento.',
      },
    ],
    footerNote: `Orden ${ctx.publicId}.`,
  };
}

export function eventCancelledEmail(ctx: {
  publicId: string;
  buyerName?: string | null;
  event: EventContext;
  totalAmount: unknown;
  currency: string;
  ticketCount: number;
  reason?: string | null;
  accessUrl: string;
  hasAccessToken: boolean;
}): EmailDocument {
  return {
    subject: `Evento cancelado · ${ctx.event.title}`,
    preheader: `${ctx.event.title} fue cancelado. Te explicamos qué pasa con tu compra.`,
    heading: `${ctx.event.title} fue cancelado`,
    blocks: [
      {
        kind: 'paragraph',
        text: `${ctx.buyerName ? `Hola ${ctx.buyerName}. ` : ''}Lamentamos informarte que el evento fue cancelado por el organizador${ctx.reason ? `: ${ctx.reason}` : '.'}`,
      },
      {
        kind: 'details',
        title: 'Tu compra afectada',
        rows: [
          { label: 'Evento', value: ctx.event.title },
          { label: 'Fecha programada', value: formatEventDateTime(ctx.event.startsAt, ctx.event.timezone) },
          { label: 'Recinto', value: venueLine(ctx.event) },
          { label: 'Orden', value: ctx.publicId },
          { label: 'Boletos', value: String(ctx.ticketCount) },
          { label: 'Importe pagado', value: formatMoney(ctx.totalAmount, ctx.currency) },
        ],
      },
      {
        kind: 'callout',
        tone: 'danger',
        title: 'Tus boletos ya no son válidos',
        text: 'No es necesario que hagas nada para invalidarlos: el acceso quedó bloqueado automáticamente.',
      },
      {
        kind: 'paragraph',
        text: 'El importe pagado se reembolsa íntegro por el mismo medio de pago. Recibirás un correo de confirmación en cuanto se procese; no hace falta que lo solicites.',
      },
      { kind: 'cta', url: ctx.accessUrl, label: 'Ver el estado de mi orden', helper: ctx.hasAccessToken ? 'Este enlace es personal, no lo compartas.' : 'Inicia sesión con el correo de la compra.' },
    ],
    footerNote: `Orden ${ctx.publicId}.`,
  };
}

export function eventReminderEmail(ctx: OrderEmailContext): EmailDocument {
  return {
    subject: `Mañana: ${ctx.event.title}`,
    preheader: `${formatEventDateTime(ctx.event.startsAt, ctx.event.timezone)} · ${venueLine(ctx.event)}`,
    heading: `Se acerca ${ctx.event.title}`,
    blocks: [
      { kind: 'paragraph', text: 'Deja todo listo para no batallar en la entrada.' },
      { kind: 'details', title: 'Los datos que necesitas', rows: orderDetailRows(ctx) },
      { kind: 'cta', url: ctx.accessUrl, label: 'Ver mis boletos', helper: accessHelper(ctx) },
      { kind: 'list', title: 'Antes de salir', items: doorInstructions(), ordered: true },
    ],
    footerNote: `Orden ${ctx.publicId}.`,
  };
}

// ==================== INTERNOS / ORGANIZADOR ====================

export function fraudAlertEmail(ctx: {
  orderRef: string;
  score: number;
  severity: string;
  eventTitle?: string | null;
  buyerEmail?: string | null;
  adminUrl?: string | null;
}): EmailDocument {
  return {
    subject: `[FRAUDE ${ctx.severity}] Orden ${ctx.orderRef}`,
    preheader: `Puntuación ${ctx.score}/100 en la orden ${ctx.orderRef}.`,
    heading: 'Alerta de fraude',
    blocks: [
      { kind: 'paragraph', text: 'El motor antifraude marcó una orden para revisión manual.' },
      {
        kind: 'details',
        rows: [
          { label: 'Orden', value: ctx.orderRef },
          ...(ctx.eventTitle ? [{ label: 'Evento', value: ctx.eventTitle }] : []),
          ...(ctx.buyerEmail ? [{ label: 'Comprador', value: ctx.buyerEmail }] : []),
          { label: 'Puntuación', value: `${ctx.score}/100` },
          { label: 'Severidad', value: ctx.severity },
        ],
      },
      ...(ctx.adminUrl ? ([{ kind: 'cta' as const, url: ctx.adminUrl, label: 'Revisar en el panel' }] as const) : []),
    ],
    footerNote: 'Aviso interno de la plataforma.',
  };
}

export function payoutReadyEmail(ctx: { amount: unknown; currency: string; organizationName?: string | null }): EmailDocument {
  return {
    subject: 'Tu liquidación está lista',
    preheader: `Liquidación de ${formatMoney(ctx.amount, ctx.currency)} disponible.`,
    heading: 'Liquidación disponible',
    blocks: [
      {
        kind: 'paragraph',
        text: `${ctx.organizationName ? `${ctx.organizationName}: ` : ''}ya está disponible una liquidación de ${formatMoney(ctx.amount, ctx.currency)}.`,
      },
      { kind: 'paragraph', muted: true, text: 'Consulta el desglose de comisiones y la fecha de dispersión en el panel del organizador.' },
    ],
    footerNote: 'Aviso para organizadores.',
  };
}

export function resaleAlertEmail(ctx: { listingId: string; eventTitle: string }): EmailDocument {
  return {
    subject: `Actividad en tu reventa · ${ctx.eventTitle}`,
    preheader: `Movimiento en tu publicación ${ctx.listingId}.`,
    heading: 'Hay movimiento en tu publicación de reventa',
    blocks: [
      { kind: 'paragraph', text: `Tu publicación para ${ctx.eventTitle} registró actividad.` },
      { kind: 'details', rows: [{ label: 'Publicación', value: ctx.listingId }, { label: 'Evento', value: ctx.eventTitle }] },
    ],
    footerNote: 'Aviso de reventa.',
  };
}

// ==================== GENÉRICOS (otros módulos) ====================

export function waitlistAvailableEmail(ctx: { eventTitle: string; eventUrl: string }): EmailDocument {
  return {
    subject: `¡Hay boletos para ${ctx.eventTitle}!`,
    preheader: 'Se liberaron lugares. Corren rápido.',
    heading: '¡Se liberaron boletos!',
    blocks: [
      { kind: 'paragraph', text: `El evento ${ctx.eventTitle} tiene disponibilidad otra vez. Los lugares liberados suelen agotarse en minutos.` },
      { kind: 'cta', url: ctx.eventUrl, label: 'Comprar ahora' },
    ],
    footerNote: 'Recibes este aviso porque te apuntaste a la lista de espera.',
  };
}

export function passwordResetEmail(ctx: { firstName?: string | null; resetUrl: string }): EmailDocument {
  return {
    subject: 'Restablece tu contraseña',
    preheader: 'El enlace expira en 1 hora.',
    heading: 'Restablece tu contraseña',
    blocks: [
      { kind: 'paragraph', text: `${ctx.firstName ? `Hola ${ctx.firstName}. ` : ''}Recibimos una solicitud para cambiar la contraseña de tu cuenta.` },
      { kind: 'cta', url: ctx.resetUrl, label: 'Elegir nueva contraseña', helper: 'El enlace expira en 1 hora y solo puede usarse una vez.' },
      { kind: 'paragraph', muted: true, text: 'Si no fuiste tú, ignora este correo: tu contraseña actual sigue funcionando.' },
    ],
    footerNote: 'Correo de seguridad de tu cuenta.',
  };
}

export function ticketTransferEmail(ctx: {
  eventTitle: string;
  transferCode: string;
  acceptUrl: string;
  message?: string | null;
}): EmailDocument {
  return {
    subject: `Te transfirieron un boleto · ${ctx.eventTitle}`,
    preheader: `Acepta la transferencia con el código ${ctx.transferCode}.`,
    heading: 'Te transfirieron un boleto',
    blocks: [
      { kind: 'paragraph', text: `Alguien te transfirió un boleto para ${ctx.eventTitle}. Acéptalo para que quede a tu nombre.` },
      { kind: 'code', label: 'Código de transferencia', value: ctx.transferCode },
      { kind: 'cta', url: ctx.acceptUrl, label: 'Aceptar transferencia' },
      ...(ctx.message ? ([{ kind: 'paragraph' as const, text: `Mensaje: ${ctx.message}` }] as const) : []),
    ],
    footerNote: 'Transferencia de boletos.',
  };
}

// ==================== AUXILIARES ====================

/** Política del evento en una línea, para el pie de los correos y el PDF. */
export function policyLine(event: EventContext): string {
  const transfer = event.transferAllowed === false ? 'Boletos no transferibles.' : 'Boletos transferibles desde tu cuenta.';
  const refund =
    event.refundable === false
      ? 'Venta final: este evento no admite reembolso salvo cancelación.'
      : 'Reembolsable según la política del organizador; en caso de cancelación el reembolso es automático.';
  return `${transfer} ${refund}`;
}

/** Nombre comercial del método de pago para el comprador. */
export function paymentMethodLabel(method?: string | null): string {
  switch (String(method ?? '').toUpperCase()) {
    case 'CARD':
      return 'Tarjeta';
    case 'OXXO':
      return 'Efectivo en OXXO';
    case 'SPEI':
    case 'BANK_TRANSFER':
      return 'Transferencia SPEI';
    case 'CASH':
      return 'Efectivo en taquilla';
    default:
      return method ? String(method) : 'No especificado';
  }
}
