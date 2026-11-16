import type { AiRecommendation } from '@boletera/shared';
import type { WaitlistRow } from '@/lib/platform-api';
import type { ApiKey } from '@/lib/queries/partners';
import type { CrmCustomerRow, CrmKpis, CrmRecommendation } from './types';

const MONTHS = ['ene', 'feb', 'mar', 'abr', 'may', 'jun', 'jul', 'ago', 'sep', 'oct', 'nov', 'dic'];

/**
 * Texto del motor de recomendaciones en lenguaje de negocio: sin z-score ni
 * paréntesis estadísticos y con fechas «5 nov» en lugar de ISO.
 */
export function plainText(text: string): string {
  return text
    .replace(/\s*\([^)]*\bz\s*=[^)]*\)/gi, '')
    .replace(/[;,]?\s*\bz\s*=\s*-?[\d.]+/gi, '')
    .replace(
      /\b(\d{4})-(\d{2})-(\d{2})(?:T[\d:.]+Z?)?\b/g,
      (_match, _year, month: string, day: string) =>
        `${Number(day)} ${MONTHS[Number(month) - 1] ?? month}`
    )
    .replace(/\s{2,}/g, ' ')
    .trim();
}

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
    (c) => c.segment === 'inactive' && c.completedOrders >= 2 && c.totalSpend > 0
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
      rationale: 'Compraron por última vez hace 3 a 6 meses.',
      action: 'Envíales una campaña de regreso.',
    });
  }

  if (input.kpis.churnHigh >= 5) {
    out.push({
      id: 'churn-high',
      source: 'derived',
      priority: 'high',
      title: `${input.kpis.churnHigh} clientes podrían no volver`,
      rationale: 'Llevan mucho tiempo sin comprar.',
      action: 'Contacta primero a los que más han gastado.',
    });
  }

  if (waiting > 0) {
    out.push({
      id: 'waitlist-demand',
      source: 'derived',
      priority: waiting >= 20 ? 'high' : 'medium',
      title: `${waiting} interesados en lista de espera`,
      rationale: 'Esperan que se liberen boletos.',
      action: 'Avísales cuando abras más lugares.',
    });
  }

  if (inactiveVip > 0) {
    out.push({
      id: 'winback-repeat',
      source: 'derived',
      priority: 'medium',
      title: `${inactiveVip} clientes frecuentes sin comprar en 6 meses`,
      rationale: 'Compraron dos o más veces y dejaron de hacerlo.',
      action: 'Ofréceles un beneficio para volver.',
    });
  }

  if (input.kpis.frequent >= 3) {
    out.push({
      id: 'frequent-vip-path',
      source: 'derived',
      priority: 'low',
      title: `${input.kpis.frequent} clientes compran seguido`,
      rationale: 'Tres compras o más.',
      action: 'Dales preventa o un beneficio de lealtad.',
    });
  }

  if (staleKeys > 0) {
    out.push({
      id: 'partner-keys-idle',
      source: 'derived',
      priority: 'low',
      title: `${staleKeys} llaves de socios sin usar`,
      rationale: 'Están activas y nunca se han usado.',
      action: 'Revisa si siguen haciendo falta.',
    });
  }

  if (input.customers.length === 0) {
    out.push({
      id: 'no-customers',
      source: 'derived',
      priority: 'medium',
      title: 'Aún no hay clientes',
      rationale: 'Aparecen con la primera venta.',
      action: 'Publica un evento para empezar a vender.',
    });
  }

  for (const rec of input.ai ?? []) {
    out.push({
      id: `ai-${rec.id}`,
      source: 'ai',
      priority: rec.priority,
      title: plainText(rec.title),
      rationale: plainText(rec.rationale),
      action: plainText(rec.action),
    });
  }

  return out.sort((a, b) => PRIORITY_RANK[a.priority] - PRIORITY_RANK[b.priority]);
}
