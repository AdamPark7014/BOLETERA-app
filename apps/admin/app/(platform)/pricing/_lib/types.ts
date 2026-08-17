/**
 * Contratos del módulo `pricing` de la API (`apps/api/src/modules/pricing`).
 *
 * Se declaran aquí en lugar de importarlos del backend porque el panel consume
 * JSON: los `Decimal` de Prisma llegan como cadena y las fechas como ISO. Usa
 * `toAmount` para cualquier campo monetario que cruce la red.
 */

export type PricingDirection = 'increase' | 'decrease' | 'hold';

export type PricingConfidence = 'high' | 'medium' | 'low';

export type PricingFactorCode =
  | 'sales_pace'
  | 'occupancy'
  | 'time'
  | 'inventory'
  | 'price_band'
  | 'segment'
  | 'promotion';

/** Contribución multiplicativa de una señal (1.0 = no mueve el precio). */
export type PricingFactor = {
  code: PricingFactorCode;
  contribution: number;
  detail: string;
  metricValue: number;
  threshold?: number;
};

/** Banda de precio aplicada por el motor: piso, techo y si recortó. */
export type PricingGuardrail = {
  floor: number;
  ceiling: number;
  clamped: boolean;
  preClampPrice: number;
  bandLabel: string;
};

export type OfferRecommendation = {
  offerId: string;
  zone: string;
  name: string;
  basePrice: number;
  currentPrice: number;
  recommendedPrice: number;
  recommendedMultiplier: number;
  direction: PricingDirection;
  /** Proporción, no porcentaje: 0.12 = +12 %. */
  deltaPercent: number;
  factors: readonly PricingFactor[];
  guardrail: PricingGuardrail;
  requiresApproval: boolean;
  autoApplicable: boolean;
  explanation: string;
  confidence: PricingConfidence;
};

export type PricingSignals = {
  daysUntilEvent: number;
  /** Proporción de la ventana de venta transcurrida. */
  expectedPace: number;
  /** Proporción del aforo vendido. */
  actualPace: number;
  /** `actualPace - expectedPace`, en proporción. */
  paceDelta: number;
  /** Escala 0-100, tal como lo publica la API. */
  occupancyPercent: number;
  soldTickets: number;
  totalCapacity: number;
};

/** `GET /pricing/events/:eventId/recommendations` */
export type RecommendationBundle = {
  eventId: string;
  organizationId: string;
  title: string;
  generatedAt: string;
  enableDynamic: boolean;
  signals: PricingSignals;
  recommendations: readonly OfferRecommendation[];
  summary: string;
};

/** Payload embebido en `reason` de las recomendaciones en espera. */
export type PendingPayload = {
  v: 1;
  status: 'pending' | 'rejected';
  explanation: string;
  factors: readonly PricingFactor[];
  direction: PricingDirection;
  deltaPercent: number;
  requiresApproval: boolean;
  guardrail: PricingGuardrail;
  basePrice: number;
  currentPrice: number;
};

/** `GET /pricing/events/:eventId/recommendations/pending` */
export type PendingRecommendation = {
  id: string;
  eventId: string;
  offerId: string;
  adjustedPrice: number;
  priceMultiplier: number;
  createdAt: string;
  status: 'pending';
  reason: string;
  payload?: PendingPayload;
};

/** `GET /pricing/events/:eventId/revenue-estimate` */
export type RevenueEstimate = {
  eventId: string;
  title: string;
  totalCapacity: number;
  soldTickets: number;
  /** La API la envía formateada con dos decimales, en escala 0-100. */
  occupancyPercent: string;
  grossRevenue: number;
  commission: number;
  netRevenue: number;
  currency: string;
};

/** `GET /pricing/offers/:offerId/history` (filas de `DynamicPrice`). */
export type PriceHistoryEntry = {
  id: string;
  eventId: string;
  offerId: string;
  adjustedPrice: string | number;
  priceMultiplier: number;
  reason: string;
  activeFrom: string;
  activeTo: string;
  createdAt: string;
};

/** `POST /pricing/events/:eventId/recommendations/apply` */
export type ApplyResult = {
  applied: readonly string[];
  skipped: readonly string[];
  pendingCreated: readonly string[];
};

export type ReviewResult = {
  id: string;
  status: 'approved' | 'rejected';
};

/** `POST /pricing/events/:eventId/update-dynamic` */
export type UpdateDynamicResult = {
  message: string;
  applied: number;
  pendingApproval: number;
  held: number;
  summary: string;
  signals: PricingSignals;
};

/** Importes que viajan como `Decimal` serializado. */
export function toAmount(value: string | number | null | undefined): number {
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}
