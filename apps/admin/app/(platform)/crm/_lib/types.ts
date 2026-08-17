import type { BadgeTone } from '@boletera/ui';

export type CrmRangeKey = '30' | '90' | '365';

/** Segmentos operativos derivados de pedidos (sin API CRM dedicada). */
export type CustomerSegment = 'vip' | 'recurrent' | 'new' | 'at_risk' | 'inactive';

export type ChurnBand = 'low' | 'medium' | 'high';

export type RfmScores = {
  /** 1–5: más reciente = más alto. */
  recency: number;
  /** 1–5: más pedidos completados = más alto. */
  frequency: number;
  /** 1–5: más gasto = más alto. */
  monetary: number;
};

export type CrmCustomerRow = {
  id: string;
  name: string;
  email: string;
  ordersCount: number;
  completedOrders: number;
  totalSpend: number;
  currency: string;
  lastOrderAt: string | null;
  firstOrderAt: string | null;
  /** Días desde la última compra completada (∞ si no hay). */
  recencyDays: number;
  channels: string;
  channelList: readonly string[];
  topEvent: string;
  segment: CustomerSegment;
  rfm: RfmScores;
  /** RFM compuesto (promedio 1–5). */
  rfmScore: number;
  /** Probabilidad aproximada de churn 0–1 (solo por recencia observada). */
  churnRisk: number;
  churnBand: ChurnBand;
  /** Segmento AI cuando el correo coincide con GET /ai/segmentation. */
  aiSegment: string | null;
  aiChurnProbability: number | null;
  [key: string]: string | number | boolean | null | RfmScores | readonly string[];
};

export type CrmSegmentCard = {
  id: CustomerSegment;
  label: string;
  description: string;
  count: number;
  spend: number;
  tone: BadgeTone;
};

export type CrmKpis = {
  customers: number;
  active: number;
  avgLtv: number;
  retention: number;
  spend: number;
  frequent: number;
  churnHigh: number;
};

export type CrmRecommendation = {
  id: string;
  source: 'derived' | 'ai';
  priority: 'low' | 'medium' | 'high' | 'urgent';
  title: string;
  rationale: string;
  action: string;
};

export type CrmLimits = {
  /** GET /admin/orders no pagina ni filtra en el cliente actual. */
  ordersSample: boolean;
  /** No existe GET /crm/customers — perfiles = agregación local. */
  noCrmApi: boolean;
  /** RFM/churn locales son heurísticos por cuartiles/umbrales fijos. */
  approxRfm: boolean;
  /** AI segmentation puede fallar o ser insuficiente. */
  aiOptional: boolean;
};
