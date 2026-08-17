'use client';

/**
 * Cliente HTTP de la sala de espera virtual.
 *
 * El API ya implementa la fila (`/waiting-room/:eventId`), pero hasta ahora
 * ningún cliente la consumía: sin front, la fila no existe para el comprador y
 * `POST /inventory/holds` responde 403 sin que nadie sepa por qué.
 *
 * Aquí sólo vive el transporte —tipos, peticiones y custodia del pase—; el
 * ritmo de sondeo y la máquina de estados están en `useWaitingRoom`.
 */

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

/** `GET /waiting-room/:eventId`. Cacheable 10 s en el propio servidor. */
export type WaitingRoomConfig = { enabled: false } | { enabled: true; opensAt: string };

/** `GET /waiting-room/:eventId/status`. `pass` SÓLO viene si `admitted`. */
export type QueueStatus = {
  eventId: string;
  /** 1-indexada. `null` cuando este navegador no está en la fila. */
  position: number | null;
  ahead: number;
  total: number;
  admitted: boolean;
  estimatedWaitSeconds: number;
  opensAt: string;
  pass?: string;
};

/**
 * Error de fila con el status a la vista: el sondeo necesita distinguir un 429
 * (retroceder) de un 400 (la sala se apagó: dejar de sondear) o de un fallo de
 * red (status 0, reintentar sin castigar al usuario).
 */
export class QueueError extends Error {
  readonly status: number;
  /** Segundos que pidió el servidor esperar, si mandó `Retry-After`. */
  readonly retryAfterSeconds: number | null;

  constructor(status: number, message: string, retryAfterSeconds: number | null = null) {
    super(message);
    this.name = 'QueueError';
    this.status = status;
    this.retryAfterSeconds = retryAfterSeconds;
  }
}

function messageOf(body: unknown): string {
  if (!body || typeof body !== 'object') return '';
  const raw = (body as { message?: unknown }).message;
  if (typeof raw === 'string') return raw;
  if (Array.isArray(raw)) return raw.filter((x) => typeof x === 'string').join('. ');
  return '';
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  let res: Response;
  try {
    res = await fetch(`${API}${path}`, {
      ...init,
      headers: { 'Content-Type': 'application/json', ...init?.headers },
    });
  } catch {
    // Sin status: la pestaña se quedó sin red o el API no responde.
    throw new QueueError(0, 'No pudimos contactar con la sala de espera.');
  }

  let payload: unknown = null;
  try {
    payload = await res.json();
  } catch {
    // Hay respuestas sin cuerpo (204, algunos errores del proxy): el status basta.
  }

  if (!res.ok) {
    const retryAfter = Number(res.headers.get('retry-after'));
    throw new QueueError(
      res.status,
      messageOf(payload) || `HTTP ${res.status}`,
      Number.isFinite(retryAfter) && retryAfter > 0 ? retryAfter : null,
    );
  }
  return (payload ?? {}) as T;
}

export function fetchWaitingRoomConfig(eventId: string): Promise<WaitingRoomConfig> {
  // Sin `no-store` a propósito: el servidor manda `max-age=10` y queremos que
  // el navegador lo respete. En un onsale esta ruta la pide todo el mundo a la vez.
  return request<WaitingRoomConfig>(`/waiting-room/${encodeURIComponent(eventId)}`);
}

/** Entrar es idempotente: volver a llamar NO reordena ni penaliza. */
export function joinQueue(eventId: string, memberId: string): Promise<QueueStatus> {
  return request<QueueStatus>(`/waiting-room/${encodeURIComponent(eventId)}/join`, {
    method: 'POST',
    body: JSON.stringify({ memberId }),
    cache: 'no-store',
  });
}

export function fetchQueueStatus(eventId: string, memberId: string): Promise<QueueStatus> {
  return request<QueueStatus>(
    `/waiting-room/${encodeURIComponent(eventId)}/status?memberId=${encodeURIComponent(memberId)}`,
    { cache: 'no-store' },
  );
}

/**
 * Salir de la fila. `keepalive` permite que la petición sobreviva al cierre de
 * la pestaña (`pagehide`), que es justo cuando más importa liberar el sitio.
 */
export async function leaveQueue(
  eventId: string,
  memberId: string,
  options: { keepalive?: boolean } = {},
): Promise<void> {
  try {
    await fetch(
      `${API}/waiting-room/${encodeURIComponent(eventId)}?memberId=${encodeURIComponent(memberId)}`,
      { method: 'DELETE', keepalive: options.keepalive ?? false },
    );
  } catch {
    // Salir es cortesía con los demás, no un requisito: si falla, el TTL de 24 h
    // de la fila limpia igual. Nunca debe romperle la compra a nadie.
  }
}

// --- custodia del pase -------------------------------------------------------

const PASS_STORAGE_PREFIX = 'boletera_queue_pass:';

/**
 * El pase va a `localStorage`, no a `sessionStorage`.
 *
 * Es una firma HMAC(evento, miembro) sin caducidad propia: mientras la sala
 * siga abierta sigue siendo válido. Guardarlo por pestaña significaría que
 * cerrar la pestaña por accidente manda al comprador al final de la fila
 * (quien reentra después de la apertura entra en FIFO, detrás de la pre-fila).
 * Con `localStorage` vuelve directo a su sitio.
 */
export function readStoredPass(eventId: string): string | null {
  if (typeof window === 'undefined') return null;
  try {
    const value = window.localStorage.getItem(`${PASS_STORAGE_PREFIX}${eventId}`);
    return value && value.trim() ? value : null;
  } catch {
    return null;
  }
}

export function storePass(eventId: string, pass: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(`${PASS_STORAGE_PREFIX}${eventId}`, pass);
  } catch {
    // Modo privado: el pase vive en memoria durante la sesión y basta.
  }
}

export function clearStoredPass(eventId: string): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.removeItem(`${PASS_STORAGE_PREFIX}${eventId}`);
  } catch {
    /* almacenamiento bloqueado */
  }
}

/**
 * ¿Este 403 viene de la fila o de un hold ajeno?
 *
 * `describeInventoryError` no puede distinguirlos (ambos son 403) y vive fuera
 * de este módulo, así que el reconocimiento se hace aquí: sólo el rechazo de la
 * sala debe devolver al comprador a la fila; un 403 de propiedad de hold no.
 */
export function isQueueRejection(status: number, body: unknown): boolean {
  if (status !== 403) return false;
  const message = messageOf(body).toLowerCase();
  return message.includes('sala de espera') || message.includes('waiting room');
}
