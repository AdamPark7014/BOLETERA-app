'use client';

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { TicketButton, TicketState, formatTicketAmount } from '@boletera/ui';
import { SiteHeader } from '@/components/SiteHeader';
import { HoldCountdown } from '@/components/HoldCountdown';
import styles from './espera.module.scss';

const API = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:4000/api/v1';

type Claim = {
  id: string;
  quantity: number;
  offerId: string | null;
  facePrice: number | null;
  claimExpiresAt: string;
  email: string;
  event: {
    id: string;
    title: string;
    slug: string;
    startsAt: string;
  };
};

type View =
  | { kind: 'loading' }
  | { kind: 'error'; title: string; body: string }
  | { kind: 'ready'; claim: Claim }
  | { kind: 'expired' };

export default function EsperaPage() {
  const params = useParams<{ token: string }>();
  const token = params?.token ?? '';
  const router = useRouter();
  const [view, setView] = useState<View>({ kind: 'loading' });

  const load = useCallback(async () => {
    if (!token) {
      setView({
        kind: 'error',
        title: 'Enlace incompleto',
        body: 'Falta el código de la lista de espera.',
      });
      return;
    }
    setView({ kind: 'loading' });
    try {
      const res = await fetch(`${API}/waitlist/claim/${encodeURIComponent(token)}`);
      if (res.status === 404) {
        setView({
          kind: 'error',
          title: 'No encontramos ese enlace',
          body: 'Puede que ya se haya usado o que el enlace esté mal copiado.',
        });
        return;
      }
      if (res.status === 400) {
        setView({ kind: 'expired' });
        return;
      }
      if (!res.ok) throw new Error('fail');
      const claim = (await res.json()) as Claim;
      setView({ kind: 'ready', claim });
    } catch {
      setView({
        kind: 'error',
        title: 'No pudimos cargar tu lugar',
        body: 'Revisa tu conexión e inténtalo de nuevo en unos segundos.',
      });
    }
  }, [token]);

  useEffect(() => {
    void load();
  }, [load]);

  function goBuy(claim: Claim) {
    const q = new URLSearchParams();
    q.set('waitlist', token);
    if (claim.offerId) q.set('offerId', claim.offerId);
    router.push(`/events/${encodeURIComponent(claim.event.slug)}?${q.toString()}`);
  }

  return (
    <>
      <SiteHeader compact />
      <main id="contenido" tabIndex={-1} className={styles.page}>
        {view.kind === 'loading' ? (
          <TicketState title="Cargando tu lugar…" minHeight={360} />
        ) : null}

        {view.kind === 'error' ? (
          <TicketState
            title={view.title}
            body={view.body}
            minHeight={360}
            action={
              <Link href="/" className={styles.link}>
                Ver cartelera
              </Link>
            }
          />
        ) : null}

        {view.kind === 'expired' ? (
          <TicketState
            title="Se acabó el tiempo"
            body="Tu turno de 60 minutos venció. Si siguen liberándose boletos, pasamos al siguiente de la lista."
            minHeight={360}
            action={
              <Link href="/" className={styles.link}>
                Ver cartelera
              </Link>
            }
          />
        ) : null}

        {view.kind === 'ready' ? (
          <section className={styles.card} aria-labelledby="espera-title">
            <p className={styles.eyebrow}>Lista de espera</p>
            <h1 id="espera-title" className={styles.title}>
              {view.claim.event.title}
            </h1>
            <p className={styles.meta}>
              Aviso para {view.claim.email}
              {view.claim.quantity > 1 ? ` · ${view.claim.quantity} boletos` : ''}
            </p>
            {view.claim.facePrice != null ? (
              <p className={styles.price}>
                Precio original{' '}
                <strong>{formatTicketAmount(view.claim.facePrice)}</strong>
              </p>
            ) : (
              <p className={styles.price}>Al precio original del evento</p>
            )}
            <HoldCountdown
              expiresAt={view.claim.claimExpiresAt}
              warnSeconds={120}
              label="Tiempo para comprar"
              hint="Si no compras, el lugar pasa al siguiente de la lista"
              expiredHint="El tiempo se acabó. El lugar pasó al siguiente."
              onExpire={() => setView({ kind: 'expired' })}
            />
            <div className={styles.actions}>
              <TicketButton type="button" onClick={() => goBuy(view.claim)}>
                Comprar ahora
              </TicketButton>
              <Link href={`/events/${view.claim.event.slug}`} className={styles.ghost}>
                Ver el evento
              </Link>
            </div>
          </section>
        ) : null}
      </main>
    </>
  );
}
