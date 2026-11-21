/** Último QR firmado guardado en el navegador para abrir el boleto sin red. */

export type CachedTicketQr = {
  publicId: string;
  tickets: { id: string; code: string; qrPayload: string; qrDataUrl?: string }[];
  eventTitle: string;
  savedAt: number;
};

const STORAGE_KEY = 'bt:last-ticket-qr';
const MAX_AGE_MS = 7 * 24 * 60 * 60 * 1000;

function isBrowser(): boolean {
  return typeof window !== 'undefined';
}

export function saveLastTicketQr(data: CachedTicketQr): void {
  if (!isBrowser()) return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Cuota o modo privado: el boleto sigue en memoria de la sesión.
  }
}

export function readLastTicketQr(publicId?: string): CachedTicketQr | null {
  if (!isBrowser()) return null;
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw) as CachedTicketQr;
    if (!cached?.publicId || !Array.isArray(cached.tickets)) return null;
    if (Date.now() - (cached.savedAt || 0) > MAX_AGE_MS) return null;
    if (publicId && cached.publicId !== publicId) return null;
    return cached;
  } catch {
    return null;
  }
}
