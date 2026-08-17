import type { AiRecommendation } from '@boletera/shared';
import type { WaitlistRow } from '@/lib/platform-api';
import type { ApiKey } from '@/lib/queries/partners';
import type { CrmCustomerRow, CrmKpis, CrmRecommendation } from './types';

const PRIORITY_RANK: Record<CrmRecommendation['priority'], number> = {
  urgent: 0,
  high: 1,
  medium: 2,
  low: 3,
};

/**
 * Recomendaciones accionables: heurísticas a partir de conteos observados
 * + insights de GET /ai/recommendations cuando existan. No inventa métricas.
 */
export function buildCrmRecommendations(input: {
  customers: readonly CrmCustomerRow[];
  kpis: CrmKpis;
  waitlist: readonly WaitlistRow[];
  apiKeys: readonly ApiKey[];
  ai: readonly AiRecommendation[] | undefined;
}): CrmRecommendation[] {
  const out: CrmRecommendation[] = [];
  const atRisk = input.customers.filter((c) => c.segment === 'at_risk').length;
  const inactiveVip = input.customers.filter(
    (c) => c.segment === 'inactive' && c.completedOrders >= 2 && c.totalSpend > 0,
  ).length;
  const waiting = input.waitlist.filter((w) => {
    const s = w.status.toUpperCase();
    return s === 'WAITING' || s === 'PENDING' || s === 'ACTIVE' || s === 'QUEUED';
  }).length;
  const staleKeys = input.apiKeys.filter((k) => k.active && !k.lastUsedAt).length;

  if (atRisk >= 3) {
    out.push({
      id: 'reactivate-at-risk',
      source: 'derived',
      priority: atRisk >= 10 ? 'high' : 'medium',
      title: `Reactivar ${atRisk} clientes en riesgo`,
      rationale:
        'Hay compradores con última compra entre 90 y 180 días. La señal proviene del historial de pedidos cargado.',
      action: 'Lanza una campaña de reactivación segmentada a “En riesgo”.',
    });
  }

  if (input.kpis.churnHigh >= 5) {
    out.push({
      id: 'churn-high',
      source: 'derived',
      priority: 'high',
      title: `${input.kpis.churnHigh} perfiles con churn alto (recencia)`,
      rationale:
        'El riesgo local se estima solo por días desde la última compra completada; no es un modelo predictivo.',
      action: 'Prioriza outreach a altos LTV dentro del listado de churn.',
    });
  }

  if (waiting > 0) {
    out.push({
      id: 'waitlist-demand',
      source: 'derived',
      priority: waiting >= 20 ? 'high' : 'medium',
      title: `${waiting} interesados en lista de espera`,
      rationale:
        'Conteo observado en GET /waitlist/organization. No implica conversión garantizada.',
      action: 'Notifica liberaciones de inventario a la lista de espera activa.',
    });
  }

  if (inactiveVip > 0) {
    out.push({
      id: 'winback-repeat',
      source: 'derived',
      priority: 'medium',
      title: `${inactiveVip} repetidores inactivos (>180 días)`,
      rationale: 'Clientes con 2+ pedidos completados sin actividad reciente en la muestra.',
      action: 'Prepara un win-back con beneficio acotado y medición de respuesta.',
    });
  }

  if (input.kpis.frequent >= 3) {
    out.push({
      id: 'frequent-vip-path',
      source: 'derived',
      priority: 'low',
      title: `${input.kpis.frequent} compradores frecuentes (3+ pedidos)`,
      rationale: 'Frecuencia observada en pedidos completados de la muestra actual.',
      action: 'Considera beneficios de lealtad o early access para este grupo.',
    });
  }

  if (staleKeys > 0) {
    out.push({
      id: 'partner-keys-idle',
      source: 'derived',
      priority: 'low',
      title: `${staleKeys} claves partner activas sin uso`,
      rationale:
        'Señal B2B de GET /partners/:org/keys (lastUsedAt nulo). No es un score de partner CRM.',
      action: 'Revisa alcance y rotación de claves inactivas con el equipo de partners.',
    });
  }

  if (input.customers.length === 0) {
    out.push({
      id: 'no-customers',
      source: 'derived',
      priority: 'medium',
      title: 'Sin cartera para segmentar',
      rationale: 'No hay compradores derivados de pedidos en la respuesta actual.',
      action: 'Confirma ventas o importa pedidos para activar LTV, RFM y perfiles.',
    });
  }

  for (const rec of input.ai ?? []) {
    out.push({
      id: `ai-${rec.id}`,
      source: 'ai',
      priority: rec.priority,
      title: rec.title,
      rationale: rec.rationale,
      action: rec.action,
    });
  }

  return out.sort(
    (a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority],
  );
}
