import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import PDFDocument from 'pdfkit';
import QRCode from 'qrcode';
import { PrismaService } from '../prisma/prisma.service';
import { formatEventDateTime, formatMoney } from './email-layout';
import { EventContext, policyLine, seatLabel } from './email-templates';

/**
 * ============================================================================
 * POR QUÉ ESTE PDF NO LLEVA EL QR DE ACCESO (léeme antes de "arreglarlo")
 * ============================================================================
 *
 * Este archivo generaba un QR firmado por boleto con `buildQrPayload()`. Ese QR
 * es *rotativo*: `@boletera/crypto` firma la ventana temporal actual, la ventana
 * dura 15 s y el escáner acepta como mucho la anterior. Validez efectiva: ~30 s.
 *
 * Un PDF se genera una vez y se enseña en la puerta días después. El QR impreso
 * caducaba a los 30 segundos de crearse: nacía muerto. El asistente llegaba con
 * su boleto "oficial" y el escáner respondía "Invalid or expired QR". No era un
 * detalle estético, era una entrega rota.
 *
 * Se descartó bajar la rotación o firmar una ventana larga solo para el PDF:
 * eso convierte el papel en una credencial copiable (una foto del QR vale para
 * entrar) y es justo el ataque que la rotación existe para impedir.
 *
 * La solución es separar los dos medios:
 *
 *   - ACCESO AUTOMÁTICO → vista web (`GET /orders/:publicId/qrcodes`), que firma
 *     en el momento y refresca sola. Ahí sigue estando `requireTicketQrSecret()`
 *     como única fuente de la clave, junto al escáner que la verifica.
 *   - RESPALDO IMPRESO → este PDF: lleva el `Ticket.code` (BLT-…) en texto
 *     grande y en un QR estático sin firma. Ese código NO abre el torniquete;
 *     se valida en taquilla, donde `POST /access/scan` lo acepta como
 *     `ticketCode` (entrada manual, sin firma). Ese camino funciona de verdad.
 *
 * Por eso este servicio ya no importa `buildQrPayload` ni la clave de firma: no
 * firma nada. El documento lo dice en su propio cuerpo para que el portador no
 * llegue a la puerta creyendo que el papel abre el acceso.
 */

export type TicketPdfRow = {
  id: string;
  code: string;
  section?: string | null;
  row?: string | null;
  seatNumber?: string | null;
  /** Nombre de la oferta ("VIP", "General"). Se rellena solo si se conoce. */
  offerName?: string | null;
};

export type TicketPdfOptions = {
  eventTitle: string;
  publicId: string;
  buyerName: string;
  /**
   * Ya no se usa para firmar (ver cabecera). Se conserva porque las llamadas
   * existentes lo pasan y porque identifica el evento en los logs.
   */
  eventId?: string;
  tickets: TicketPdfRow[];
  /** Contexto del evento. Si falta, se completa desde la base con `publicId`. */
  event?: Partial<EventContext>;
  totalAmount?: unknown;
  currency?: string;
};

/** Medidas del documento. A4 en puntos (72 pt = 1 pulgada). */
const MARGIN = 42;
const QR_SIZE = 116;

@Injectable()
export class TicketPdfService {
  private readonly logger = new Logger(TicketPdfService.name);

  constructor(
    private readonly config: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  async buildPdfBuffer(opts: TicketPdfOptions): Promise<Buffer> {
    const context = await this.resolveContext(opts);

    const doc = new PDFDocument({
      size: 'A4',
      margin: MARGIN,
      info: {
        Title: `Boletos ${opts.publicId} · ${context.event.title}`,
        Author: 'BOLETERA',
        Subject: `Boletos de la orden ${opts.publicId}`,
      },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (c: Buffer) => chunks.push(c));

    const done = new Promise<Buffer>((resolve, reject) => {
      doc.on('end', () => resolve(Buffer.concat(chunks)));
      doc.on('error', reject);
    });

    const tickets = opts.tickets ?? [];
    if (!tickets.length) {
      // Un PDF vacío desconcierta más que un mensaje explícito.
      doc.fontSize(14).text('Esta orden no tiene boletos emitidos.', { align: 'center' });
      doc.end();
      return done;
    }

    for (let i = 0; i < tickets.length; i++) {
      // Un boleto por página: se recorta, se reparte y se escanea de uno en uno.
      if (i > 0) doc.addPage();
      await this.drawTicketPage(doc, tickets[i], i, tickets.length, context, opts);
    }

    doc.end();
    return done;
  }

  /**
   * Completa los datos del evento desde la base cuando quien llama no los trae.
   *
   * `orders.service.buildTicketsPdf` (la descarga desde la web) solo pasa
   * título, orden y butacas. En lugar de obligar a cambiar ese llamador —y de
   * dejar dos calidades de PDF según por dónde se pida— el servicio se completa
   * solo. Si la consulta falla, se emite el PDF con lo que haya: un boleto sin
   * dirección del recinto sigue sirviendo; no emitirlo, no.
   */
  private async resolveContext(opts: TicketPdfOptions): Promise<{
    event: EventContext;
    totalAmount: unknown;
    currency: string;
    offerByTicketCode: Map<string, string>;
  }> {
    const provided = opts.event ?? {};
    const offerByTicketCode = new Map<string, string>();
    const needsLookup = !provided.venueName || !provided.startsAt;

    let event: EventContext = {
      title: opts.eventTitle,
      startsAt: provided.startsAt ?? null,
      endsAt: provided.endsAt ?? null,
      timezone: provided.timezone ?? null,
      venueName: provided.venueName ?? null,
      venueAddress: provided.venueAddress ?? null,
      venueCity: provided.venueCity ?? null,
      venueState: provided.venueState ?? null,
      transferAllowed: provided.transferAllowed,
      refundable: provided.refundable,
    };
    let totalAmount = opts.totalAmount;
    let currency = opts.currency ?? 'MXN';

    if (!needsLookup) return { event, totalAmount, currency, offerByTicketCode };

    try {
      const order = await this.prisma.order.findUnique({
        where: { publicId: opts.publicId },
        include: {
          event: { include: { venue: true } },
          items: { include: { offer: true, tickets: true } },
        },
      });
      if (order) {
        event = {
          title: order.event?.title ?? opts.eventTitle,
          startsAt: order.event?.startsAt ?? null,
          endsAt: order.event?.endsAt ?? null,
          timezone: order.event?.timezone ?? order.event?.venue?.timezone ?? null,
          venueName: order.event?.venue?.name ?? null,
          venueAddress: order.event?.venue?.address ?? null,
          venueCity: order.event?.venue?.city ?? null,
          venueState: order.event?.venue?.state ?? null,
          transferAllowed: order.event?.transferAllowed && !order.event?.nonTransferable,
          refundable: order.event?.refundable,
        };
        totalAmount = totalAmount ?? order.totalAmount;
        currency = opts.currency ?? String(order.currency ?? 'MXN');
        for (const item of order.items ?? []) {
          for (const ticket of item.tickets ?? []) {
            if (item.offer?.name) offerByTicketCode.set(ticket.code, item.offer.name);
          }
        }
      }
    } catch (error) {
      this.logger.warn(
        `No se pudo completar el contexto del PDF de ${opts.publicId}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }

    return { event, totalAmount, currency, offerByTicketCode };
  }

  /**
   * Una página = un boleto.
   *
   * Todo el diseño es en escala de grises y con etiquetas de texto: impreso en
   * blanco y negro no se pierde ni un dato (nada depende del color).
   */
  private async drawTicketPage(
    doc: PDFKit.PDFDocument,
    ticket: TicketPdfRow,
    index: number,
    total: number,
    context: { event: EventContext; totalAmount: unknown; currency: string; offerByTicketCode: Map<string, string> },
    opts: TicketPdfOptions,
  ) {
    const left = MARGIN;
    const width = doc.page.width - MARGIN * 2;
    const right = left + width;
    const event = context.event;
    const offerName = ticket.offerName ?? context.offerByTicketCode.get(ticket.code) ?? null;

    // --- Cabecera
    doc.fillColor('#000000').font('Helvetica-Bold').fontSize(15).text('BOLETERA', left, MARGIN);
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#444444')
      .text(`Boleto ${index + 1} de ${total} · Orden ${opts.publicId}`, left, MARGIN + 3, {
        width,
        align: 'right',
      });

    let y = MARGIN + 26;
    doc.moveTo(left, y).lineTo(right, y).lineWidth(1).strokeColor('#111111').stroke();
    y += 16;

    // --- Evento y recinto
    doc.fillColor('#000000').font('Helvetica-Bold').fontSize(20).text(event.title, left, y, { width });
    y = doc.y + 6;

    doc
      .font('Helvetica-Bold')
      .fontSize(11)
      .fillColor('#111111')
      .text(formatEventDateTime(event.startsAt, event.timezone), left, y, { width });
    y = doc.y + 2;

    const venueName = event.venueName ?? 'Recinto por confirmar';
    const venueAddress = [event.venueAddress, event.venueCity, event.venueState].filter(Boolean).join(', ');
    doc.font('Helvetica').fontSize(11).fillColor('#111111').text(venueName, left, y, { width });
    y = doc.y;
    if (venueAddress) {
      doc.font('Helvetica').fontSize(9.5).fillColor('#444444').text(venueAddress, left, y, { width });
      y = doc.y;
    }
    y += 14;

    // --- Bloque principal: butaca a la izquierda, código a la derecha
    const boxTop = y;
    const boxHeight = 168;
    const qrX = right - QR_SIZE - 16;
    doc.roundedRect(left, boxTop, width, boxHeight, 8).lineWidth(1).strokeColor('#111111').stroke();

    const infoWidth = qrX - left - 32;
    let infoY = boxTop + 16;
    const field = (label: string, value: string, size = 13) => {
      doc.font('Helvetica').fontSize(8).fillColor('#555555').text(label.toUpperCase(), left + 16, infoY, {
        width: infoWidth,
        characterSpacing: 0.6,
      });
      infoY = doc.y + 1;
      doc.font('Helvetica-Bold').fontSize(size).fillColor('#000000').text(value, left + 16, infoY, {
        width: infoWidth,
      });
      infoY = doc.y + 8;
    };

    // Sin `offerName`: el tipo de boleto ya va en su propio campo y repetirlo
    // aquí daba "General · Entrada general".
    field('Ubicación', seatLabel({ ...ticket, offerName: null }), 15);
    field('Tipo de boleto', offerName ?? 'Entrada general', 12);
    field('Titular', opts.buyerName || 'Sin nombre', 12);

    // QR estático: contiene el código del boleto, nada más. Sin firma y sin
    // credencial de la orden — este papel puede acabar impreso o reenviado.
    const qrDataUrl = await QRCode.toDataURL(ticket.code, {
      width: 320,
      margin: 1,
      errorCorrectionLevel: 'M',
      color: { dark: '#000000', light: '#FFFFFF' },
    });
    const qrBuffer = Buffer.from(qrDataUrl.replace(/^data:image\/png;base64,/, ''), 'base64');
    doc.image(qrBuffer, qrX, boxTop + 14, { width: QR_SIZE, height: QR_SIZE });
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor('#444444')
      .text('Validación en taquilla', qrX, boxTop + QR_SIZE + 18, { width: QR_SIZE, align: 'center' });

    // --- Código legible: es el dato con el que trabaja el personal de taquilla.
    let codeY = boxTop + boxHeight + 14;
    doc.font('Helvetica').fontSize(8).fillColor('#555555').text('CÓDIGO DEL BOLETO', left, codeY, { characterSpacing: 0.6 });
    codeY = doc.y + 2;
    doc.font('Courier-Bold').fontSize(20).fillColor('#000000').text(ticket.code, left, codeY, { width });
    let y2 = doc.y + 14;

    // --- Cómo entrar. Es la parte que evita discusiones en la puerta.
    const webUrl = String(this.config.get('WEB_URL') ?? process.env.WEB_URL ?? 'http://localhost:3000').replace(/\/$/, '');
    const orderUrl = `${webUrl}/orders/${opts.publicId}`;
    doc.roundedRect(left, y2, width, 96, 8).lineWidth(1).strokeColor('#777777').dash(3, { space: 2 }).stroke();
    doc.undash();
    doc
      .font('Helvetica-Bold')
      .fontSize(10)
      .fillColor('#000000')
      .text('Cómo entrar al evento', left + 14, y2 + 12, { width: width - 28 });
    doc
      .font('Helvetica')
      .fontSize(9)
      .fillColor('#111111')
      .text(
        `1. Abre tus boletos en ${orderUrl} (usa el enlace de tu correo de confirmación) y muestra el código QR que aparece en pantalla: se renueva cada pocos segundos y es el único válido en el acceso automático.\n` +
          '2. Este documento es tu respaldo impreso: el código de arriba se valida en taquilla, no en la puerta automática.\n' +
          '3. Lleva identificación oficial con el mismo nombre de la compra.',
        left + 14,
        doc.y + 3,
        { width: width - 28, lineGap: 1.5 },
      );
    y2 += 106;

    // --- Condiciones y pie
    const conditions = policyLine(event);
    doc.font('Helvetica').fontSize(8).fillColor('#444444').text(`Condiciones: ${conditions}`, left, y2, { width });

    const footerY = doc.page.height - MARGIN - 26;
    doc.moveTo(left, footerY).lineTo(right, footerY).lineWidth(0.5).strokeColor('#999999').stroke();
    const paid =
      context.totalAmount !== undefined && context.totalAmount !== null
        ? ` · Total de la orden ${formatMoney(context.totalAmount, context.currency)}`
        : '';
    doc
      .font('Helvetica')
      .fontSize(7.5)
      .fillColor('#555555')
      .text(
        `Orden ${opts.publicId} · ${opts.buyerName}${paid} · Documento generado el ${formatEventDateTime(new Date(), event.timezone)}. ` +
          'La reproducción de este boleto no otorga accesos adicionales: cada código admite una sola entrada.',
        left,
        footerY + 6,
        { width },
      );
  }
}
