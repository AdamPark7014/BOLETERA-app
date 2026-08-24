import { decodeJwtExpiryMs, TOKEN_FALLBACK_TTL_MS } from './jwt';

const API_URL = process.env.EXPO_PUBLIC_API_URL ?? 'http://localhost:4000/api/v1';

export type AuthSession = {
  token: string;
  email: string;
  role: string;
  organizationId?: string | null;
  userId?: string;
  expiresAt?: number;
  issuedAt?: number;
};

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public body?: unknown,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}

type FetchOpts = {
  token?: string;
  /** Skip 401 → reauth hook (login calls). */
  skipReauth?: boolean;
};

let onUnauthorized: (() => Promise<boolean>) | null = null;
let activeToken: string | null = null;

export function setUnauthorizedHandler(handler: (() => Promise<boolean>) | null) {
  onUnauthorized = handler;
}

export function setApiToken(token: string | null) {
  activeToken = token;
}

async function rawFetch(path: string, init?: RequestInit, token?: string): Promise<Response> {
  return fetch(`${API_URL}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(init?.headers ?? {}),
    },
  });
}

export async function apiFetch<T>(
  path: string,
  init?: RequestInit,
  opts: FetchOpts = {},
): Promise<T> {
  const token = opts.token ?? activeToken ?? undefined;
  const send = () => rawFetch(path, init, token);

  let res = await send();

  const canRetry = init?.body == null || typeof init?.body === 'string';
  if (res.status === 401 && !opts.skipReauth && onUnauthorized && canRetry) {
    const ok = await onUnauthorized();
    if (ok) {
      res = await rawFetch(path, init, activeToken ?? undefined);
    }
  }

  const text = await res.text().catch(() => '');
  let body: unknown = undefined;
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }

  if (!res.ok) {
    const message =
      (body && typeof body === 'object' && 'message' in body
        ? String((body as { message: unknown }).message)
        : typeof body === 'string' && body
          ? body
          : `HTTP ${res.status}`) || `HTTP ${res.status}`;
    throw new ApiError(res.status, message, body);
  }

  if (!text) return undefined as T;
  return body as T;
}

export type LoginResponse = {
  accessToken: string;
  user: {
    id: string;
    email: string;
    role: string;
    organizationId?: string | null;
  };
};

export async function login(email: string, password: string): Promise<AuthSession> {
  const data = await apiFetch<LoginResponse>(
    '/auth/login',
    {
      method: 'POST',
      body: JSON.stringify({ email, password }),
    },
    { skipReauth: true },
  );

  const issuedAt = Date.now();
  const expiresAt = decodeJwtExpiryMs(data.accessToken) ?? issuedAt + TOKEN_FALLBACK_TTL_MS;

  return {
    token: data.accessToken,
    email: data.user.email,
    role: data.user.role,
    organizationId: data.user.organizationId,
    userId: data.user.id,
    issuedAt,
    expiresAt,
  };
}

// ── Discovery ─────────────────────────────────────────────────────────────

export type EventSummary = {
  id: string;
  slug: string;
  title: string;
  startsAt: string;
  minPrice?: number;
  image?: string | null;
  venue?: { name: string; city: string };
};

export function listEvents(token?: string) {
  return apiFetch<EventSummary[]>('/discovery/events?limit=20', undefined, { token });
}

// ── Promoter / admin ────────────────────────────────────────────────────────

export type PromoterDashboard = {
  organizationId: string;
  name: string;
  period: string;
  metrics: {
    totalOrders: number;
    totalTicketsSold: number;
    totalRevenue: number;
    commission: number;
    netRevenue: number;
    currency: string;
  };
  topEvents: { eventId: string; title: string; revenue: number; ticketsSold: number }[];
};

export function getPromoterDashboard(orgId: string, token: string, period: 'DAY' | 'WEEK' | 'MONTH' = 'DAY') {
  return apiFetch<PromoterDashboard>(
    `/analytics/promoters/${orgId}/dashboard?period=${period}`,
    undefined,
    { token },
  );
}

export type AdminDashboard = {
  ordersToday: number;
  activeEvents: number;
  activeHolds: number;
  revenueToday: number;
  fraudFlags: number;
};

export function getAdminDashboard(token: string) {
  return apiFetch<AdminDashboard>('/admin/dashboard', undefined, { token });
}

export type OrderRow = {
  id: string;
  publicId: string;
  status: string;
  totalAmount: number | string;
  createdAt: string;
  buyerEmail?: string;
  event?: { title: string };
};

export function listAdminOrders(token: string) {
  return apiFetch<OrderRow[]>('/admin/orders', undefined, { token });
}

export type PlatformOverview = {
  totals: {
    organizations: number;
    users: number;
    events: number;
    orders: number;
    venues: number;
  };
  health: {
    ordersToday: number;
    failedPayments: number;
    pendingRefunds: number;
  };
};

export function getPlatformOverview(token: string) {
  return apiFetch<PlatformOverview>('/platform/super/overview', undefined, { token });
}

// ── Taquilla / inventory holds ──────────────────────────────────────────────

export type HoldResult = {
  holds?: { id: string }[];
  holdIds?: string[];
  id?: string;
};

export function createStaffHold(
  token: string,
  body: { eventId: string; offerId?: string; quantity?: number; channel?: string },
) {
  return apiFetch<HoldResult>(
    '/inventory/staff/holds',
    {
      method: 'POST',
      body: JSON.stringify({ ...body, channel: body.channel ?? 'TAQUILLA' }),
    },
    { token },
  );
}

export function createTaquillaHold(
  token: string,
  body: {
    terminalId: string;
    sessionId: string;
    eventId: string;
    offerId?: string;
    quantity?: number;
  },
) {
  return apiFetch<HoldResult>(
    '/taquilla/holds',
    { method: 'POST', body: JSON.stringify(body) },
    { token },
  );
}

// ── Access / scan ───────────────────────────────────────────────────────────

export type ScanResult = {
  valid: boolean;
  status?: string;
  message?: string;
  ticket?: { id: string; holderName?: string };
};

export function scanTicket(token: string, qrPayload: string, zoneId?: string) {
  return apiFetch<ScanResult>(
    '/access/scan',
    {
      method: 'POST',
      body: JSON.stringify({ qrPayload, zoneId, channel: 'TAQUILLA' }),
    },
    { token },
  );
}

export function getApiBaseUrl() {
  return API_URL;
}
