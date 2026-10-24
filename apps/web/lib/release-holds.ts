import { authHeaders } from '@/lib/auth';
import { getGuestSessionId } from '@/lib/guest-session';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

/**
 * Devuelve las butacas a la venta. Es best-effort: si falla, el hold caduca solo.
 * El `sessionId` va en el cuerpo: es la prueba de propiedad del apartado.
 */
export function releaseHolds(holdIds: string[]) {
  if (!holdIds.length) return;
  const sessionId = getGuestSessionId();
  for (const id of holdIds) {
    void fetch(`${API}/inventory/holds/${id}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json', ...authHeaders() },
      body: JSON.stringify({ sessionId }),
      keepalive: true,
    }).catch(() => {});
  }
}
