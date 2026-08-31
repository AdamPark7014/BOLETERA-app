'use client';

import { useEffect, useState } from 'react';
import { fetchOrderResource, readStoredOrderAccessToken } from '@/lib/order-access';
import styles from './OrderQrCards.module.scss';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';
/** Rotating QR window is ~15s; poll under that so puerta always sees a fresh token. */
const POLL_MS = 11_000;

type QrData = {
  tickets: { id: string; code: string; qrPayload: string; qrDataUrl?: string }[];
  eventTitle: string;
};

/**
 * `GET /orders/:publicId/qrcodes` exige credencial: el `accessToken` del
 * comprador invitado o el JWT. El padre normalmente ya lo resolvió (viene del
 * enlace del correo); si no lo pasa, se recupera el archivado para esta orden
 * antes de rendirse.
 *
 * La firma del QR rota ~cada 15s: hay que refrescar sin reload o falla en puerta.
 */
export function OrderQrCards({
  publicId,
  accessToken,
}: {
  publicId: string;
  accessToken?: string | null;
}) {
  const [data, setData] = useState<QrData | null>(null);
  const [denied, setDenied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);

  useEffect(() => {
    let cancelled = false;
    let timer: ReturnType<typeof setInterval> | undefined;

    const load = async (isRefresh: boolean) => {
      const token = accessToken ?? readStoredOrderAccessToken(publicId);
      if (isRefresh) setRefreshing(true);
      try {
        const res = await fetchOrderResource<QrData>(API, publicId, '/qrcodes', token);
        if (cancelled) return;
        if (res.ok) {
          setData(res.data);
          setDenied(false);
        } else if (res.forbidden) {
          setDenied(true);
          if (timer) clearInterval(timer);
        }
      } finally {
        if (!cancelled && isRefresh) setRefreshing(false);
      }
    };

    void load(false);
    timer = setInterval(() => {
      void load(true);
    }, POLL_MS);

    return () => {
      cancelled = true;
      if (timer) clearInterval(timer);
    };
  }, [publicId, accessToken]);

  if (denied) {
    return (
      <section className={styles.section}>
        <h2>Códigos QR de acceso</h2>
        <p className={styles.notice} role="status">
          No pudimos mostrar tus códigos QR con este enlace. Ábrelo desde el correo de confirmación
          o inicia sesión con el correo de la compra: los boletos siguen emitidos.
        </p>
      </section>
    );
  }

  if (!data?.tickets.length) return null;

  return (
    <section className={styles.section}>
      <h2>Códigos QR de acceso</h2>
      <p className={styles.event}>{data.eventTitle}</p>
      <p className={styles.hint} role="status">
        {refreshing ? 'Actualizando códigos…' : 'Los códigos se renuevan solos cada pocos segundos.'}{' '}
        No uses una captura estática como acceso en puerta.
      </p>
      <ul className={styles.grid}>
        {data.tickets.map((t) => (
          <li key={t.id}>
            <article className={styles.card}>
              {t.qrDataUrl && (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={t.qrDataUrl} alt={`Código QR del boleto ${t.code}`} width={180} height={180} />
              )}
              <code>{t.code}</code>
            </article>
          </li>
        ))}
      </ul>
    </section>
  );
}
