import { InjectQueue } from '@nestjs/bull';
import type { OnModuleInit } from '@nestjs/common';
import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { PrismaService } from '../prisma/prisma.service';
import type { Queue, JobOptions } from 'bull';

export const NOTIFICATION_QUEUE = 'notifications';

/**
 * Trabajos de la cola de notificaciones.
 *
 * `accessToken` viaja en el job (no en la base) porque de la orden solo se
 * guarda su SHA-256: el texto plano existe únicamente en el instante de crearla
 * y en el correo que lo entrega. Es la credencial que permite al comprador
 * invitado —el que compró sin cuenta— abrir sus boletos; sin ella, el correo de
 * confirmación es un callejón sin salida.
 */
export type NotificationJob =
  | {
      type: 'order.confirmation';
      orderId: string;
      email: string;
      buyerName: string;
      /** Credencial de acceso del comprador invitado. Opcional: ver arriba. */
      accessToken?: string;
    }
  | { type: 'ticket.pdf'; orderId: string; email: string; accessToken?: string }
  | { type: 'payment.pending'; orderId: string; email?: string; accessToken?: string }
  | { type: 'payment.received'; orderId: string; email?: string; accessToken?: string }
  | { type: 'fraud.alert'; orderId: string; score: number; severity: string }
  | {
      type: 'refund.notification';
      orderId: string;
      email: string;
      amount: number;
      reason?: string;
      partial?: boolean;
    }
  /** Difusión: abre un job por cada orden afectada del evento. */
  | { type: 'event.cancelled'; eventId: string; reason?: string }
  /** Aviso de cancelación para una orden concreta (lo genera el anterior). */
  | { type: 'order.event_cancelled'; orderId: string; reason?: string }
  | { type: 'resale.alert'; listingId: string; buyerEmail: string; eventTitle: string }
  | { type: 'payout.ready'; organizationId: string; amount: number; email: string }
  | { type: 'event.reminder'; eventId: string; userId: string; email: string; eventTitle: string }
  | {
      type: 'generic.email';
      to: string;
      subject: string;
      template: string;
      data: Record<string, unknown>;
    };

/**
 * Opciones por defecto de todos los avisos.
 *
 * - `attempts` + retroceso exponencial: un SMTP que rechaza por límite de tasa
 *   o un DNS que tarda se recuperan solos (15 s, 30 s, 1 min, 2 min, 4 min).
 * - `removeOnFail: false` es deliberado: un correo que no salió tiene que
 *   quedar en la cola de fallidos, donde `getQueueStats()` lo cuenta y
 *   `retryFailedJobs()` lo puede reintentar. Borrarlo es perder el aviso en
 *   silencio, que es exactamente lo que no queremos.
 * - `removeOnComplete: 200` conserva los últimos envíos para poder auditar
 *   "¿se mandó o no?" sin dejar que la cola crezca sin límite.
 */
const DEFAULT_JOB_OPTIONS: JobOptions = {
  attempts: 5,
  backoff: { type: 'exponential', delay: 15_000 },
  removeOnComplete: 200,
  removeOnFail: false,
};

function jobOptions(overrides: JobOptions = {}): JobOptions {
  return { ...DEFAULT_JOB_OPTIONS, ...overrides };
}

@Injectable()
export class NotificationService implements OnModuleInit {
  private readonly logger = new Logger(NotificationService.name);

  constructor(
    @InjectQueue(NOTIFICATION_QUEUE) private readonly queue: Queue,
    private readonly configService: ConfigService,
    private readonly prisma: PrismaService,
  ) {}

  /**
   * Bull deja que los errores de su worker suban como rechazos sin capturar.
   *
   * Con `enableOfflineQueue: false` —necesario para que encolar falle rápido en
   * vez de secuestrar la petición de compra— el worker sondea Redis y cada
   * sondeo falla mientras esté caído. Sin este manejador, el primero de esos
   * rechazos tumba el proceso entero: el API se moría a los pocos segundos de
   * arrancar sin Redis.
   *
   * Con él, la cola queda inservible pero el API sigue vendiendo. Los avisos se
   * pierden y se registran; la venta, que es lo que no se puede perder, no.
   */
  onModuleInit(): void {
    this.queue.on('error', (error: Error) => {
      const message = error?.message ?? String(error);
      if (message === this.lastQueueError) return; // no inundar el log
      this.lastQueueError = message;
      this.logger.error(
        `Cola de notificaciones no disponible (${message}). ` +
          'Las compras siguen funcionando; los avisos quedan sin enviar.',
      );
    });
  }

  /** Último error de cola registrado, para no repetir la misma línea sin fin. */
  private lastQueueError: string | null = null;

  // ==================== ORDER NOTIFICATIONS ====================

  /**
   * Confirmación de compra.
   *
   * El cuarto parámetro es aditivo a propósito: `admin.service` sigue llamando
   * con tres argumentos. Cuando llega `accessToken`, el correo enlaza a
   * `{WEB_URL}/orders/{publicId}?t=…` y el comprador sin cuenta puede abrir sus
   * boletos; cuando no llega, el procesador emite una credencial nueva (ver
   * `notification.processor.ts`).
   */
  async enqueueOrderConfirmation(
    orderId: string,
    email: string,
    buyerName: string,
    options?: { accessToken?: string },
  ) {
    await this.queue.add(
      'dispatch',
      {
        type: 'order.confirmation',
        orderId,
        email,
        buyerName,
        accessToken: options?.accessToken,
      } satisfies NotificationJob,
      jobOptions(),
    );
    this.logger.log(
      `Queued order confirmation for ${orderId}${options?.accessToken ? ' (con credencial de acceso)' : ''}`,
    );
  }

  async enqueueTicketPDF(orderId: string, email: string, options?: { accessToken?: string }) {
    await this.queue.add(
      'dispatch',
      { type: 'ticket.pdf', orderId, email, accessToken: options?.accessToken } satisfies NotificationJob,
      jobOptions({ delay: 5000 }),
    );
    this.logger.log(`Queued ticket PDF generation for ${orderId}`);
  }

  /**
   * Aviso de pago pendiente (OXXO/SPEI): referencia y fecha límite real.
   *
   * El procesador lee la referencia y el vencimiento del `PaymentIntent`, así
   * que quien dispara esto solo necesita el id de la orden. Falta el disparador
   * en el flujo de creación de órdenes diferidas (ver entrega).
   */
  async enqueuePaymentPending(
    orderId: string,
    email?: string,
    options?: { accessToken?: string },
  ) {
    await this.queue.add(
      'dispatch',
      {
        type: 'payment.pending',
        orderId,
        email,
        accessToken: options?.accessToken,
      } satisfies NotificationJob,
      jobOptions(),
    );
    this.logger.log(`Queued pending-payment notice for ${orderId}`);
  }

  /** Acuse de pago recibido. */
  async enqueuePaymentReceived(orderId: string, email?: string, options?: { accessToken?: string }) {
    await this.queue.add(
      'dispatch',
      { type: 'payment.received', orderId, email, accessToken: options?.accessToken } satisfies NotificationJob,
      jobOptions(),
    );
    this.logger.log(`Queued payment-received notice for ${orderId}`);
  }

  // ==================== FRAUD NOTIFICATIONS ====================

  async enqueueFraudAlert(orderId: string, score: number, severity: string) {
    await this.queue.add(
      'dispatch',
      { type: 'fraud.alert', orderId, score, severity } satisfies NotificationJob,
      jobOptions({ priority: 1 }),
    );
    this.logger.warn(`Queued fraud alert for ${orderId} (score: ${score}, severity: ${severity})`);
  }

  // ==================== REFUND NOTIFICATIONS ====================

  async enqueueRefundNotification(
    orderId: string,
    email: string,
    amount: number,
    options?: { reason?: string; partial?: boolean },
  ) {
    await this.queue.add(
      'dispatch',
      {
        type: 'refund.notification',
        orderId,
        email,
        amount,
        reason: options?.reason,
        partial: options?.partial,
      } satisfies NotificationJob,
      jobOptions(),
    );
    this.logger.log(`Queued refund notification for ${orderId}`);
  }

  // ==================== EVENT CANCELLATION ====================

  /**
   * Cancelación de evento: un solo job de difusión que abre uno por orden.
   *
   * Se hace en dos etapas para que el reintento de un correo no reenvíe el
   * aviso a todo el aforo. Falta el disparador en el módulo de eventos (ver
   * entrega).
   */
  async enqueueEventCancelled(eventId: string, reason?: string) {
    await this.queue.add(
      'dispatch',
      { type: 'event.cancelled', eventId, reason } satisfies NotificationJob,
      jobOptions({ attempts: 3 }),
    );
    this.logger.warn(`Queued cancellation broadcast for event ${eventId}`);
  }

  // ==================== RESALE NOTIFICATIONS ====================

  async enqueueResaleAlert(listingId: string, buyerEmail: string, eventTitle: string) {
    await this.queue.add(
      'dispatch',
      { type: 'resale.alert', listingId, buyerEmail, eventTitle } satisfies NotificationJob,
      jobOptions(),
    );
    this.logger.log(`Queued resale alert for ${listingId}`);
  }

  // ==================== PAYOUT NOTIFICATIONS ====================

  async enqueuePayoutReady(organizationId: string, amount: number, email: string) {
    await this.queue.add(
      'dispatch',
      { type: 'payout.ready', organizationId, amount, email } satisfies NotificationJob,
      jobOptions(),
    );
    this.logger.log(`Queued payout notification for org ${organizationId}`);
  }

  // ==================== EVENT REMINDERS ====================

  async enqueueEventReminder(eventId: string, userId: string, email: string, eventTitle: string) {
    await this.queue.add(
      'dispatch',
      { type: 'event.reminder', eventId, userId, email, eventTitle } satisfies NotificationJob,
      jobOptions({ delay: 24 * 60 * 60 * 1000, attempts: 3 }), // 24 h antes
    );
    this.logger.log(`Queued event reminder for ${eventId}`);
  }

  async enqueueEmail(payload: {
    to: string;
    subject: string;
    template: string;
    data: Record<string, unknown>;
  }) {
    await this.queue.add(
      'dispatch',
      {
        type: 'generic.email',
        to: payload.to,
        subject: payload.subject,
        template: payload.template,
        data: payload.data,
      } satisfies NotificationJob,
      jobOptions(),
    );
    this.logger.log(`Queued generic email to ${payload.to} (${payload.template})`);
  }

  // ==================== QUEUE MANAGEMENT ====================

  async getQueueStats() {
    const [waiting, active, completed, failed, delayed] = await Promise.all([
      this.queue.getWaitingCount(),
      this.queue.getActiveCount(),
      this.queue.getCompletedCount(),
      this.queue.getFailedCount(),
      this.queue.getDelayedCount(),
    ]);

    return { waiting, active, completed, failed, delayed };
  }

  /**
   * Reintenta los avisos fallidos. Es una acción manual de operación, así que
   * se reintentan todos: antes se filtraba por `attemptsMade < 3` y, como los
   * jobs agotan 5 intentos antes de fallar, el filtro no reintentaba nunca nada.
   */
  async retryFailedJobs() {
    const failed = await this.queue.getFailed(0, -1);
    let retried = 0;

    for (const job of failed) {
      try {
        await job.retry();
        retried++;
      } catch (error) {
        this.logger.warn(
          `No se pudo reintentar el job ${job.id}: ${error instanceof Error ? error.message : String(error)}`,
        );
      }
    }

    this.logger.log(`Retried ${retried} failed jobs`);
    return { retried };
  }

  async clearQueue() {
    await this.queue.empty();
    this.logger.log('Queue cleared');
  }
}
