import {
  BadRequestException,
  ConflictException,
  HttpException,
  HttpStatus,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { RedisService } from '../../common/redis.service';
import { NotificationService } from '../notification/notification.service';
import { PrismaService } from '../prisma/prisma.service';
import { checkClabe, maskClabe, maskEmail } from './clabe';
import type { OrderRequester } from './orders.dto';
import { OrdersService } from './orders.service';

/** Reenvíos permitidos por orden: uno por minuto y tres por hora. */
export const RESEND_MIN_INTERVAL_S = 60;
export const RESEND_HOURLY_LIMIT = 3;
export const RESEND_WINDOW_S = 60 * 60;

/** Estados con boletos vivos que tiene sentido reenviar. */
const RESENDABLE_STATUSES = new Set(['COMPLETED', 'PARTIALLY_REFUNDED']);

/**
 * Métodos cuyo reembolso vuelve solo al instrumento de pago (tarjeta o
 * cuenta PayPal). Ahí pedir CLABE no tiene sentido y abriría la puerta a
 * desviar el dinero a otra cuenta.
 */
const CARD_LIKE_METHODS = new Set(['CARD', 'CLIP', 'APPLE_PAY', 'GOOGLE_PAY', 'PAYPAL']);

const HOLDER_MIN = 3;

/** 429 con la misma forma `{ statusCode, message }` que el resto del API. */
function tooManyRequests(message: string) {
  return new HttpException(
    { statusCode: HttpStatus.TOO_MANY_REQUESTS, message, error: 'Too Many Requests' },
    HttpStatus.TOO_MANY_REQUESTS
  );
}
const HOLDER_MAX = 120;

/**
 * Acciones que el comprador hace sobre su propia orden: reenviar el boleto y
 * dejar su CLABE para un reembolso que no vuelve a tarjeta.
 *
 * La identidad se acredita en `OrdersService.authorizeBuyerAction`, con la
 * misma regla que `GET /orders/:publicId` (JWT del dueño, correo del
 * comprador o token del enlace del correo).
 */
@Injectable()
export class BuyerSelfServiceService {
  private readonly logger = new Logger(BuyerSelfServiceService.name);

  /**
   * Respaldo en memoria si Redis no responde. Con varias réplicas el límite
   * real se multiplica, pero no se abre del todo: es correo hacia el
   * comprador, no dinero, y se prefiere eso a negar el reenvío.
   */
  private readonly memory = new Map<string, number[]>();

  constructor(
    private readonly orders: OrdersService,
    private readonly prisma: PrismaService,
    private readonly notifications: NotificationService,
    private readonly redis: RedisService
  ) {}

  async resendTickets(publicId: string, requester: OrderRequester) {
    const order = await this.orders.authorizeBuyerAction(publicId, requester);
    if (!RESENDABLE_STATUSES.has(order.status)) {
      throw new ConflictException(
        'Solo podemos reenviar el boleto de una orden pagada. Si pagaste en OXXO o SPEI, llega en cuanto se acredite.'
      );
    }

    await this.consumeResendSlot(order.id);

    // Mismo envío que `POST /admin/orders/:id/resend-email`.
    await this.notifications.enqueueOrderConfirmation(
      order.id,
      order.buyerEmail,
      order.buyerName ?? ''
    );
    await this.notifications.enqueueTicketPDF(order.id, order.buyerEmail);

    const sentTo = maskEmail(order.buyerEmail);
    this.logger.log(
      `Reenvío de boleto pedido por el comprador: orden ${order.publicId} → ${sentTo}`
    );
    return { ok: true, sentTo };
  }

  async savePayoutClabe(
    publicId: string,
    refundId: string,
    requester: OrderRequester,
    body: { clabe?: unknown; accountHolder?: unknown }
  ) {
    const order = await this.orders.authorizeBuyerAction(publicId, requester);

    // Un reembolso de otra orden responde igual que uno que no existe: no se
    // confirma la existencia de ids ajenos.
    const refund = await this.prisma.refund.findFirst({
      where: { id: refundId, orderId: order.id },
      select: { id: true, status: true },
    });
    if (!refund) throw new NotFoundException('Reembolso no encontrado en esta orden');

    if (refund.status !== 'PENDING') {
      throw new ConflictException(
        'Este reembolso ya no está pendiente; la cuenta no se puede cambiar. Escríbenos si hay un problema.'
      );
    }

    // El método se lee de la orden y, si existe, del pago liquidado. Sin
    // ninguno de los dos no se puede saber si fue con tarjeta: se permite
    // porque la guarda de PENDING sigue en pie y finanzas revisa la CLABE
    // antes de pagar.
    const method = String(order.payment?.method ?? order.paymentMethod ?? '').toUpperCase();
    if (CARD_LIKE_METHODS.has(method)) {
      throw new ConflictException(
        'Pagaste con tarjeta: el reembolso vuelve a la misma tarjeta y no necesitamos tu CLABE.'
      );
    }

    const check = checkClabe(body.clabe);
    if (check.ok === false) throw new BadRequestException(check.message);

    const holder = typeof body.accountHolder === 'string' ? body.accountHolder.trim() : '';
    if (holder.length < HOLDER_MIN || holder.length > HOLDER_MAX) {
      throw new BadRequestException(
        `Escribe el nombre del titular de la cuenta (entre ${HOLDER_MIN} y ${HOLDER_MAX} caracteres).`
      );
    }

    const saved = await this.prisma.refund.update({
      where: { id: refund.id },
      data: {
        payoutClabe: check.clabe,
        payoutAccountHolder: holder,
        payoutClabeAt: new Date(),
      },
      select: { id: true, payoutClabe: true, payoutAccountHolder: true, payoutClabeAt: true },
    });

    this.logger.log(
      `CLABE de reembolso registrada: orden ${order.publicId}, reembolso ${saved.id}, cuenta ${maskClabe(saved.payoutClabe)}`
    );

    return {
      refundId: saved.id,
      payoutClabe: maskClabe(saved.payoutClabe),
      payoutAccountHolder: saved.payoutAccountHolder,
      payoutClabeAt: saved.payoutClabeAt,
    };
  }

  /**
   * Reserva un reenvío o lanza 429.
   *
   * Orden de las comprobaciones: primero el tope por hora (sin contar el
   * intento), luego el candado de un minuto (SET NX) y solo entonces se suma
   * al contador horario. Así los intentos rechazados no gastan cupo.
   */
  private async consumeResendSlot(orderId: string) {
    const minuteKey = `orders:resend:min:${orderId}`;
    const hourKey = `orders:resend:hour:${orderId}`;

    if (this.redis.isReady) {
      const used = Number((await this.redis.get(hourKey)) ?? 0);
      if (used >= RESEND_HOURLY_LIMIT) throw this.hourlyLimit();

      const lock = await this.redis.acquireLock(minuteKey, '1', RESEND_MIN_INTERVAL_S);
      if (lock === 'TAKEN') throw this.minuteLimit();
      if (lock === 'ACQUIRED') {
        const count = await this.redis.incrementWithTtl(hourKey, 1, RESEND_WINDOW_S);
        if (count !== null) return;
      }
      // Redis dejó de responder a mitad: se cae al respaldo en memoria.
    }

    this.consumeInMemory(orderId);
  }

  private consumeInMemory(orderId: string, now = Date.now()) {
    const recent = (this.memory.get(orderId) ?? []).filter(
      (at) => now - at < RESEND_WINDOW_S * 1000
    );
    if (recent.length >= RESEND_HOURLY_LIMIT) throw this.hourlyLimit();
    const last = recent[recent.length - 1];
    if (last !== undefined && now - last < RESEND_MIN_INTERVAL_S * 1000) throw this.minuteLimit();
    recent.push(now);
    this.memory.set(orderId, recent);
  }

  private minuteLimit() {
    return tooManyRequests(
      'Acabamos de reenviar tu boleto. Espera un minuto antes de pedirlo otra vez y revisa tu carpeta de spam.'
    );
  }

  private hourlyLimit() {
    return tooManyRequests(
      `Ya reenviamos este boleto ${RESEND_HOURLY_LIMIT} veces en la última hora. Inténtalo más tarde.`
    );
  }
}
