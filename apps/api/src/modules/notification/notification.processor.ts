import { InjectQueue, OnQueueFailed, Process, Processor } from '@nestjs/bull';
import { Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import type { Job, Queue } from 'bull';
import { createHash, randomBytes } from 'crypto';
import { OrderStatus, PaymentStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { MailService } from './mail.service';
import { renderEmailDocument } from './email-layout';
import {
  EventContext,
  OrderEmailContext,
  eventCancelledEmail,
  eventReminderEmail,
  fraudAlertEmail,
  orderConfirmationEmail,
  passwordResetEmail,
  paymentPendingEmail,
  paymentReceivedEmail,
  payoutReadyEmail,
  refundEmail,
  resaleAlertEmail,
  ticketTransferEmail,
  ticketsPdfEmail,
  waitlistAvailableEmail,
} from './email-templates';
import { NOTIFICATION_QUEUE, NotificationJob } from './notification.service';
import { TicketPdfService } from './ticket-pdf.service';

/**
 * Ventana de la marca de "ya enviado".
 *
 * Cubre de sobra los 5 intentos con retroceso exponencial (~4 min en total), de
 * modo que un reintento por un fallo posterior al envío no vuelve a mandar el
 * mismo correo. Pasado ese plazo la marca caduca a propósito: un reenvío
 * manual desde el panel —el comprador que dice "no me llegó"— tiene que salir.
 */
const SENT_MARKER_TTL_MS = 15 * 60 * 1000;

@Processor(NOTIFICATION_QUEUE)
export class NotificationProcessor {
  private readonly logger = new Logger(NotificationProcessor.name);

  constructor(
    private prisma: PrismaService,
    private mail: MailService,
    private ticketPdf: TicketPdfService,
    private config: ConfigService,
    @InjectQueue(NOTIFICATION_QUEUE) private readonly queue: Queue,
  ) {}

  @Process('dispatch')
  async handle(job: Job<NotificationJob>) {
    const payload = job.data;
    switch (payload.type) {
      case 'order.confirmation':
        return this.sendOrderConfirmation(payload);
      case 'ticket.pdf':
        return this.sendTicketPdf(payload);
      case 'payment.pending':
        return this.sendPaymentPending(payload);
      case 'payment.received':
        return this.sendPaymentReceived(payload);
      case 'fraud.alert':
        return this.sendFraudAlert(payload);
      case 'refund.notification':
        return this.sendRefund(payload);
      case 'event.cancelled':
        return this.broadcastEventCancelled(payload);
      case 'order.event_cancelled':
        return this.sendOrderEventCancelled(payload);
      case 'resale.alert':
        return this.sendResaleAlert(payload);
      case 'payout.ready':
        return this.sendPayoutReady(payload);
      case 'event.reminder':
        return this.sendEventReminder(payload);
      case 'generic.email':
        return this.sendGenericEmail(payload);
      default:
        break;
    }
  }

  /**
   * Último eslabón: un aviso que agotó sus reintentos NO desaparece sin ruido.
   *
   * El job se queda en la cola de fallidos (`removeOnFail: false`) y aquí queda
   * el registro con destinatario y motivo, que es lo que busca quien atiende la
   * queja "compré y no me llegó nada".
   */
  @OnQueueFailed()
  onFailed(job: Job<NotificationJob>, error: Error) {
    const data = job?.data as Partial<Extract<NotificationJob, { email?: string }>> & {
      to?: string;
      buyerEmail?: string;
      orderId?: string;
    };
    const target = data?.email ?? data?.to ?? data?.buyerEmail ?? 'destinatario desconocido';
    const final = job.attemptsMade >= (job.opts?.attempts ?? 1);
    const message =
      `Aviso ${data?.type ?? 'desconocido'} → ${target} falló (intento ${job.attemptsMade}` +
      `/${job.opts?.attempts ?? 1}${data?.orderId ? `, orden ${data.orderId}` : ''}): ${error?.message ?? error}`;
    if (final) {
      this.logger.error(`${message} — SIN ENTREGAR. Queda en la cola de fallidos para reintento manual.`);
    } else {
      this.logger.warn(message);
    }
  }

  // ==================== IDEMPOTENCIA ====================

  /**
   * Envía una sola vez por clave lógica.
   *
   * Un job de Bull puede reintentarse por un fallo posterior al `sendMail`
   * (por ejemplo al encolar el PDF): sin esto, el comprador recibiría el mismo
   * correo dos o tres veces. La marca se toma ANTES de enviar —así dos réplicas
   * del worker no envían a la vez— y se libera si el envío falla, para que el
   * reintento sí vuelva a intentarlo.
   *
   * Si Redis no responde se envía igualmente: duplicar un correo es molesto,
   * perderlo es una entrega rota.
   */
  private async sendOnce(key: string, send: () => Promise<void>): Promise<'sent' | 'skipped'> {
    const markerKey = `notif:sent:${key}`;
    let acquired = true;
    try {
      const result = await this.queue.client.set(markerKey, String(Date.now()), 'PX', SENT_MARKER_TTL_MS, 'NX');
      acquired = result === 'OK';
    } catch (error) {
      this.logger.warn(
        `Sin marca de idempotencia para ${key} (Redis: ${error instanceof Error ? error.message : String(error)}). Se envía igualmente.`,
      );
    }

    if (!acquired) {
      this.logger.log(`Aviso ${key} ya enviado hace poco; se omite el duplicado.`);
      return 'skipped';
    }

    try {
      await send();
      return 'sent';
    } catch (error) {
      try {
        await this.queue.client.del(markerKey);
      } catch {
        // Si no se puede liberar, la marca caduca sola en 15 min.
      }
      throw error;
    }
  }

  // ==================== CONTEXTO DE ÓRDENES ====================

  private webUrl(): string {
    return String(this.config.get('WEB_URL') ?? process.env.WEB_URL ?? 'http://localhost:3000').replace(/\/$/, '');
  }

  private hashToken(token: string): string {
    // Mismo algoritmo que `orders.service.hashToken`: si divergen, el enlace
    // del correo deja de validar contra `accessTokenHash`.
    return createHash('sha256').update(token).digest('hex');
  }

  /**
   * Emite una credencial de acceso nueva para la orden.
   *
   * Hace falta porque el texto plano del token solo existe al crear la orden:
   * en la base queda su SHA-256. En el flujo diferido (OXXO/SPEI) la
   * confirmación la dispara el webhook días después, sin el token a mano, y en
   * el reenvío desde el panel tampoco lo hay. Sin esto el correo llevaría un
   * enlace que el comprador invitado no puede abrir — la regresión que este
   * cambio viene a cerrar.
   *
   * EFECTO COLATERAL, deliberado: rotar el hash invalida cualquier enlace
   * anterior de esa orden. Se acepta porque el correo que sale a continuación
   * lleva el enlace nuevo y es el canal duradero; el enlace viejo vivía en una
   * pestaña de navegador que a estas alturas ya no existe. Por eso NO se rota
   * en el aviso de pago pendiente, donde el comprador sí está mirando la página
   * del checkout con su token recién emitido.
   */
  private async mintAccessToken(orderId: string): Promise<string | null> {
    const token = randomBytes(32).toString('base64url');
    try {
      await this.prisma.order.update({
        where: { id: orderId },
        data: { accessTokenHash: this.hashToken(token), accessTokenAt: new Date() },
      });
      this.logger.log(`Credencial de acceso renovada para la orden ${orderId} (envío por correo)`);
      return token;
    } catch (error) {
      // Sin credencial el correo sigue saliendo: el enlace servirá a quien
      // tenga sesión, y los datos de la compra están en el propio mensaje.
      this.logger.warn(
        `No se pudo emitir credencial de acceso para ${orderId}: ${error instanceof Error ? error.message : String(error)}`,
      );
      return null;
    }
  }

  /** `{WEB_URL}/orders/{publicId}?t={accessToken}` — el enlace del comprador. */
  private orderUrl(publicId: string, accessToken?: string | null): string {
    const base = `${this.webUrl()}/orders/${encodeURIComponent(publicId)}`;
    return accessToken ? `${base}?t=${encodeURIComponent(accessToken)}` : base;
  }

  private async loadOrder(orderId: string) {
    return this.prisma.order.findUnique({
      where: { id: orderId },
      include: {
        items: { include: { tickets: true, offer: true } },
        event: { include: { venue: true } },
      },
    });
  }

  private eventContext(order: Awaited<ReturnType<NotificationProcessor['loadOrder']>>): EventContext {
    const event = order?.event;
    return {
      title: event?.title ?? 'Evento',
      startsAt: event?.startsAt ?? null,
      endsAt: event?.endsAt ?? null,
      timezone: event?.timezone ?? event?.venue?.timezone ?? null,
      venueName: event?.venue?.name ?? null,
      venueAddress: event?.venue?.address ?? null,
      venueCity: event?.venue?.city ?? null,
      venueState: event?.venue?.state ?? null,
      transferAllowed: Boolean(event?.transferAllowed) && !event?.nonTransferable,
      refundable: event?.refundable !== false,
    };
  }

  /** Aplana la orden en lo que necesitan las plantillas. */
  private orderContext(
    order: Awaited<ReturnType<NotificationProcessor['loadOrder']>>,
    accessToken?: string | null,
  ): OrderEmailContext {
    const tickets = (order?.items ?? []).flatMap((item) =>
      (item.tickets ?? []).map((t) => ({
        code: t.code,
        section: t.section,
        row: t.row,
        seatNumber: t.seatNumber,
        offerName: item.offer?.name ?? null,
      })),
    );
    return {
      publicId: order.publicId,
      buyerName: order.buyerName,
      totalAmount: order.totalAmount,
      currency: String(order.currency ?? 'MXN'),
      paymentMethod: order.paymentMethod,
      tickets,
      event: this.eventContext(order),
      accessUrl: this.orderUrl(order.publicId, accessToken),
      hasAccessToken: Boolean(accessToken),
    };
  }

  // ==================== COMPRADOR ====================

  private async sendOrderConfirmation(payload: Extract<NotificationJob, { type: 'order.confirmation' }>) {
    const order = await this.loadOrder(payload.orderId);
    if (!order) {
      this.logger.warn(`Confirmación cancelada: no existe la orden ${payload.orderId}`);
      return;
    }

    let accessToken = payload.accessToken ?? null;

    /*
     * La credencial se emite DENTRO de la marca de idempotencia. Si se emitiera
     * antes, el reintento de un job cuyo correo ya salió rotaría el hash y
     * dejaría muerto el enlace del correo que el comprador ya tiene en la
     * bandeja: el arreglo habría creado el problema que venía a resolver.
     */
    await this.sendOnce(`order.confirmation:${order.id}:${payload.email}`, async () => {
      // Si el llamador no trajo la credencial (webhook de pago, reenvío desde
      // el panel), se emite una: el correo es el único sitio donde el comprador
      // invitado puede recibirla.
      accessToken = accessToken ?? (await this.mintAccessToken(order.id));
      await this.mail.sendDocument(
        payload.email,
        renderEmailDocument(orderConfirmationEmail(this.orderContext(order, accessToken))),
      );
    });

    /*
     * El PDF va en su propio job (es lo caro) con su propia marca: si el correo
     * salió pero el encolado falló, el reintento omite el correo y sí encola el
     * PDF. Hereda la MISMA credencial; emitir otra invalidaría el enlace del
     * correo recién enviado.
     */
    await this.sendOnce(`order.confirmation.pdf:${order.id}:${payload.email}`, async () => {
      await this.queue.add(
        'dispatch',
        {
          type: 'ticket.pdf',
          orderId: payload.orderId,
          email: payload.email,
          accessToken: accessToken ?? undefined,
        } satisfies NotificationJob,
        {
          delay: 3000,
          attempts: 5,
          backoff: { type: 'exponential', delay: 15_000 },
          removeOnComplete: 200,
          removeOnFail: false,
        },
      );
    });
  }

  private async sendTicketPdf(payload: Extract<NotificationJob, { type: 'ticket.pdf' }>) {
    const order = await this.loadOrder(payload.orderId);
    if (!order) {
      this.logger.warn(`PDF cancelado: no existe la orden ${payload.orderId}`);
      return;
    }

    const ctx = this.orderContext(order, payload.accessToken);
    const tickets = (order.items ?? []).flatMap((item) =>
      (item.tickets ?? []).map((t) => ({
        id: t.id,
        code: t.code,
        section: t.section,
        row: t.row,
        seatNumber: t.seatNumber,
        offerName: item.offer?.name ?? null,
      })),
    );

    await this.sendOnce(`ticket.pdf:${order.id}:${payload.email}`, async () => {
      const pdf = await this.ticketPdf.buildPdfBuffer({
        eventTitle: order.event.title,
        publicId: order.publicId,
        buyerName: order.buyerName,
        eventId: order.eventId,
        tickets,
        event: ctx.event,
        totalAmount: order.totalAmount,
        currency: ctx.currency,
      });

      await this.mail.sendDocument(payload.email, renderEmailDocument(ticketsPdfEmail(ctx)), [
        { filename: `boletos-${order.publicId}.pdf`, content: pdf, contentType: 'application/pdf' },
      ]);
    });
  }

  /**
   * Pago pendiente: referencia OXXO/SPEI y fecha límite REAL.
   *
   * El vencimiento sale del `PaymentIntent`, que es el mismo reloj con el que
   * el worker libera las butacas. Inventar aquí un plazo "de 3 días" sería
   * prometer algo que el inventario no respeta.
   */
  private async sendPaymentPending(payload: Extract<NotificationJob, { type: 'payment.pending' }>) {
    const order = await this.loadOrder(payload.orderId);
    if (!order) {
      this.logger.warn(`Aviso de pago pendiente cancelado: no existe la orden ${payload.orderId}`);
      return;
    }
    const email = payload.email ?? order.buyerEmail;

    const intent = await this.prisma.paymentIntent.findFirst({
      where: { orderId: order.id, status: PaymentStatus.PENDING },
      orderBy: { createdAt: 'desc' },
    });
    const metadata = (intent?.metadata ?? {}) as Record<string, unknown>;

    // NO se emite credencial nueva: el comprador acaba de crear la orden y su
    // navegador tiene el token que devolvió `POST /orders`. Rotarlo dejaría
    // colgada la página de checkout que está mirando en ese momento. Se
    // reutiliza el mismo token, que el llamador nos pasa en claro: sin él el
    // enlace del correo daría 403, y este correo es la única copia duradera de
    // la referencia OXXO/SPEI que conserva quien compra sin cuenta.
    const ctx = this.orderContext(order, payload.accessToken ?? null);

    await this.sendOnce(`payment.pending:${order.id}:${email}`, async () => {
      await this.mail.sendDocument(
        email,
        renderEmailDocument(
          paymentPendingEmail({
            ...ctx,
            reference: (metadata.reference as string) ?? intent?.externalId ?? null,
            clabe: (metadata.clabe as string) ?? null,
            concept: (metadata.concept as string) ?? null,
            expiresAt: intent?.expiresAt ?? order.expiresAt ?? null,
            methodType: (metadata.type as string) ?? order.paymentMethod ?? null,
          }),
        ),
      );
    });
  }

  private async sendPaymentReceived(payload: Extract<NotificationJob, { type: 'payment.received' }>) {
    const order = await this.loadOrder(payload.orderId);
    if (!order) {
      this.logger.warn(`Acuse de pago cancelado: no existe la orden ${payload.orderId}`);
      return;
    }
    const email = payload.email ?? order.buyerEmail;

    // Igual que en la confirmación: la credencial se emite dentro de la marca.
    await this.sendOnce(`payment.received:${order.id}:${email}`, async () => {
      const accessToken = payload.accessToken ?? (await this.mintAccessToken(order.id));
      await this.mail.sendDocument(
        email,
        renderEmailDocument(paymentReceivedEmail(this.orderContext(order, accessToken))),
      );
    });
  }

  private async sendRefund(payload: Extract<NotificationJob, { type: 'refund.notification' }>) {
    const order = await this.loadOrder(payload.orderId);
    await this.sendOnce(`refund:${payload.orderId}:${payload.email}:${payload.amount}`, async () => {
      await this.mail.sendDocument(
        payload.email,
        renderEmailDocument(
          refundEmail({
            publicId: order?.publicId ?? payload.orderId,
            buyerName: order?.buyerName ?? null,
            amount: payload.amount,
            currency: String(order?.currency ?? 'MXN'),
            eventTitle: order?.event?.title ?? 'tu evento',
            reason: payload.reason ?? null,
            partial: payload.partial ?? false,
          }),
        ),
      );
    });
  }

  // ==================== CANCELACIÓN DE EVENTO ====================

  /**
   * Difusión de la cancelación: un job por orden afectada.
   *
   * Se abre uno por orden y no un correo por orden dentro de este job para que
   * un fallo de SMTP en el asistente 800 no obligue a reenviar a los 799
   * anteriores. Cada orden reintenta por su cuenta.
   */
  private async broadcastEventCancelled(payload: Extract<NotificationJob, { type: 'event.cancelled' }>) {
    const orders = await this.prisma.order.findMany({
      where: {
        eventId: payload.eventId,
        status: { in: [OrderStatus.COMPLETED, OrderStatus.PARTIALLY_REFUNDED] },
      },
      select: { id: true },
    });

    for (const order of orders) {
      await this.queue.add(
        'dispatch',
        { type: 'order.event_cancelled', orderId: order.id, reason: payload.reason } satisfies NotificationJob,
        { attempts: 5, backoff: { type: 'exponential', delay: 15_000 }, removeOnComplete: 200, removeOnFail: false },
      );
    }
    this.logger.warn(`Cancelación del evento ${payload.eventId}: ${orders.length} avisos encolados`);
    return { notified: orders.length };
  }

  private async sendOrderEventCancelled(payload: Extract<NotificationJob, { type: 'order.event_cancelled' }>) {
    const order = await this.loadOrder(payload.orderId);
    if (!order) return;

    await this.sendOnce(`event.cancelled:${order.id}`, async () => {
      const accessToken = await this.mintAccessToken(order.id);
      const ctx = this.orderContext(order, accessToken);
      await this.mail.sendDocument(
        order.buyerEmail,
        renderEmailDocument(
          eventCancelledEmail({
            publicId: order.publicId,
            buyerName: order.buyerName,
            event: ctx.event,
            totalAmount: order.totalAmount,
            currency: ctx.currency,
            ticketCount: ctx.tickets.length,
            reason: payload.reason ?? null,
            accessUrl: ctx.accessUrl,
            hasAccessToken: ctx.hasAccessToken,
          }),
        ),
      );
    });
  }

  // ==================== INTERNOS ====================

  private async sendFraudAlert(payload: Extract<NotificationJob, { type: 'fraud.alert' }>) {
    // `orders.service` manda aquí el `publicId` y otros flujos el `id`: se
    // buscan los dos antes que enseñar un aviso sin contexto.
    const order = await this.prisma.order.findFirst({
      where: { OR: [{ id: payload.orderId }, { publicId: payload.orderId }] },
      include: { event: { include: { organization: true } } },
    });
    const adminEmail = this.config.get('FRAUD_ALERT_EMAIL') ?? order?.event?.organization?.email;
    if (!adminEmail) {
      this.logger.warn(
        `Alerta de fraude ${payload.orderId} (score ${payload.score}, ${payload.severity}) SIN destinatario: ` +
          `define FRAUD_ALERT_EMAIL o el correo de la organización.`,
      );
      return;
    }
    const adminUrl = this.config.get<string>('ADMIN_URL');
    await this.sendOnce(`fraud:${payload.orderId}:${payload.severity}`, async () => {
      await this.mail.sendDocument(
        adminEmail,
        renderEmailDocument(
          fraudAlertEmail({
            orderRef: order?.publicId ?? payload.orderId,
            score: payload.score,
            severity: payload.severity,
            eventTitle: order?.event?.title ?? null,
            buyerEmail: order?.buyerEmail ?? null,
            adminUrl: adminUrl ? `${adminUrl.replace(/\/$/, '')}/orders/${order?.publicId ?? ''}` : null,
          }),
        ),
      );
    });
  }

  private async sendResaleAlert(payload: Extract<NotificationJob, { type: 'resale.alert' }>) {
    await this.sendOnce(`resale:${payload.listingId}:${payload.buyerEmail}`, async () => {
      await this.mail.sendDocument(
        payload.buyerEmail,
        renderEmailDocument(resaleAlertEmail({ listingId: payload.listingId, eventTitle: payload.eventTitle })),
      );
    });
  }

  private async sendPayoutReady(payload: Extract<NotificationJob, { type: 'payout.ready' }>) {
    const org = await this.prisma.organization.findUnique({
      where: { id: payload.organizationId },
      select: { name: true },
    });
    await this.sendOnce(`payout:${payload.organizationId}:${payload.amount}`, async () => {
      await this.mail.sendDocument(
        payload.email,
        renderEmailDocument(payoutReadyEmail({ amount: payload.amount, currency: 'MXN', organizationName: org?.name })),
      );
    });
  }

  /**
   * Recordatorio de 24 h. Se busca la última orden del asistente para ese
   * evento y así el correo lleva butacas y enlace, no solo el título.
   */
  private async sendEventReminder(payload: Extract<NotificationJob, { type: 'event.reminder' }>) {
    const order = await this.prisma.order.findFirst({
      where: {
        eventId: payload.eventId,
        status: OrderStatus.COMPLETED,
        OR: [{ userId: payload.userId }, { buyerEmail: payload.email }],
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true },
    });

    if (!order) {
      // Sin orden localizada no hay butacas ni enlace útil: se avisa igual, pero
      // con lo mínimo, en lugar de callar.
      await this.sendOnce(`reminder:${payload.eventId}:${payload.email}`, async () => {
        await this.mail.send({
          to: payload.email,
          subject: `Recordatorio · ${payload.eventTitle}`,
          html: `<p>Tu evento <strong>${payload.eventTitle}</strong> es muy pronto. Abre tus boletos desde tu cuenta antes de salir.</p>`,
        });
      });
      return;
    }

    const full = await this.loadOrder(order.id);
    const ctx = this.orderContext(full, null);
    await this.sendOnce(`reminder:${payload.eventId}:${payload.email}`, async () => {
      await this.mail.sendDocument(payload.email, renderEmailDocument(eventReminderEmail(ctx)));
    });
  }

  // ==================== GENÉRICOS DE OTROS MÓDULOS ====================

  private async sendGenericEmail(payload: Extract<NotificationJob, { type: 'generic.email' }>) {
    const d = payload.data ?? {};
    const doc = (() => {
      switch (payload.template) {
        case 'waitlist-available':
          return waitlistAvailableEmail({
            eventTitle: String(d.eventTitle ?? 'un evento'),
            eventUrl: String(d.eventUrl ?? this.webUrl()),
          });
        case 'password-reset':
          return passwordResetEmail({
            firstName: (d.firstName as string) ?? null,
            resetUrl: String(d.resetUrl ?? this.webUrl()),
          });
        case 'ticket-transfer':
          return ticketTransferEmail({
            eventTitle: String(d.eventTitle ?? 'un evento'),
            transferCode: String(d.transferCode ?? ''),
            acceptUrl: String(d.acceptUrl ?? this.webUrl()),
            message: (d.message as string) ?? null,
          });
        default:
          return null;
      }
    })();

    if (!doc) {
      // Plantilla desconocida: se entrega el asunto como cuerpo (comportamiento
      // previo) y se registra, porque casi siempre es una plantilla nueva que
      // alguien olvidó dar de alta aquí.
      this.logger.warn(`Plantilla de correo desconocida "${payload.template}" para ${payload.to}`);
      await this.mail.send({ to: payload.to, subject: payload.subject, html: `<p>${payload.subject}</p>` });
      return;
    }

    // El asunto de quien encola manda: hay flujos que lo personalizan.
    const rendered = renderEmailDocument({ ...doc, subject: payload.subject || doc.subject });
    // La clave incluye el contenido: dos restablecimientos de contraseña
    // seguidos llevan enlaces distintos y AMBOS deben salir. Si la clave fuera
    // solo plantilla+destinatario, el segundo se descartaría como duplicado.
    const contentKey = createHash('sha1').update(JSON.stringify(d)).digest('hex').slice(0, 12);
    await this.sendOnce(`generic:${payload.template}:${payload.to}:${contentKey}`, async () => {
      await this.mail.sendDocument(payload.to, rendered);
    });
  }
}
