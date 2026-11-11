import { test, expect, type APIRequestContext } from '@playwright/test';

/**
 * Use 127.0.0.1 — on this machine `localhost:4000` may resolve to another
 * project's API via IPv6 while Boletera listens on IPv4.
 */
const API = process.env.API_URL || 'http://127.0.0.1:4000/api/v1';

type PendingOrder = {
  id: string;
  publicId: string;
  status: string;
  paymentAction?: {
    reference?: string;
    metadata?: { type?: string; demo?: boolean; clabe?: string };
  };
};

async function ensureDemoGateway(request: APIRequestContext) {
  const health = await request.get(`${API}/health`);
  if (!health.ok()) throw new Error(`API no disponible (${health.status()})`);
  const healthBody = (await health.json()) as { service?: string };
  if (healthBody.service !== 'boletera-api') {
    throw new Error(`Puerto no es Boletera API (service=${healthBody.service})`);
  }

  const cfgRes = await request.get(`${API}/payments/config`);
  if (!cfgRes.ok()) throw new Error('Sin /payments/config');
  const cfg = (await cfgRes.json()) as { gateway?: string; demo?: boolean };
  if (cfg.gateway !== 'BANORTE') throw new Error(`Gateway no es Banorte (${cfg.gateway})`);
  if (!cfg.demo) throw new Error('Banorte no está en modo demo');
}

async function createPendingAsyncOrder(
  request: APIRequestContext,
  paymentMethod: 'SPEI' | 'OXXO'
): Promise<PendingOrder> {
  const eventsRes = await request.get(`${API}/discovery/events`);
  if (!eventsRes.ok()) throw new Error(`Sin catálogo (${eventsRes.status()})`);
  const events = (await eventsRes.json()) as { id: string; slug: string }[];
  const event = events.find((e) => e.slug === 'concierto-demo-2026') ?? events[0];
  if (!event) throw new Error('Sin eventos en seed');

  const detailRes = await request.get(`${API}/discovery/events/${event.slug}`);
  if (!detailRes.ok()) throw new Error('Evento no encontrado');
  const detail = (await detailRes.json()) as {
    id: string;
    offers: { id: string; remainingQuantity?: number; isAvailable?: boolean }[];
  };
  const offer = detail.offers.find(
    (o) => o.isAvailable !== false && (o.remainingQuantity ?? 1) > 0
  );
  if (!offer?.id) throw new Error('Sin ofertas disponibles');

  const holdRes = await request.post(`${API}/inventory/holds`, {
    data: {
      eventId: detail.id,
      offerId: offer.id,
      quantity: 1,
      sessionId: `e2e-spei-${paymentMethod}-${Date.now()}`,
    },
  });
  if (!holdRes.ok()) {
    const body = await holdRes.text();
    throw new Error(`No se pudo reservar (${holdRes.status()}): ${body}`);
  }
  const holdData = (await holdRes.json()) as {
    holds?: { id: string; offerId?: string }[];
  };
  const holdId = holdData.holds?.[0]?.id;
  if (!holdId) throw new Error('Hold vacío');

  const orderRes = await request.post(`${API}/orders`, {
    headers: {
      'Content-Type': 'application/json',
      'Idempotency-Key': `e2e-${paymentMethod}-${Date.now()}`,
    },
    data: {
      eventId: detail.id,
      offerId: offer.id,
      holdIds: [holdId],
      items: [{ offerId: offer.id, holdIds: [holdId] }],
      buyerName: 'E2E SPEI Demo',
      buyerEmail: 'e2e-spei@boletera.test',
      paymentMethod,
    },
  });
  if (!orderRes.ok()) {
    const body = await orderRes.text();
    throw new Error(`No se pudo crear orden (${orderRes.status()}): ${body}`);
  }
  const order = (await orderRes.json()) as PendingOrder;
  expect(order.status).toBe('PENDING');
  expect(order.paymentAction).toBeTruthy();
  expect(order.id).toBeTruthy();
  expect(order.publicId).toBeTruthy();
  return order;
}

test.describe('SPEI/OXXO demo confirm', () => {
  test('API: SPEI pending → POST /payments/confirm → COMPLETED', async ({ request }) => {
    await ensureDemoGateway(request);
    const order = await createPendingAsyncOrder(request, 'SPEI');

    const confirmRes = await request.post(`${API}/payments/confirm`, {
      data: {
        orderId: order.id,
        externalId: `banorte_demo_${order.publicId}`,
      },
    });
    expect(confirmRes.ok()).toBeTruthy();

    const statusRes = await request.get(`${API}/orders/${order.publicId}/status`);
    expect(statusRes.ok()).toBeTruthy();
    const status = (await statusRes.json()) as { status: string };
    expect(status.status).toBe('COMPLETED');
  });

  test('API: OXXO pending → POST /payments/confirm → COMPLETED', async ({ request }) => {
    await ensureDemoGateway(request);
    const order = await createPendingAsyncOrder(request, 'OXXO');

    const confirmRes = await request.post(`${API}/payments/confirm`, {
      data: {
        orderId: order.id,
        externalId: `banorte_demo_${order.publicId}`,
      },
    });
    expect(confirmRes.ok()).toBeTruthy();

    const detailRes = await request.get(`${API}/orders/${order.publicId}`);
    expect(detailRes.ok()).toBeTruthy();
    const detail = (await detailRes.json()) as {
      status: string;
      items: { tickets: unknown[] }[];
    };
    expect(detail.status).toBe('COMPLETED');
    const ticketCount = detail.items.reduce((n, i) => n + (i.tickets?.length ?? 0), 0);
    expect(ticketCount).toBeGreaterThan(0);
  });

  test('UI: SPEI pago page shows Simular acreditamiento and completes', async ({
    page,
    request,
  }) => {
    await ensureDemoGateway(request);
    const order = await createPendingAsyncOrder(request, 'SPEI');
    const clabe = String(order.paymentAction?.metadata?.clabe ?? '');
    const ref = String(order.paymentAction?.reference ?? '');

    const q = new URLSearchParams({
      method: 'SPEI',
      ref,
      clabe,
      concept: ref,
      demo: '1',
    });
    await page.goto(`/orders/${order.publicId}/pago?${q}`);

    await expect(page.getByRole('button', { name: /Simular acreditamiento/i })).toBeVisible({
      timeout: 15_000,
    });
    await page.getByRole('button', { name: /Simular acreditamiento/i }).click();

    await page.waitForURL(new RegExp(`/orders/${order.publicId}$`), { timeout: 20_000 });
    await expect(page.getByText(/Compra confirmada/i)).toBeVisible({ timeout: 15_000 });
    await expect(page.getByRole('heading', { name: /Tus boletos están listos/i })).toBeVisible();

    const statusRes = await request.get(`${API}/orders/${order.publicId}/status`);
    expect(statusRes.ok()).toBeTruthy();
    const status = (await statusRes.json()) as { status: string };
    expect(status.status).toBe('COMPLETED');
  });
});
