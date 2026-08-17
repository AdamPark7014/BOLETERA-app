/**
 * PRESUPUESTO DE CARGA DE ONSALE — Fase 1, eje 2.
 *
 * Reproduce el pico objetivo: recinto de 45,000 butacas, 30,000 usuarios
 * concurrentes en el minuto 1. Modela el comportamiento real: la mayoría mira
 * el mapa, una fracción reserva, una fracción menor compra.
 *
 * Uso:
 *   k6 run -e EVENT_ID=<id> -e OFFER_ID=<id> e2e/load/onsale-k6.js
 *
 * SLO propuestos (thresholds abajo):
 *   - p95 del mapa de asientos       < 800 ms
 *   - p95 de creación de hold        < 1500 ms
 *   - p95 de creación de orden       < 3000 ms
 *   - tasa de error global           < 1%
 *   - CERO respuestas 5xx en /orders (un 5xx aquí es dinero cobrado sin boleto)
 */
import http from 'k6/http';
import { check, sleep, group } from 'k6';
import { Rate, Trend, Counter } from 'k6/metrics';

const API = __ENV.API_URL || 'http://127.0.0.1:4000/api/v1';
const EVENT_ID = __ENV.EVENT_ID;
const OFFER_ID = __ENV.OFFER_ID;

const holdConflicts = new Counter('hold_conflicts');
const orderErrors = new Counter('order_5xx');
const mapLatency = new Trend('seatmap_latency');
const purchaseSuccess = new Rate('purchase_success');

export const options = {
  scenarios: {
    // 90% solo mira el mapa — es el patrón real de un onsale.
    browsers: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 27000 },
        { duration: '60s', target: 27000 },
        { duration: '30s', target: 2000 },
      ],
      exec: 'browse',
    },
    // 10% intenta reservar y comprar.
    buyers: {
      executor: 'ramping-vus',
      startVUs: 0,
      stages: [
        { duration: '30s', target: 3000 },
        { duration: '60s', target: 3000 },
        { duration: '30s', target: 200 },
      ],
      exec: 'purchase',
    },
  },
  thresholds: {
    'seatmap_latency': ['p(95)<800'],
    'http_req_duration{name:hold}': ['p(95)<1500'],
    'http_req_duration{name:order}': ['p(95)<3000'],
    'http_req_failed': ['rate<0.01'],
    'order_5xx': ['count==0'],
  },
};

export function browse() {
  group('mapa', () => {
    const res = http.get(`${API}/inventory/${EVENT_ID}/map`, { tags: { name: 'map' } });
    mapLatency.add(res.timings.duration);
    check(res, { 'mapa 200': (r) => r.status === 200 });
  });

  group('disponibilidad', () => {
    // Éste es el endpoint que el front consulta en bucle vía SSE cada 3 s.
    const res = http.get(`${API}/inventory/${EVENT_ID}/availability`, {
      tags: { name: 'availability' },
    });
    check(res, { 'disponibilidad 200': (r) => r.status === 200 });
  });

  sleep(3);
}

export function purchase() {
  const sessionId = `k6-${__VU}-${__ITER}`;

  const holdRes = http.post(
    `${API}/inventory/holds`,
    JSON.stringify({ eventId: EVENT_ID, offerId: OFFER_ID, quantity: 2, sessionId }),
    { headers: { 'Content-Type': 'application/json' }, tags: { name: 'hold' } },
  );

  if (holdRes.status === 409) {
    holdConflicts.add(1);
    purchaseSuccess.add(false);
    return;
  }
  if (holdRes.status !== 201 && holdRes.status !== 200) {
    purchaseSuccess.add(false);
    return;
  }

  const holdIds = (holdRes.json('holds') || []).map((h) => h.id);
  if (!holdIds.length) {
    purchaseSuccess.add(false);
    return;
  }

  sleep(5); // el comprador llena el formulario

  const orderRes = http.post(
    `${API}/orders`,
    JSON.stringify({
      eventId: EVENT_ID,
      offerId: OFFER_ID,
      holdIds,
      buyerName: `K6 ${__VU}`,
      buyerEmail: `k6-${__VU}-${__ITER}@load.local`,
      paymentMethod: 'SPEI',
    }),
    {
      headers: { 'Content-Type': 'application/json', 'Idempotency-Key': sessionId },
      tags: { name: 'order' },
    },
  );

  if (orderRes.status >= 500) orderErrors.add(1);
  purchaseSuccess.add(orderRes.status < 400);
  check(orderRes, { 'orden creada': (r) => r.status < 400 });
}
