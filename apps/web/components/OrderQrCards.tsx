'use client';

import Image from 'next/image';
import Link from 'next/link';
import { useEffect, useState } from 'react';
import { StageArt } from '@boletera/ui';
import { shortWhen } from '@/lib/event-display';
import { fetchOrderResource, readStoredOrderAccessToken } from '@/lib/order-access';
import { readLastTicketQr, saveLastTicketQr } from '@/lib/offline-ticket';
import styles from './OrderQrCards.module.scss';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';
/** Rotating QR window is ~15s; poll under that so puerta always sees a fresh token. */
const POLL_MS = 11_000;

type QrData = {
  tickets: { id: string; code: string; qrPayload: string; qrDataUrl?: string }[];
  eventTitle: string;
};

export type TicketSeat = {
  code: string;
  section?: string | null;
  row?: string | null;
  seatNumber?: string | null;
};

export type TicketEvent = {
  title: string;
  startsAt?: string | null;
  venueName?: string | null;
  image?: string | null;
  slug?: string | null;
};

/**
 * Boletos como boleto (Boleto.dc.html): imagen arriba, sección/fila/asiento en
 * titular, línea punteada con muescas y el QR sobre blanco con marco dorado.
 *
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
  event,
  seats = [],
  expectedCount = 1,
  allowTransfer = true,
  allowResale = true,
}: {
  publicId: string;
  accessToken?: string | null;
  event?: TicketEvent | null;
  seats?: TicketSeat[];
  /** Cuántos boletos pintar en esqueleto mientras llegan los QR (sin saltos). */
  expectedCount?: number;
  allowTransfer?: boolean;
  allowResale?: boolean;
}) {
  const [data, setData] = useState<QrData | null>(null);
  const [denied, setDenied] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [loadedAt, setLoadedAt] = useState<number | null>(null);
  const [now, setNow] = useState<number>(0);

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
          setLoadedAt(Date.now());
          saveLastTicketQr({
            publicId,
            tickets: res.data.tickets,
            eventTitle: res.data.eventTitle,
            savedAt: Date.now(),
          });
        } else if (res.forbidden) {
          const cached = readLastTicketQr(publicId);
          if (cached) {
            setData({ tickets: cached.tickets, eventTitle: cached.eventTitle });
            setDenied(false);
            setLoadedAt(cached.savedAt);
          } else {
            setDenied(true);
            if (timer) clearInterval(timer);
          }
        } else {
          const cached = readLastTicketQr(publicId);
          if (cached && !isRefresh) {
            setData({ tickets: cached.tickets, eventTitle: cached.eventTitle });
            setLoadedAt(cached.savedAt);
          }
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

  // Reloj de la barra «cambia en N s»: solo visual, el sondeo manda.
  useEffect(() => {
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);

  if (denied) {
    return (
      <section className={styles.section}>
        <h2 className={styles.title}>Códigos QR de acceso</h2>
        <p className={styles.notice} role="status">
          No pudimos mostrar tus códigos QR con este enlace. Ábrelo desde el correo de confirmación
          o inicia sesión con el correo de la compra: los boletos siguen emitidos.
        </p>
      </section>
    );
  }

  const left = loadedAt && now ? Math.max(0, Math.ceil((POLL_MS - (now - loadedAt)) / 1000)) : null;
  const progress = left != null ? left / (POLL_MS / 1000) : 1;
  const list = data?.tickets ?? [];
  const placeholders = data ? 0 : Math.max(1, expectedCount);
  const total = list.length || placeholders;

  return (
    <section className={styles.section} aria-labelledby="boletos-title">
      <h2 className="sr-only" id="boletos-title">
        Tus boletos
      </h2>
      <p className="sr-only" role="status">
        {refreshing ? 'Actualizando códigos' : ''}
      </p>
      <ul className={styles.grid}>
        {list.map((t, index) => {
          const seat = seats.find((s) => s.code === t.code);
          return (
            <li key={t.id}>
              <Stub
                event={event}
                seat={seat}
                index={index}
                total={total}
                qr={t.qrDataUrl}
                code={t.code}
                left={left}
                progress={progress}
                allowTransfer={allowTransfer}
                allowResale={allowResale}
              />
            </li>
          );
        })}
        {Array.from({ length: placeholders }).map((_, index) => (
          <li key={`skel-${index}`}>
            <Stub event={event} index={index} total={total} left={null} progress={1} loading />
          </li>
        ))}
      </ul>
    </section>
  );
}

function Stub({
  event,
  seat,
  index,
  total,
  qr,
  code,
  left,
  progress,
  loading = false,
  allowTransfer = true,
  allowResale = true,
}: {
  event?: TicketEvent | null;
  seat?: TicketSeat;
  index: number;
  total: number;
  qr?: string;
  code?: string;
  left: number | null;
  progress: number;
  loading?: boolean;
  allowTransfer?: boolean;
  allowResale?: boolean;
}) {
  const general = !seat?.section && !seat?.row && !seat?.seatNumber;
  const facts = general
    ? [{ k: 'Acceso', v: 'General' }]
    : [
        { k: 'Sección', v: seat?.section || '—' },
        { k: 'Fila', v: seat?.row || '—' },
        { k: 'Asiento', v: seat?.seatNumber || '—' },
      ];

  return (
    <article className={styles.ticket} aria-label={`Boleto ${index + 1} de ${total}`}>
      <div className={styles.media}>
        {event?.image ? (
          <Image
            src={event.image}
            alt=""
            fill
            sizes="(max-width: 720px) 100vw, 400px"
            className={styles.cover}
          />
        ) : (
          <StageArt seed={event?.slug ?? 'boleto'} fade={false} className={styles.cover} />
        )}
        <span className={styles.mediaShade} />
        <span className={styles.count}>
          Boleto {index + 1} de {total}
        </span>
        <div className={styles.mediaCopy}>
          <strong className={styles.eventTitle}>{event?.title ?? 'Tu evento'}</strong>
          <span>
            {[event?.startsAt ? shortWhen(event.startsAt) : null, event?.venueName]
              .filter(Boolean)
              .join(' · ')}
          </span>
        </div>
      </div>

      <dl className={styles.facts}>
        {facts.map((f) => (
          <div key={f.k}>
            <dt>{f.k}</dt>
            <dd>{f.v}</dd>
          </div>
        ))}
      </dl>

      <div className={styles.perforation} aria-hidden="true" />

      <div className={styles.qrArea}>
        <div className={styles.qrFrame}>
          {qr ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={qr} alt={`Código QR del boleto ${code ?? ''}`} width={220} height={220} />
          ) : (
            <span className={styles.qrSkeleton} role={loading ? 'status' : undefined}>
              {loading ? <span className="sr-only">Cargando código QR…</span> : null}
            </span>
          )}
        </div>
        <div className={styles.rotate}>
          <span className={styles.rotateBar}>
            <span style={{ transform: `scaleX(${progress})` }} />
          </span>
          <span className={styles.rotateText}>
            {left != null ? `Cambia en ${left} s` : 'Preparando código…'}
          </span>
        </div>
        {code ? (
          <code className={styles.code}>{code}</code>
        ) : (
          <span className={styles.code}>&nbsp;</span>
        )}
      </div>

      {!loading && (allowTransfer || allowResale) ? (
        <div className={styles.stubActions}>
          {allowTransfer ? (
            <Link href="/cuenta" className={styles.stubButton}>
              Transferir
            </Link>
          ) : null}
          {allowResale ? (
            <Link href="/resale/vender" className={styles.stubButton}>
              Revender
            </Link>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}
