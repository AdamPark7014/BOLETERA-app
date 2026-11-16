'use client';

import { formatDayMonth, formatTicketAmount, formatTime } from '@boletera/ui';
import { useEffect, useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { stockImageForCategory } from '@boletera/shared';
import { Badge, Card, EmptyState, SearchInput, SkeletonCard } from '@boletera/ui';
import { apiJson, getTaquillaToken } from '@/lib/auth';
import { PosShell } from '@/components/PosShell';
import { digitPressed, type Hotkey } from '@/lib/hotkeys';
import styles from './eventos.module.scss';

type Offer = {
  id: string;
  name?: string;
  zone?: string;
  basePrice: string | number;
  remainingQuantity?: number;
  isAvailable?: boolean;
};

type EventRow = {
  id: string;
  title: string;
  slug: string;
  startsAt: string;
  category?: string;
  venue: { name: string };
  offers?: Offer[];
};

export default function EventosTaquillaPage() {
  const router = useRouter();
  const [events, setEvents] = useState<EventRow[]>([]);
  const [q, setQ] = useState('');
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!getTaquillaToken()) router.replace('/login');
  }, [router]);

  useEffect(() => {
    apiJson<EventRow[]>('/taquilla/events')
      .then(setEvents)
      .catch(() => setEvents([]))
      .finally(() => setLoading(false));
  }, []);

  const filtered = useMemo(() => {
    if (!q) return events;
    const needle = q.toLowerCase();
    return events.filter(
      (e) => e.title.toLowerCase().includes(needle) || e.venue?.name?.toLowerCase().includes(needle)
    );
  }, [events, q]);

  function ventaUrl(eventId: string, offerId?: string) {
    const params = new URLSearchParams({ eventId });
    if (offerId) params.set('offerId', offerId);
    return `/venta?${params.toString()}`;
  }

  const hotkeys: Hotkey[] = [
    {
      keys: '1-9',
      label: 'Vender evento',
      whileTyping: true,
      match: (e) => digitPressed(e) != null,
      run: (e) => {
        const n = digitPressed(e);
        const row = n ? filtered[n - 1] : undefined;
        if (!row) return;
        const offer = (row.offers ?? []).find((o) => o.isAvailable !== false);
        router.push(ventaUrl(row.id, offer?.id));
      },
    },
    {
      keys: 'F2',
      label: 'Buscar',
      whileTyping: true,
      run: () => document.getElementById('event-search')?.focus(),
    },
    {
      keys: 'Esc',
      label: 'Volver',
      whileTyping: true,
      match: (e) => e.key === 'Escape',
      run: () => router.push('/'),
    },
  ];

  return (
    <PosShell
      title="Selecciona evento y zona"
      backHref="/"
      size="md"
      hotkeys={hotkeys}
      escapeGoesBack={false}
    >
      <Card padding="sm" className={styles.searchCard}>
        <SearchInput
          id="event-search"
          autoFocus
          value={q}
          onValueChange={setQ}
          placeholder="Buscar por nombre o recinto…"
          inputSize="lg"
          shortcut="F2"
        />
      </Card>

      {loading ? (
        <div className={styles.skeletonStack}>
          <SkeletonCard />
          <SkeletonCard />
          <SkeletonCard />
        </div>
      ) : filtered.length === 0 ? (
        <EmptyState
          illustration="search"
          title={events.length === 0 ? 'No hay eventos activos' : 'Sin coincidencias'}
          description={
            events.length === 0
              ? 'Cuando haya eventos publicados para taquilla aparecerán aquí.'
              : 'Prueba con otro nombre o recinto.'
          }
          size="md"
        />
      ) : (
        <ul className={styles.list}>
          {filtered.map((e, i) => {
            const date = new Date(e.startsAt);
            const offers = (e.offers || []).filter((o) => o.isAvailable !== false);
            const prices = offers
              .map((o) => Number(o.basePrice))
              .filter((n) => Number.isFinite(n) && n > 0);
            const from = prices.length ? Math.min(...prices) : 0;
            const thumb = stockImageForCategory(e.category, e.title);

            return (
              <li key={e.id}>
                <Card padding="none" className={styles.eventCard}>
                  <button
                    type="button"
                    className={styles.eventToggle}
                    onClick={() => router.push(ventaUrl(e.id))}
                  >
                    <span className={styles.idx}>{String(i + 1).padStart(2, '0')}</span>
                    <div
                      className={styles.thumb}
                      style={{ backgroundImage: `url(${thumb})` }}
                      aria-hidden="true"
                    />
                    <div className={styles.cardDate}>
                      <strong>{formatDayMonth(date).split(' ')[0]}</strong>
                      <span>{formatDayMonth(date).split(' ')[1] ?? ''}</span>
                    </div>
                    <div className={styles.cardInfo}>
                      <strong>{e.title}</strong>
                      <span>
                        {e.venue?.name} · {formatTime(date)}
                        {from > 0 ? ` · desde ${formatTicketAmount(from)}` : ''}
                      </span>
                    </div>
                    <div className={styles.cardMeta}>
                      {offers.length > 0 ? (
                        <Badge tone="neutral" variant="soft" size="sm">
                          {offers.length} zona{offers.length === 1 ? '' : 's'}
                        </Badge>
                      ) : (
                        <Badge tone="warning" variant="soft" size="sm">
                          Sin ofertas
                        </Badge>
                      )}
                      <span className={styles.chevron} aria-hidden="true">
                        ›
                      </span>
                    </div>
                  </button>
                </Card>
              </li>
            );
          })}
        </ul>
      )}
    </PosShell>
  );
}
