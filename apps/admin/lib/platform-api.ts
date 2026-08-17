import type { SeatMapData, SeatMapSection } from '@boletera/shared';
import { adminApi } from './api';

export type EventRow = {
  id: string;
  title: string;
  slug: string;
  status: string;
  startsAt: string;
  totalCapacity: number;
  venueId?: string;
  venue?: { name: string; id?: string };
  _count?: { tickets: number; orders: number };
  metadata?: Record<string, unknown>;
};

export type EventHub = {
  event: EventRow & { offers: { id: string; name: string; zone: string; basePrice: string }[] };
  inventory: {
    total: number;
    sold: number;
    held: number;
    available: number;
    occupancyPercent: number;
  };
  channels: { channel: string; _count: number; _sum: { totalAmount: string | null } }[];
  metadata: Record<string, unknown>;
};

export type PlatformOverview = {
  ordersToday: number;
  activeEvents: number;
  activeHolds: number;
  revenueToday: number;
  taquillaTerminals: number;
  totalEvents: number;
  totalVenues: number;
  channelBreakdown: { channel: string; orders: number; revenue: number }[];
  recentOrders?: {
    publicId: string;
    status: string;
    channel: string;
    totalAmount: string;
    eventTitle: string;
    createdAt: string;
  }[];
};

export function listEvents(token: string) {
  return adminApi<EventRow[]>('/admin/events', token);
}

export function getPlatformOverview(token: string) {
  return adminApi<PlatformOverview>('/admin/platform/overview', token);
}

export function getEventHub(token: string, eventId: string) {
  return adminApi<EventHub>(`/events/manage/${eventId}/hub`, token);
}

export function getEventCalendar(token: string, month: number, year: number) {
  return adminApi<{ calendar: Record<string, unknown[]>; totalEvents: number }>(
    `/events/manage/calendar/${month}/${year}`,
    token,
  );
}

export function getBranding(token: string) {
  return adminApi<{ primaryColor?: string; subdomain?: string; logoUrl?: string }>(
    '/admin/branding',
    token,
  );
}

export function createEventSeries(
  token: string,
  body: {
    seriesName: string;
    description: string;
    venueId: string;
    occurrences: Array<{ date: string; title?: string; capacity?: number; basePrice?: number }>;
  },
) {
  return adminApi<{ seriesName: string; totalEvents: number }>('/events/manage/series', token, {
    method: 'POST',
    body: JSON.stringify({
      ...body,
      occurrences: body.occurrences.map((o) => ({ ...o, date: new Date(o.date) })),
    }),
  });
}

export function createResidency(
  token: string,
  body: {
    name: string;
    venueId: string;
    startDate: string;
    frequency: 'daily' | 'weekly' | 'biweekly' | 'monthly';
    occurrenceCount: number;
    capacity: number;
    basePrice: number;
  },
) {
  return adminApi<{ totalEvents: number }>('/events/manage/residency', token, {
    method: 'POST',
    body: JSON.stringify({ ...body, startDate: new Date(body.startDate) }),
  });
}

export function createEvent(
  token: string,
  body: {
    title: string;
    description: string;
    type: 'single' | 'series' | 'residency';
    startDate: string;
    venueId: string;
    capacity: number;
    basePrice: number;
    /** Ventana de venta. El asistente la pedía y se descartaba antes de llegar aquí. */
    salesStartAt?: string;
    salesEndAt?: string;
  },
) {
  return adminApi<EventRow>('/events/manage', token, {
    method: 'POST',
    body: JSON.stringify({ ...body, startDate: new Date(body.startDate) }),
  });
}

export function configureChannels(
  token: string,
  eventId: string,
  config: {
    web: { enabled: boolean; allocation: number };
    taquilla: { enabled: boolean; allocation: number; locations?: string[] };
    api: { enabled: boolean; allocation: number };
    phone?: { enabled: boolean; allocation: number };
  },
) {
  return adminApi(`/channels/${eventId}/configure`, token, {
    method: 'POST',
    body: JSON.stringify(config),
  });
}

export type ChannelHealthMap = Record<
  string,
  { orders?: number; revenue?: number; status?: string }
>;

export function getChannelHealth(token: string, eventId: string) {
  return adminApi<ChannelHealthMap>(`/channels/${eventId}/health`, token);
}

export function listVenues(token: string) {
  return adminApi<{ id: string; name: string; slug: string; capacity: number }[]>('/admin/venues', token);
}

export function suggestLayout(token: string, venueId: string, planDescription: string) {
  return adminApi<{ venue: unknown; layout: { mapData: SeatMapData } }>(
    `/venues/${venueId}/layout/suggest`,
    token,
    {
      method: 'POST',
      body: JSON.stringify({ prompt: planDescription }),
    },
  );
}

export function applyLayoutTemplate(
  token: string,
  venueId: string,
  template: 'arena' | 'theater' | 'stadium' | 'festival',
  opts?: { capacity?: number },
) {
  return adminApi<{ venue: unknown; layout: { mapData: SeatMapData } }>(
    `/venues/${venueId}/layout/from-template`,
    token,
    {
      method: 'POST',
      body: JSON.stringify({ template, capacity: opts?.capacity }),
    },
  );
}

export function getVenueLayout(token: string, venueId: string) {
  return adminApi<{
    venue: { id: string; name: string; slug: string };
    layout: { id: string; mapData: SeatMapData };
  }>(`/venues/${venueId}/layout`, token);
}

export function saveVenueLayout(token: string, venueId: string, mapData: SeatMapData) {
  return adminApi(`/venues/${venueId}/layout`, token, {
    method: 'PUT',
    body: JSON.stringify({ mapData }),
  });
}

export type EgressReportApiJson = {
  format: 'json';
  filename: string;
  report: {
    generatedAt: string;
    venueName: string;
    summary: {
      hasNetwork: boolean;
      sections: number;
      unreachable: number;
      seatsWithPath: number;
      seatsWithoutPath: number;
      maxPathLength: number | null;
      avgPathLength: number | null;
      clearanceMinutes: number | null;
      maxWalkMinutes: number | null;
    };
    policy: {
      longPathUnits: number;
      slowClearanceMinutes: number;
      bottleneckUtilization: number;
      bottleneckSeatLoad: number;
    };
    analysis: unknown;
  };
};

/** Saved layout egress report (JSON). */
export function getVenueEgressReport(token: string, venueId: string) {
  return adminApi<EgressReportApiJson>(`/venues/${venueId}/layout/egress`, token);
}

export type EgressOverviewVenue = {
  venueId: string;
  layoutId: string | null;
  venueName: string;
  hasNetwork: boolean;
  sections: number;
  unreachable: number;
  seatsWithPath: number;
  seatsWithoutPath: number;
  clearanceMinutes: number | null;
  maxPathLength: number | null;
  avgPathLength: number | null;
  topBottleneckUtilization: number | null;
  topBottleneckKind: string | null;
  status: 'ok' | 'warn' | 'critical' | 'no-network' | 'empty';
  statusReason: string;
};

export type EgressOverviewResponse = {
  generatedAt: string;
  venues: EgressOverviewVenue[];
  counts: {
    ok: number;
    warn: number;
    critical: number;
    noNetwork: number;
    empty: number;
  };
};

/** Org-wide egress health dashboard. */
export function getEgressOverview(token: string) {
  return adminApi<EgressOverviewResponse>('/venues/egress-overview', token);
}

/** Download org-wide egress overview CSV. */
export async function downloadEgressOverviewCsv(token: string) {
  const API = process.env.NEXT_PUBLIC_ADMIN_API_URL || 'http://localhost:4000/api/v1';
  const res = await fetch(`${API}/venues/egress-overview.csv`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(await res.text());
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = /filename="?([^"]+)"?/i.exec(disposition);
  const filename = match?.[1] || 'egress-overview.csv';
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Analyze egress for saved layout or unsaved draft.
 * format=csv returns raw CSV text; json returns structured report.
 */
export async function analyzeVenueEgress(
  token: string,
  venueId: string,
  opts?: { mapData?: SeatMapData; format?: 'json' | 'csv' | 'pdf' },
): Promise<EgressReportApiJson | string | Blob> {
  const format = opts?.format ?? 'json';
  const API = process.env.NEXT_PUBLIC_ADMIN_API_URL || 'http://localhost:4000/api/v1';
  const res = await fetch(`${API}/venues/${venueId}/layout/egress`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ mapData: opts?.mapData, format }),
  });
  if (!res.ok) throw new Error(await res.text());
  if (format === 'csv') return res.text();
  if (format === 'pdf') return res.blob();
  return res.json() as Promise<EgressReportApiJson>;
}

/** Download egress CSV for the saved layout (browser). */
export async function downloadVenueEgressCsv(token: string, venueId: string) {
  const API = process.env.NEXT_PUBLIC_ADMIN_API_URL || 'http://localhost:4000/api/v1';
  const res = await fetch(`${API}/venues/${venueId}/layout/egress.csv`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(await res.text());
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = /filename="?([^"]+)"?/i.exec(disposition);
  const filename = match?.[1] || `egress-${venueId}.csv`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Download egress PDF for the saved layout (browser). */
export async function downloadVenueEgressPdf(token: string, venueId: string) {
  const API = process.env.NEXT_PUBLIC_ADMIN_API_URL || 'http://localhost:4000/api/v1';
  const res = await fetch(`${API}/venues/${venueId}/layout/egress.pdf`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error(await res.text());
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = /filename="?([^"]+)"?/i.exec(disposition);
  const filename = match?.[1] || `egress-${venueId}.pdf`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/**
 * Analyze draft map and download PDF (or return blob URL handling).
 */
export async function downloadVenueEgressPdfDraft(
  token: string,
  venueId: string,
  mapData: SeatMapData,
) {
  const API = process.env.NEXT_PUBLIC_ADMIN_API_URL || 'http://localhost:4000/api/v1';
  const res = await fetch(`${API}/venues/${venueId}/layout/egress`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ mapData, format: 'pdf' }),
  });
  if (!res.ok) throw new Error(await res.text());
  const blob = await res.blob();
  const disposition = res.headers.get('Content-Disposition') || '';
  const match = /filename="?([^"]+)"?/i.exec(disposition);
  const filename = match?.[1] || `egress-draft-${venueId}.pdf`;
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

export function publishEvent(token: string, eventId: string) {
  return adminApi<{ totalSeats: number; sections: number }>(`/events/${eventId}/publish`, token, {
    method: 'POST',
  });
}

export function importAiLayout(token: string, venueId: string, sections: SeatMapSection[]) {
  return adminApi(`/venues/${venueId}/layout/ai-import`, token, {
    method: 'POST',
    body: JSON.stringify({ sections }),
  });
}

export type RealtimeDashboard = {
  metrics: {
    todayRevenue: number;
    todayOrders: number;
    weekRevenue: number;
    weekOrders: number;
    avgOrderValue: number;
    occupancy: number;
    soldTickets: number;
    totalTickets: number;
  };
  channels: { channel: string; orders: number; revenue: number }[];
};

const adminApiBase = () =>
  process.env.NEXT_PUBLIC_ADMIN_API_URL || 'http://localhost:4000/api/v1';

export function getRealtimeDashboard(token: string, organizationId: string, eventId?: string) {
  const q = eventId ? `?eventId=${eventId}` : '';
  return adminApi<RealtimeDashboard>(`/reports/dashboard/realtime/${organizationId}${q}`, token);
}

export function realtimeDashboardStreamUrl(organizationId: string, eventId?: string) {
  const q = eventId ? `?eventId=${encodeURIComponent(eventId)}` : '';
  return `${adminApiBase()}/reports/dashboard/realtime/${organizationId}/stream${q}`;
}

export async function exportPresaleCodes(token: string, campaignId: string) {
  const res = await fetch(`${adminApiBase()}/campaigns/${campaignId}/codes/export`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) throw new Error('No se pudo exportar códigos');
  return res.text();
}

export type SettlementReport = {
  summary?: {
    grossRevenue?: number;
    commission?: number;
    netRevenue?: number;
    totalOrders?: number;
    avgOrderValue?: number;
  };
  paymentMethods?: Record<string, { count: number; amount: number }>;
  period?: string;
};

export function getSettlementReport(
  token: string,
  organizationId: string,
  period: 'DAILY' | 'WEEKLY' | 'MONTHLY',
) {
  return adminApi<SettlementReport>(`/reports/settlement/${organizationId}/${period}`, token);
}

export function listCampaigns(token: string, eventId: string) {
  return adminApi<
    Array<{
      id: string;
      name: string;
      type: string;
      status: string;
      allocation: number;
      discountValue: number;
      redeemed?: number;
      codes?: string[];
    }>
  >(`/campaigns/list/${eventId}`, token);
}

export function getCampaignAnalytics(token: string, campaignId: string) {
  return adminApi(`/campaigns/${campaignId}/analytics`, token);
}

export function createCampaign(
  token: string,
  organizationId: string,
  eventId: string,
  body: Record<string, unknown>,
) {
  return adminApi(`/campaigns/create/${organizationId}/${eventId}`, token, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function publishCampaignApi(token: string, campaignId: string) {
  return adminApi(`/campaigns/${campaignId}/publish`, token, { method: 'POST' });
}

export function searchEventsPublic(query: string, limit = 20) {
  const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';
  return fetch(`${API}/search/events?query=${encodeURIComponent(query)}&limit=${limit}`).then((r) =>
    r.json(),
  );
}

export function getTrendingEventsPublic() {
  const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';
  return fetch(`${API}/search/trending`).then((r) => r.json());
}

export function updateOffer(
  token: string,
  eventId: string,
  offerId: string,
  body: { basePrice?: number; name?: string; isAvailable?: boolean },
) {
  return adminApi(`/events/manage/${eventId}/offers/${offerId}`, token, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

export function setEventPricing(
  token: string,
  eventId: string,
  body: {
    basePrice: number;
    dynamicPricingEnabled: boolean;
    customZonePricing?: Record<string, number>;
  },
) {
  return adminApi(`/events/manage/${eventId}/pricing`, token, {
    method: 'PUT',
    body: JSON.stringify(body),
  });
}

export function resolveFraudFlag(token: string, flagId: string, resolution: string) {
  return adminApi(`/fraud/flags/${flagId}/resolve`, token, {
    method: 'POST',
    body: JSON.stringify({ resolution }),
  });
}

export function listEventsByVenue(token: string, venueId: string) {
  return listEvents(token).then((events) =>
    events.filter((e) => (e as EventRow & { venueId?: string }).venueId === venueId),
  );
}

export type SaasCapabilities = {
  organization: { id: string; name: string; slug: string; verified: boolean };
  metrics: {
    events: number;
    terminals: number;
    apiKeys: number;
    waitlistPending: number;
    transfers: number;
    payouts: number;
  };
  modules: Record<string, boolean>;
  roadmap: { id: string; label: string; status: string; priority: string }[];
};

export function getSaasCapabilities(token: string, organizationId: string) {
  return adminApi<SaasCapabilities>(
    `/organization/capabilities?organizationId=${organizationId}`,
    token,
  );
}

export function getOrganization(token: string, orgId: string) {
  return adminApi<Record<string, unknown>>(`/organization/${orgId}`, token);
}

export function listTeam(token: string, orgId: string) {
  return adminApi<
    {
      id: string;
      email: string;
      firstName: string;
      lastName: string;
      role: string;
      active: boolean;
      lastLogin: string | null;
    }[]
  >(`/organization/${orgId}/team`, token);
}

export function inviteTeamMember(
  token: string,
  orgId: string,
  body: {
    email: string;
    firstName: string;
    lastName: string;
    role: string;
    password: string;
  },
) {
  return adminApi(`/organization/${orgId}/team`, token, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/* ── Invitaciones de equipo ─────────────────────────────────────────────────
 * El SSO ya no otorga rol automáticamente: un usuario nuevo entra como CUSTOMER
 * y solo se eleva si existe una invitación viva. Sin esta interfaz no hay forma
 * de dar de alta a un promotor desde el producto.
 * Contrato: apps/api/src/modules/auth/invitations.service.ts
 */

export type InvitationStatus = 'PENDING' | 'ACCEPTED' | 'EXPIRED';

export type Invitation = {
  id: string;
  organizationId: string;
  email: string;
  role: string;
  invitedById: string | null;
  expiresAt: string;
  acceptedAt: string | null;
  acceptedByUserId: string | null;
  createdAt: string;
  status: InvitationStatus;
};

export function listInvitations(token: string, organizationId: string) {
  return adminApi<Invitation[]>(
    `/auth/invitations?organizationId=${encodeURIComponent(organizationId)}`,
    token,
  );
}

export function createInvitation(
  token: string,
  body: { organizationId: string; email: string; role: string; expiresInDays?: number },
) {
  return adminApi<Invitation>('/auth/invitations', token, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

export function revokeInvitation(token: string, id: string) {
  return adminApi<{ ok: true; id: string }>(`/auth/invitations/${id}`, token, {
    method: 'DELETE',
  });
}

/**
 * `AuditEvent` tal y como lo devuelve el API (un `findMany` sin `select`, así
 * que llegan también `userId` e `ipAddress`, que el tipo anterior escondía).
 */
export type AuditRow = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  createdAt: string;
  userId?: string | null;
  ipAddress?: string | null;
  metadata?: Record<string, unknown> | null;
};

export function getAuditLog(token: string, orgId: string, limit = 80) {
  return adminApi<AuditRow[]>(`/organization/${orgId}/audit?limit=${limit}`, token);
}

export type WaitlistRow = {
  id: string;
  email: string;
  phone?: string;
  firstName?: string;
  lastName?: string;
  quantity: number;
  status: string;
  createdAt: string;
  event: { id: string; title: string; slug: string };
};

export function listWaitlistByOrg(token: string, orgId: string) {
  return adminApi<WaitlistRow[]>(`/waitlist/organization/${orgId}`, token);
}

export function notifyWaitlistBatch(token: string, eventId: string, limit = 50) {
  return adminApi<{ notified: number }>(
    `/waitlist/event/${eventId}/notify?limit=${limit}`,
    token,
    { method: 'POST' },
  );
}

export function listApiKeys(token: string, orgId: string) {
  return adminApi<
    {
      id: string;
      name: string;
      keyPrefix: string;
      scopes: string[];
      rateLimit: number;
      lastUsedAt: string | null;
      expiresAt: string | null;
      active: boolean;
      createdAt: string;
    }[]
  >(`/partners/${orgId}/keys`, token);
}

export function createApiKey(
  token: string,
  orgId: string,
  body: { name: string; scopes?: string[]; rateLimit?: number; expiresInDays?: number },
) {
  return adminApi<{ id: string; secret: string; keyPrefix: string }>(
    `/partners/${orgId}/keys`,
    token,
    { method: 'POST', body: JSON.stringify(body) },
  );
}

export function revokeApiKey(token: string, orgId: string, keyId: string) {
  return adminApi(`/partners/${orgId}/keys/${keyId}/revoke`, token, { method: 'PATCH' });
}

export type FiscalProfile = {
  id: string;
  rfc: string;
  legalName: string;
  regimenFiscal: string;
  codigoPostal: string;
  serie: string;
  /** Siguiente folio que consumirá el timbrado. Lo lleva el API, no la UI. */
  nextFolio: number;
  /** `sandbox` | `production` — determina si el UUID es real ante el SAT. */
  pacMode: string;
  pacProvider: string | null;
  active: boolean;
};

export function getFiscalProfile(token: string, orgId: string) {
  return adminApi<FiscalProfile | null>(`/billing/${orgId}/fiscal-profile`, token);
}

export function upsertFiscalProfile(
  token: string,
  orgId: string,
  body: {
    rfc: string;
    legalName: string;
    regimenFiscal?: string;
    codigoPostal: string;
    serie?: string;
    pacMode?: string;
  },
) {
  return adminApi(`/billing/${orgId}/fiscal-profile`, token, {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

/** `CfdiStatus` de Prisma. `PENDING` no existe en el enum: un CFDI sin timbrar es `DRAFT`. */
export type CfdiStatus = 'DRAFT' | 'STAMPED' | 'CANCELLED' | 'ERROR';

/**
 * `listInvoices` hace un `findMany` sin `select`, así que llegan todas las
 * columnas del modelo. El tipo anterior solo declaraba seis y por eso la
 * pantalla no podía mostrar ni el uso de CFDI ni el motivo del error.
 */
export type CfdiInvoice = {
  id: string;
  uuid: string | null;
  serie: string;
  folio: number;
  /** `I` ingreso, `E` egreso (nota de crédito). */
  tipo: string;
  status: CfdiStatus;
  receptorRfc: string;
  receptorNombre: string;
  receptorUsoCfdi: string;
  subtotal: string | number;
  iva: string | number;
  total: string | number;
  currency: string;
  xmlUrl: string | null;
  pdfUrl: string | null;
  /** Texto crudo del PAC cuando `status === 'ERROR'`. */
  errorMessage: string | null;
  stampedAt: string | null;
  createdAt: string;
  orderId: string | null;
};

export function listCfdiInvoices(token: string, orgId: string) {
  return adminApi<CfdiInvoice[]>(`/billing/${orgId}/cfdi`, token);
}

export function stampCfdi(
  token: string,
  orgId: string,
  body: {
    orderId: string;
    receptorRfc: string;
    receptorNombre: string;
    receptorUsoCfdi?: string;
  },
) {
  return adminApi<CfdiInvoice & { sandbox: boolean; xml: string }>(
    `/billing/${orgId}/cfdi/stamp`,
    token,
    { method: 'POST', body: JSON.stringify(body) },
  );
}

/** Alta de recinto desde el constructor de mapas (viene de enterprise-upgrade). */
export function createVenue(
  token: string,
  data: {
    name: string;
    city?: string;
    state?: string;
    address?: string;
    totalCapacity?: number;
    template?: 'arena' | 'theater' | 'stadium' | 'festival' | 'blank';
  },
) {
  return adminApi<{
    id: string;
    name: string;
    slug: string;
    city: string;
    totalCapacity: number;
    layoutId: string | null;
    template: string;
  }>('/admin/venues', token, {
    method: 'POST',
    body: JSON.stringify(data),
  });
}
