import type { ChartDatum } from '@boletera/ui';
import type {
  OfferRecommendation,
  PendingRecommendation,
  PricingDirection,
  RecommendationBundle,
} from './types';

/** La API rechaza aprobaciones de más de 24 h: hay que avisarlo antes. */
export const PENDING_TTL_MS = 24 * 60 * 60 * 1000;

export const PAGE_SIZES = [10, 25, 50] as const;

export type PageSize = (typeof PAGE_SIZES)[number];

export function isPageSize(value: number): value is PageSize {
  return PAGE_SIZES.some((size) => size === value);
}

export type Paged<T> = {
  rows: readonly T[];
  /** Página efectiva tras acotar al rango disponible (base 1). */
  page: number;
  pageCount: number;
  total: number;
  /** Índice humano del primer y último elemento mostrados. */
  from: number;
  to: number;
};

export function paginate<T>(
  rows: readonly T[],
  page: number,
  pageSize: PageSize,
): Paged<T> {
  const total = rows.length;
  const pageCount = Math.max(1, Math.ceil(total / pageSize));
  const current = Math.min(Math.max(page, 1), pageCount);
  const start = (current - 1) * pageSize;
  const slice = rows.slice(start, start + pageSize);
  return {
    rows: slice,
    page: current,
    pageCount,
    total,
    from: total === 0 ? 0 : start + 1,
    to: start + slice.length,
  };
}

export type RecommendationSummary = {
  total: number;
  increases: number;
  decreases: number;
  holds: number;
  /** Se pueden aplicar sin firma humana (Δ dentro del tope automático). */
  autoApplicable: number;
  requiresApproval: number;
  /** El motor recortó el precio candidato para no salirse de la banda. */
  clamped: number;
};

export function summarizeRecommendations(
  recommendations: readonly OfferRecommendation[],
): RecommendationSummary {
  return recommendations.reduce<RecommendationSummary>(
    (summary, item) => ({
      total: summary.total + 1,
      increases: summary.increases + (item.direction === 'increase' ? 1 : 0),
      decreases: summary.decreases + (item.direction === 'decrease' ? 1 : 0),
      holds: summary.holds + (item.direction === 'hold' ? 1 : 0),
      autoApplicable: summary.autoApplicable + (item.autoApplicable ? 1 : 0),
      requiresApproval: summary.requiresApproval + (item.requiresApproval ? 1 : 0),
      clamped: summary.clamped + (item.guardrail.clamped ? 1 : 0),
    }),
    {
      total: 0,
      increases: 0,
      decreases: 0,
      holds: 0,
      autoApplicable: 0,
      requiresApproval: 0,
      clamped: 0,
    },
  );
}

export type RecommendationFilters = {
  query: string;
  directions: readonly PricingDirection[];
  /** Solo las que exigen firma humana. */
  approvalOnly: boolean;
  /** Solo las que el motor recortó contra la banda. */
  clampedOnly: boolean;
};

export function filterRecommendations(
  recommendations: readonly OfferRecommendation[],
  filters: RecommendationFilters,
): readonly OfferRecommendation[] {
  const needle = filters.query.trim().toLocaleLowerCase('es-MX');
  return recommendations.filter((item) => {
    if (filters.directions.length > 0 && !filters.directions.includes(item.direction)) {
      return false;
    }
    if (filters.approvalOnly && !item.requiresApproval) return false;
    if (filters.clampedOnly && !item.guardrail.clamped) return false;
    if (!needle) return true;
    return `${item.name} ${item.zone} ${item.offerId}`
      .toLocaleLowerCase('es-MX')
      .includes(needle);
  });
}

/**
 * Ofertas seleccionables para aplicar: `hold` no produce ningún cambio, así que
 * la API la devolvería en `skipped`.
 */
export function isActionable(item: OfferRecommendation): boolean {
  return item.direction !== 'hold';
}

/** Precio vigente contra recomendado por oferta. Ambas cifras son reales. */
export function priceComparisonSeries(
  recommendations: readonly OfferRecommendation[],
): { current: readonly ChartDatum[]; recommended: readonly ChartDatum[] } {
  const labelled = recommendations.map((item) => ({
    label: item.zone === item.name ? item.name : `${item.zone} · ${item.name}`,
    item,
  }));
  return {
    current: labelled.map(({ label, item }) => ({ label, value: item.currentPrice })),
    recommended: labelled.map(({ label, item }) => ({
      label,
      value: item.recommendedPrice,
    })),
  };
}

export type PendingRow = PendingRecommendation & {
  /** Nombre de la oferta cuando el paquete vigente aún la contiene. */
  offerName: string;
  zone: string;
  currentPrice: number;
  deltaPercent: number;
  direction: PricingDirection;
  expiresAt: number;
  expired: boolean;
};

/**
 * La cola de aprobación solo trae `offerId`; el nombre y el precio de partida se
 * toman del paquete vigente. Si la oferta ya no aparece ahí se deja constancia
 * en lugar de inventar datos.
 */
export function buildPendingRows(
  pending: readonly PendingRecommendation[],
  recommendations: readonly OfferRecommendation[],
  now: number,
): readonly PendingRow[] {
  const byOffer = new Map(recommendations.map((item) => [item.offerId, item]));
  return pending.map((row) => {
    const match = byOffer.get(row.offerId);
    const payload = row.payload;
    const currentPrice = payload?.currentPrice ?? match?.currentPrice ?? 0;
    const expiresAt = new Date(row.createdAt).getTime() + PENDING_TTL_MS;
    const delta =
      payload?.deltaPercent ??
      (currentPrice > 0 ? row.adjustedPrice / currentPrice - 1 : 0);
    return {
      ...row,
      offerName: match?.name ?? 'Oferta fuera del paquete vigente',
      zone: match?.zone ?? '—',
      currentPrice,
      deltaPercent: delta,
      direction: payload?.direction ?? (delta >= 0 ? 'increase' : 'decrease'),
      expiresAt,
      expired: Number.isFinite(expiresAt) ? expiresAt <= now : false,
    };
  });
}

export function filterPendingRows(
  rows: readonly PendingRow[],
  query: string,
): readonly PendingRow[] {
  const needle = query.trim().toLocaleLowerCase('es-MX');
  if (!needle) return rows;
  return rows.filter((row) =>
    `${row.offerName} ${row.zone} ${row.offerId} ${row.id}`
      .toLocaleLowerCase('es-MX')
      .includes(needle),
  );
}

/**
 * Fecha de generación del paquete: el motor la calcula al vuelo, así que decir
 * "hace X" evita que se lea como un dato de negocio.
 */
export function generatedAgeLabel(bundle: RecommendationBundle, now: number): string {
  const generated = new Date(bundle.generatedAt).getTime();
  if (!Number.isFinite(generated)) return 'Generado ahora';
  const seconds = Math.max(0, Math.round((now - generated) / 1000));
  if (seconds < 60) return 'Generado hace menos de un minuto';
  const minutes = Math.round(seconds / 60);
  if (minutes < 60) return `Generado hace ${minutes} min`;
  const hours = Math.round(minutes / 60);
  return `Generado hace ${hours} h`;
}
