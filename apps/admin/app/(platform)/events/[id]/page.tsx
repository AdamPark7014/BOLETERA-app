'use client';

import { Suspense, useEffect, useState } from 'react';
import Link from 'next/link';
import { useParams } from 'next/navigation';
import { ApiError } from '@/lib/api';
import { hasCapability } from '@/lib/permissions';
import { getChannelHealth, getEventHub, type EventHub } from '@/lib/platform-api';
import { AnonymousView, ApiErrorView, NoOrgView, useSession } from '../_shared/api-state';
import { AdminFrame, useAdminFrame } from '../_ticket/AdminFrame';
import { AgendaSection } from '../_ticket/AgendaSection';
import { NotFound } from '../_ticket/NotFound';
import { ChannelsSection } from '../_ticket/ChannelsSection';
import { EventSection } from '../_ticket/EventSection';
import { ApartadosSection } from '../_ticket/ApartadosSection';
import { ComplianceSection } from '../_ticket/ComplianceSection';
import { PhasesSection } from '../_ticket/PhasesSection';
import { ZonesSection } from '../_ticket/ZonesSection';
import styles from '../_ticket/frame.module.scss';

export default function EventHubPage() {
  return (
    <Suspense fallback={null}>
      <AdminFrame>
        <EventBody />
      </AdminFrame>
    </Suspense>
  );
}

function EventBody() {
  const { id } = useParams<{ id: string }>();
  const frame = useAdminFrame();
  const session = useSession();
  const [hub, setHub] = useState<EventHub | null>(null);
  const [health, setHealth] = useState<unknown>(null);
  const [healthState, setHealthState] = useState<'loading' | 'ready' | 'error'>('loading');
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const token = session.token;
  const canManage = hasCapability(session.role, 'events.manage');
  const canChannels = hasCapability(session.role, 'marketing.manage');
  const canInventory = hasCapability(session.role, 'inventory.operate');

  useEffect(() => {
    if (!token || !id) {
      if (session.status !== 'loading') setLoading(false);
      return;
    }
    let alive = true;
    setLoading(true);
    setHealthState('loading');
    setError(null);
    getEventHub(token, id)
      .then((data) => {
        if (!alive) return;
        setHub(data);
      })
      .catch((cause: unknown) => {
        if (!alive) return;
        setError(cause);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    getChannelHealth(token, id)
      .then((data) => {
        if (!alive) return;
        setHealth(data);
        setHealthState('ready');
      })
      .catch(() => {
        if (!alive) return;
        setHealth(null);
        setHealthState('error');
      });
    return () => {
      alive = false;
    };
  }, [id, token, session.status, nonce]);

  const missing = error instanceof ApiError && error.isNotFound;
  const markEventMissing = frame.markEventMissing;
  useEffect(() => {
    if (missing && id) markEventMissing?.(id);
  }, [missing, id, markEventMissing]);

  if (session.status === 'anonymous') return <AnonymousView />;
  if (session.status === 'no-org') return <NoOrgView />;
  if (missing) {
    return <NotFound title="No encontramos este evento" href="/events" linkLabel="Ver eventos" />;
  }
  if (error) {
    return (
      <ApiErrorView
        error={error}
        context="abrir el evento"
        onRetry={() => setNonce((current) => current + 1)}
      />
    );
  }
  if (loading || !hub || !token || !id) {
    return (
      <div className={styles.stack} aria-busy="true" aria-label="Cargando evento">
        <div className={styles.skeleton} style={{ height: 72 }} />
        <div className={styles.skeleton} style={{ height: 120 }} />
        <div className={styles.skeleton} style={{ height: 360 }} />
      </div>
    );
  }

  if (frame.section === 'agenda') return <AgendaSection event={hub.event} />;
  if (frame.section === 'zonas') {
    return (
      <ZonesSection
        eventId={id}
        event={hub.event}
        token={token}
        canWrite={canManage}
        onSaved={() => setNonce((current) => current + 1)}
      />
    );
  }
  if (frame.section === 'fases') {
    return <PhasesSection eventId={id} event={hub.event} token={token} canWrite={canManage} />;
  }
  if (frame.section === 'canales') {
    if (healthState === 'loading') {
      return (
        <section>
          <header className={styles.sectionHead}>
            <h1 className={styles.sectionTitle}>Canales</h1>
            <p className={styles.quiet}>Cargando canales.</p>
          </header>
        </section>
      );
    }
    return (
      <ChannelsSection
        eventId={id}
        metadata={hub.metadata}
        health={health}
        healthNote={
          healthState === 'error'
            ? 'No se leyó la salud de canales. Se muestran los que ya están guardados.'
            : null
        }
        token={token}
        canWrite={canChannels}
        onSaved={() => setNonce((current) => current + 1)}
      />
    );
  }
  if (frame.section === 'apartados') {
    return (
      <ApartadosSection eventId={id} event={hub.event} token={token} canOperate={canInventory} />
    );
  }
  if (frame.section === 'cumplimiento') {
    return <ComplianceSection eventId={id} token={token} canPublish={canManage} />;
  }
  if (frame.section !== 'evento') {
    return (
      <div className={styles.empty}>
        <p className={styles.emptyTitle}>Esta sección no existe</p>
        <p className={styles.quiet}>Vuelve al resumen del evento.</p>
        <Link href={`/events/${id}`} className={styles.ghostLink}>
          Ir al resumen
        </Link>
      </div>
    );
  }
  return (
    <EventSection event={hub.event} hub={hub} eventId={id} token={token} role={session.role} />
  );
}
