/** Tipos de la analítica en vivo por evento (Fase organizador). */

export type AnalyticsSalesGoal = {
  tickets?: number;
  revenue?: number;
};

export type AnalyticsTrackingLink = {
  code: string;
  label: string;
  createdAt: string;
  createdBy?: string;
};

export type AnalyticsMeta = {
  salesGoal?: AnalyticsSalesGoal;
  trackingLinks?: AnalyticsTrackingLink[];
};

export type SeriesPoint = {
  bucket: string;
  revenue: number;
  tickets: number;
};

export type FunnelStats = {
  visits: number;
  holds: number;
  orders: number;
  paid: number;
};

export type GoalProgress = {
  ticketsTarget: number | null;
  revenueTarget: number | null;
  ticketsSold: number;
  revenue: number;
  ticketsProgress: number;
  revenueProgress: number;
};

export type BreakdownRow = {
  key: string;
  label: string;
  orders: number;
  tickets: number;
  revenue: number;
};

export type EventAnalyticsPayload = {
  eventId: string;
  title: string;
  range: { from: string; to: string };
  series: {
    minute: SeriesPoint[];
    hour: SeriesPoint[];
    day: SeriesPoint[];
  };
  funnel: FunnelStats;
  goal: GoalProgress;
  byChannel: BreakdownRow[];
  byPaymentMethod: BreakdownRow[];
  byZone: BreakdownRow[];
};
