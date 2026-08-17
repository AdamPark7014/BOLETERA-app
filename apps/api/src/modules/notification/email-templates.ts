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

/** Desglose de lo devuelto. Solo se pasa cuando se devolvió la orden completa. */
export type RefundBreakdown = {
  tickets: unknown;
  fees: unknown;
  tax: unknown;
  discount?: unknown;
};

/**
 * Correo de reembolso.
 *
 * Responde, en este orden, a las cuatro preguntas que el comprador hace por
 * teléfono cuando el correo no las contesta: cuánto, por qué medio, para
 * cuándo y por qué. El plazo NO se escribe aquí: llega ya resuelto desde
 * `refund-policy.ts`, que es el único sitio donde se define.
 *
 * La bonificación del art. 92 Bis se presenta aparte y con ese nombre. Sumarla
 * al importe devuelto sería mentir dos veces: el comprador creería que le
 * devolvimos de más, y perdería de vista que la ley le da una indemnización.
 */
export function refundEmail(ctx: {
  publicId: string;
  buyerName?: string | null;
  amount: unknown;
  currency: string;
  eventTitle: string;
  reason?: string | null;
  partial?: boolean;
  /** Desglose boleto + cargos; ausente en reembolsos parciales. */
  breakdown?: RefundBreakdown | null;
  /** Bonificación art. 92 Bis, si la cancelación fue imputable al organizador. */
  compensation?: unknown | null;
  /** Estado real del `Refund`: decide el titular y el «qué sigue». */
  statusHeadline: string;
  statusDetail: string;
  /** Medio por el que vuelve el dinero, en palabras del comprador. */
  methodLabel: string;
  /** Fecha tope comprometida para que salga hacia el banco. */
  sentBy: string;
  /** Fecha tope para que el abono sea visible. */
  visibleBy: string;
  /** El evento se canceló: cambia el motivo y activa la nota legal. */
  eventCancelled?: boolean;
  /** Nota legal del art. 92 Bis; solo cuando hay bonificación. */
  compensationNote?: string | null;
  /** Hace falta una CLABE porque el pago fue en efectivo. */
  needsBankAccount?: boolean;
  accessUrl?: string | null;
}): EmailDocument {
  const total = formatMoney(ctx.amount, ctx.currency);
  const hasCompensation = ctx.compensation != null && Number(ctx.compensation) > 0;

  const breakdownRows: EmailDetailRow[] = ctx.breakdown
    ? [
        { label: 'Precio de los boletos', value: formatMoney(ctx.breakdown.tickets, ctx.currency) },
        { label: 'Cargo por servicio', value: formatMoney(ctx.breakdown.fees, ctx.currency) },
        { label: 'IVA', value: formatMoney(ctx.breakdown.tax, ctx.currency) },
        ...(Number(ctx.breakdown.discount ?? 0) > 0
          ? [
              {
                label: 'Descuento aplicado en la compra',
                value: `−${formatMoney(ctx.breakdown.discount, ctx.currency)}`,
              },
            ]
          : []),
      ]
    : [];

  return {
    subject: hasCompensation
      ? `Reembolso + bonificación · Orden ${ctx.publicId}`
      : `Reembolso ${ctx.partial ? 'parcial ' : ''}aprobado · Orden ${ctx.publicId}`,
    preheader: `${total} de vuelta por ${ctx.methodLabel}. A más tardar el ${ctx.visibleBy}.`,
    heading: ctx.statusHeadline,
    blocks: [
      {
        kind: 'paragraph',
        text:
          `${ctx.buyerName ? `Hola ${ctx.buyerName}. ` : ''}` +
          (ctx.eventCancelled
            ? `${ctx.eventTitle} fue cancelado, así que te devolvemos ${ctx.partial ? 'parte de ' : ''}lo que pagaste por la orden ${ctx.publicId}.`
            : `Aprobamos el reembolso ${ctx.partial ? 'parcial ' : ''}de tu orden ${ctx.publicId} para ${ctx.eventTitle}.`),
      },
      {
        kind: 'details',
        title: ctx.partial ? 'Qué te devolvemos' : 'Qué te devolvemos (importe completo)',
        rows: [
          ...breakdownRows,
          { label: 'Total que te devolvemos', value: total },
          { label: 'Medio', value: ctx.methodLabel },
          { label: 'Sale hacia tu banco', value: `a más tardar el ${ctx.sentBy}` },
          { label: 'Lo verás abonado', value: `a más tardar el ${ctx.visibleBy}` },
          ...(ctx.reason ? [{ label: 'Motivo', value: ctx.reason }] : []),
          { label: 'Orden', value: ctx.publicId },
        ],
      },
      {
        kind: 'callout',
        tone: 'info',
        title: ctx.statusHeadline,
        text: ctx.statusDetail,
      },
      ...(ctx.breakdown
        ? ([
            {
              kind: 'paragraph' as const,
              text: 'Te devolvemos el importe completo: el precio del boleto y también el cargo por servicio y el IVA. No descontamos nada por gestión.',
            },
          ] as const)
        : []),
      ...(hasCompensation
        ? ([
            { kind: 'divider' as const },
            {
              kind: 'callout' as const,
              tone: 'success' as const,
              title: `Además: bonificación de ${formatMoney(ctx.compensation, ctx.currency)}`,
              text: 'Es una indemnización adicional por la cancelación, no parte de tu devolución. Se paga aparte y por el mismo medio, con el mismo plazo.',
            },
            ...(ctx.compensationNote
              ? [{ kind: 'paragraph' as const, muted: true, text: ctx.compensationNote }]
              : []),
          ] as const)
        : []),
      ...(ctx.needsBankAccount
        ? ([
            {
              kind: 'callout' as const,
              tone: 'warning' as const,
              title: 'Necesitamos tu CLABE',
              text: 'Pagaste en efectivo, así que no hay tarjeta a la que devolver. Respóndenos a este correo con tu CLABE interbancaria (18 dígitos) y el nombre del titular; el plazo empieza a contar desde que la recibimos.',
            },
          ] as const)
        : []),
      ...(ctx.accessUrl
        ? ([
            {
              kind: 'cta' as const,
              url: ctx.accessUrl,
              label: 'Ver el estado de mi reembolso',
              helper: 'La misma información, siempre actualizada, sin tener que llamar.',
            },
          ] as const)
        : []),
      {
        kind: 'paragraph',
        muted: true,
        text: 'Los boletos reembolsados quedan cancelados: ya no permiten el acceso al evento.',
      },
    ],
    footerNote: `Orden ${ctx.publicId}. Guarda este correo: es el comprobante de tu reembolso.`,
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
