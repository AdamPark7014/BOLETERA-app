import type {
  AccessAttendanceMetrics,
  CampaignFunnelMetrics,
  EventSalesPaceMetrics,
  ExecutiveSummaryMetrics,
  InventoryMetrics,
  OrdersPaymentsMetrics,
  WaitlistMetrics,
} from '@boletera/shared';
import {
  formatCount,
  formatMoney,
  formatPercentPoints,
  formatRatio,
} from './format';
import { largestFunnelDrop } from './series';

export type InsightTone = 'positive' | 'neutral' | 'warning' | 'critical';

export interface Insight {
  id: string;
  tone: InsightTone;
  title: string;
  /** Explicación con las cifras que sustentan la lectura. */
  detail: string;
}

export interface InsightSources {
  executive?: ExecutiveSummaryMetrics;
  pace?: EventSalesPaceMetrics;
  inventory?: InventoryMetrics;
  orders?: OrdersPaymentsMetrics;
  campaigns?: CampaignFunnelMetrics;
  waitlist?: WaitlistMetrics;
  access?: AccessAttendanceMetrics;
  comparisonLabel: string;
}

const TONE_WEIGHT: Record<InsightTone, number> = {
  critical: 0,
  warning: 1,
  positive: 2,
  neutral: 3,
};

/**
 * Traduce los agregados ya cargados en lecturas accionables. Todo sale de los
 * contratos: si un dominio no está disponible simplemente no aporta hallazgos.
 */
export function buildInsights(sources: InsightSources): Insight[] {
  const insights: Insight[] = [];
  const { executive, pace, inventory, orders, campaigns, waitlist, access } = sources;

  if (executive) {
    const revenue = executive.kpis.grossRevenue;
    if (revenue.deltaPercent !== null && Math.abs(revenue.deltaPercent) >= 5) {
      const growing = revenue.deltaPercent > 0;
      insights.push({
        id: 'revenue-trend',
        tone: growing ? 'positive' : 'warning',
        title: growing ? 'El ingreso acelera' : 'El ingreso se desacelera',
        detail: `${formatMoney(revenue.value)} contra ${formatMoney(revenue.previousValue)} en ${sources.comparisonLabel.toLowerCase()} (${formatPercentPoints(revenue.deltaPercent)}).`,
      });
    }

    const { projection } = executive;
    if (projection.daysElapsed < projection.daysInPeriod) {
      insights.push({
        id: 'projection',
        tone: 'neutral',
        title: 'Proyección al cierre del periodo',
        detail: `Al ritmo actual el periodo cierra en ${formatMoney(projection.projectedGrossRevenue)} y ${formatCount(projection.projectedTicketsSold)} boletos; llevas ${formatCount(projection.daysElapsed)} de ${formatCount(projection.daysInPeriod)} días.`,
      });
    }

    const channels = executive.revenueByChannel;
    const leader = [...channels.rows].sort((a, b) => b.value - a.value)[0];
    if (leader && channels.total > 0) {
      const share = (leader.value / channels.total) * 100;
      if (share >= 70) {
        insights.push({
          id: 'channel-concentration',
          tone: 'warning',
          title: 'Ingreso concentrado en un canal',
          detail: `${leader.label} aporta ${formatPercentPoints(share, 0)} del ingreso. Diversificar reduce el riesgo operativo.`,
        });
      }
    }
  }

  if (pace) {
    const risky = pace.events.filter(
      (event) => event.riskLevel === 'at_risk' || event.riskLevel === 'critical',
    );
    const worst = [...risky].sort((a, b) => a.paceDelta - b.paceDelta)[0];
    if (worst) {
      insights.push({
        id: 'pace-risk',
        tone: worst.riskLevel === 'critical' ? 'critical' : 'warning',
        title: `${formatCount(risky.length)} evento(s) por debajo de su curva de venta`,
        detail: `«${worst.title}» va en ${formatRatio(worst.actualPace, 0)} contra ${formatRatio(worst.expectedPace, 0)} esperado, a ${formatCount(worst.daysUntilEvent)} días del evento.`,
      });
    } else if (pace.topPerformers.length > 0) {
      const best = pace.topPerformers[0];
      if (best) {
        insights.push({
          id: 'pace-top',
          tone: 'positive',
          title: 'Todos los eventos van en curva',
          detail: `«${best.title}» lidera con ${formatPercentPoints(best.occupancyPercent, 0)} de ocupación y ${formatMoney(best.grossRevenue)} vendidos.`,
        });
      }
    }
  }

  if (inventory) {
    const urgent = inventory.byZone
      .filter((zone) => zone.daysToSellOut !== null && zone.remainingQuantity > 0)
      .sort((a, b) => (a.daysToSellOut ?? 0) - (b.daysToSellOut ?? 0))[0];
    if (urgent && urgent.daysToSellOut !== null && urgent.daysToSellOut <= 14) {
      insights.push({
        id: 'inventory-sellout',
        tone: 'positive',
        title: 'Zona a punto de agotarse',
        detail: `${urgent.zone} · ${urgent.tierName} (${urgent.eventTitle}) se agota en ~${formatCount(Math.ceil(urgent.daysToSellOut))} días con ${formatCount(urgent.remainingQuantity)} lugares restantes. Considera abrir cupo o subir precio.`,
      });
    }

    if (inventory.summary.activeHolds > 0 && inventory.summary.totalCapacity > 0) {
      const holdShare = (inventory.summary.held / inventory.summary.totalCapacity) * 100;
      if (holdShare >= 10) {
        insights.push({
          id: 'inventory-holds',
          tone: 'warning',
          title: 'Inventario retenido por apartados',
          detail: `${formatPercentPoints(holdShare, 0)} del aforo está en ${formatCount(inventory.summary.activeHolds)} apartados activos. Revisa expiraciones si la disponibilidad aprieta.`,
        });
      }
    }
  }

  if (orders) {
    const approval = orders.kpis.approvalRate;
    if (approval.value < 90) {
      insights.push({
        id: 'approval-rate',
        tone: approval.value < 80 ? 'critical' : 'warning',
        title: 'Aprobación de pagos por debajo del objetivo',
        detail: `${formatPercentPoints(approval.value)} de las órdenes se completan (antes ${formatPercentPoints(approval.previousValue)}). Revisa rechazos por método de pago.`,
      });
    }

    const refunds = orders.kpis.refundRate;
    if (refunds.value >= 8) {
      insights.push({
        id: 'refund-rate',
        tone: refunds.value >= 15 ? 'critical' : 'warning',
        title: 'Reembolsos elevados',
        detail: `Tasa de reembolso en ${formatPercentPoints(refunds.value)} contra ${formatPercentPoints(refunds.previousValue)} del periodo anterior.`,
      });
    }
  }

  if (waitlist && waitlist.funnel.stages.length > 1) {
    const drop = largestFunnelDrop(waitlist.funnel);
    if (drop && drop.retainedPercent < 60) {
      insights.push({
        id: 'waitlist-drop',
        tone: 'warning',
        title: 'Fuga en la lista de espera',
        detail: `Solo ${formatPercentPoints(drop.retainedPercent, 0)} pasa de «${drop.previousLabel}» a «${drop.label}». Acorta la ventana de notificación.`,
      });
    }
  }

  if (campaigns) {
    const poor = campaigns.promotions.filter((promotion) => promotion.performance === 'poor');
    const strong = [...campaigns.promotions]
      .filter((promotion) => promotion.performance === 'strong')
      .sort((a, b) => b.revenueAttributed - a.revenueAttributed)[0];
    if (strong) {
      insights.push({
        id: 'campaign-strong',
        tone: 'positive',
        title: `«${strong.code}» es la promoción más rentable`,
        detail: `${formatMoney(strong.revenueAttributed)} atribuidos en ${formatCount(strong.ordersAttributed)} órdenes con ${formatMoney(strong.discountGiven)} de descuento otorgado.`,
      });
    }
    if (poor.length > 0) {
      insights.push({
        id: 'campaign-poor',
        tone: 'warning',
        title: `${formatCount(poor.length)} promoción(es) sin tracción`,
        detail: `Códigos con conversión baja frente a su cupo asignado. Reasigna el presupuesto o cierra las campañas.`,
      });
    }
  }

  if (access && access.ticketsSold > 0 && access.noShowRate >= 15) {
    insights.push({
      id: 'no-show',
      tone: access.noShowRate >= 30 ? 'critical' : 'warning',
      title: 'No-show por encima de lo esperado',
      detail: `${formatPercentPoints(access.noShowRate)} de los boletos vendidos no accedieron (${formatCount(access.ticketsNoShow)} de ${formatCount(access.ticketsSold)}).`,
    });
  }

  return insights.sort((a, b) => TONE_WEIGHT[a.tone] - TONE_WEIGHT[b.tone]).slice(0, 6);
}
