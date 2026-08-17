import { Injectable, Logger } from '@nestjs/common';
import { OrderStatus, PaymentStatus } from '@prisma/client';
import { getBanorteConfig, getProvider, BanorteProvider } from '@boletera/payments';
import { PrismaService } from '../prisma/prisma.service';
import { PaymentService } from './payment.service';

/**
 * Tope de intentos por intent. El worker llama cada 30 s: sin tope, una orden
 * que no se puede completar (reserva perdida, descuadre de importe) se
 * reprocesaría para siempre, llenando la auditoría y golpeando la API de
 * Banorte con la misma consulta cada media hora eternamente.
 */
const DEFAULT_MAX_ATTEMPTS = 5;

function maxReconcileAttempts(): number {
  const raw = Number(process.env.BANORTE_RECONCILE_MAX_ATTEMPTS);
  return Number.isFinite(raw) && raw > 0 ? Math.floor(raw) : DEFAULT_MAX_ATTEMPTS;
}

@Injectable()
export class BanorteReconciliationService {
  private readonly logger = new Logger(BanorteReconciliationService.name);
  private banorte = getProvider('banorte') as BanorteProvider;

  constructor(
    private prisma: PrismaService,
    private payments: PaymentService,
  ) {}

  /** Revisa órdenes WEB pendientes con intent SPEI/OXXO y completa si Banorte confirma pago */
  async reconcilePendingSpei(limit = 50) {
    const cfg = getBanorteConfig();
    if (cfg.isDemo) {
      return { checked: 0, completed: 0, demo: true };
    }

    const pending = await this.prisma.order.findMany({
      where: {
        status: OrderStatus.PENDING,
        channel: 'WEB',
        paymentMethod: { in: ['SPEI', 'OXXO'] },
      },
      take: limit,
      orderBy: { createdAt: 'asc' },
    });

    const maxAttempts = maxReconcileAttempts();
    let completed = 0;
    let failed = 0;
    let skipped = 0;

    for (const order of pending) {
      const intent = await this.prisma.paymentIntent.findFirst({
        where: { orderId: order.id, status: PaymentStatus.PENDING },
        orderBy: { createdAt: 'desc' },
      });
      const externalId = intent?.externalId ?? intent?.id;
      if (!externalId) continue;

      const meta = (intent?.metadata as Record<string, unknown>) ?? {};
      const attempts = Number(meta.reconcileAttempts ?? 0);
      if (attempts >= maxAttempts) {
        skipped++;
        continue;
      }

      try {
        const status = await this.banorte.getPaymentStatus?.(externalId);

        if (status?.status === 'completed') {
          /*
           * El importe liquidado viaja hasta completeOrder: es el único punto
           * donde se puede comparar lo cobrado con lo debido (F1-05). Si no
           * cuadra —o la reserva ya expiró— completeOrder lanza ConflictException
           * y deja la orden en PENDING_REFUND; aquí solo se cuenta el intento.
           */
          await this.payments.completeOrder(order.id, externalId, {
            amount: status.amount,
            currency: status.currency,
            rawCode: status.rawCode,
            source: 'banorte_reconcile',
          });
          completed++;
          continue;
        }

        if (status?.status === 'failed') {
          // Rechazo explícito de Banorte: se cierra el ciclo en vez de sondear sin fin.
          await this.prisma.$transaction([
            this.prisma.order.update({
              where: { id: order.id },
              data: { status: OrderStatus.FAILED },
            }),
            this.prisma.paymentIntent.update({
              where: { id: intent!.id },
              data: {
                status: PaymentStatus.FAILED,
                metadata: {
                  ...meta,
                  reconcileAttempts: attempts + 1,
                  lastReconcileAt: new Date().toISOString(),
                  lastReconcileCode: status.rawCode ?? null,
                },
              },
            }),
          ]);
          failed++;
          continue;
        }

        // 'pending': la referencia sigue sin pagarse; no cuenta como intento fallido.
      } catch (e) {
        const message = e instanceof Error ? e.message : String(e);
        this.logger.warn(
          `Reconcile ${order.publicId}: intento ${attempts + 1}/${maxAttempts} falló — ${message}`,
        );
        if (intent) {
          await this.prisma.paymentIntent.update({
            where: { id: intent.id },
            data: {
              metadata: {
                ...meta,
                reconcileAttempts: attempts + 1,
                lastReconcileAt: new Date().toISOString(),
                lastReconcileError: message.slice(0, 500),
              },
            },
          });
        }
      }
    }

    return { checked: pending.length, completed, failed, skipped, maxAttempts };
  }
}
