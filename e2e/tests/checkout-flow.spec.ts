import { test, expect } from '@playwright/test';

const API = process.env.API_URL || 'http://localhost:4000/api/v1';

test.describe('Checkout Banorte (demo)', () => {
  test('checkout page shows Banorte methods', async ({ page }) => {
    const params = new URLSearchParams({
      eventId: 'demo-event',
      offerId: 'demo-offer',
      holdIds: 'hold-demo',
    });
    await page.goto(`/checkout?${params}`);
    await expect(page.getByRole('heading', { name: /Checkout/i })).toBeVisible();
    await expect(page.getByText(/Banorte/i).first()).toBeVisible();
    await expect(page.getByText(/SPEI/i)).toBeVisible();
  });

  test('full hold → checkout when API and seed available', async ({ page, request }) => {
    const health = await request.get(`${API}/health`);
    test.skip(!health.ok(), 'API no disponible');

    const eventsRes = await request.get(`${API}/discovery/events`);
    test.skip(!eventsRes.ok(), 'Sin catálogo de eventos');
    const events = (await eventsRes.json()) as { id: string; slug: string }[];
    const event = events.find((e) => e.slug === 'concierto-demo-2026') ?? events[0];
    test.skip(!event, 'Sin eventos en seed');

    const detailRes = await request.get(`${API}/discovery/events/${event.slug}`);
    test.skip(!detailRes.ok(), 'Evento no encontrado');
    const detail = (await detailRes.json()) as {
      id: string;
      offers: { id: string }[];
    };
    const offerId = detail.offers[0]?.id;
    test.skip(!offerId, 'Sin ofertas');

    const availRes = await request.get(`${API}/inventory/${detail.id}/availability`);
    test.skip(!availRes.ok(), 'Sin inventario');
    const avail = (await availRes.json()) as {
      tickets?: { seatId: string | null; status: string }[];
    };
    const seatId = avail.tickets?.find((t) => t.status === 'AVAILABLE' && t.seatId)?.seatId ?? null;
    test.skip(!seatId, 'Sin asientos disponibles');

    const holdRes = await request.post(`${API}/inventory/holds`, {
      data: { eventId: detail.id, seatIds: [seatId], sessionId: `e2e-${Date.now()}` },
    });
    test.skip(!holdRes.ok(), 'No se pudo reservar asiento');
    const holdData = (await holdRes.json()) as { holds?: { id: string }[] };
    const holdIds = holdData.holds?.map((h) => h.id).join(',') ?? '';
    test.skip(!holdIds, 'Hold vacío');

    const q = new URLSearchParams({ eventId: detail.id, offerId, holdIds });
    await page.goto(`/checkout?${q}`);
    await expect(page.getByText(/modo demo/i)).toBeVisible({ timeout: 15_000 });
    await page.getByLabel(/Nombre/i).fill('E2E Comprador');
    await page.getByLabel(/Email/i).fill('e2e@boletera.test');
    await page.getByRole('button', { name: /Continuar al pago/i }).click();
    await page.waitForURL(/\/orders\/|result=ok|\/pago/, { timeout: 20_000 });
  });
});
