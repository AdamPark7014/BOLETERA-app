'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useParams } from 'next/navigation';
import Link from 'next/link';
import dynamic from 'next/dynamic';
import {
  getEventHub,
  configureChannels,
  getChannelHealth,
  publishEvent,
  updateOffer,
  setEventPricing,
  getVenueLayout,
  type EventHub,
  type EventPublishValidation,
} from '@/lib/platform-api';
import { flatSeats, normalizeSeatMap, resolveOfferForSection } from '@boletera/venue-engine';
import type { SeatMapData } from '@boletera/shared';
import { useToast } from '@/components/Toast/ToastProvider';
import { ApiStateBoundary, useSession } from '../_shared/api-state';
import { LiveInventoryPanel } from '../_shared/LiveInventoryPanel';
import { InventoryBlocksPanel } from '../_shared/InventoryBlocksPanel';
import { CompliancePanel } from './CompliancePanel';
import { EventPublishValidationPanel } from './EventPublishValidationPanel';
import {
  countOf,
  getAvailability,
  occupancyPercent,
  soldCount,
  type AvailabilitySnapshot,
} from '../_shared/inventory-api';
import platform from '../../_styles/platform.module.scss';

const Venue3DViewer = dynamic(
  () => import('@boletera/venue-3d').then((m) => m.Venue3DViewer),
  { ssr: false },
);

const API = process.env.NEXT_PUBLIC_ADMIN_API_URL || 'http://localhost:4000/api/v1';

type Tab = 'overview' | 'live' | 'blocks' | 'channels' | 'map3d' | 'pricing' | 'compliance';

const TAB_LABEL: Record<Tab, string> = {
  overview: 'Resumen',
  live: 'En vivo',
  blocks: 'Bloqueos',
  channels: 'Canales',
  map3d: 'Mapa 3D',
  pricing: 'Precios',
  compliance: 'Cumplimiento',
};
type ChannelPct = { web: number; taquilla: number; api: number };

function parseChannelAllocation(metadata: Record<string, unknown>): ChannelPct {
  const channels = metadata?.channels as Record<string, { allocation?: number }> | undefined;
  const alloc = metadata?.channelAllocation as Record<string, { allocation?: number }> | undefined;
  const src = channels ?? alloc;
  if (src && typeof src === 'object') {
    return {
      web: Number(src.web?.allocation ?? 50),
      taquilla: Number(src.taquilla?.allocation ?? 35),
      api: Number(src.api?.allocation ?? 15),
    };
  }
  return { web: 50, taquilla: 35, api: 15 };
}

export default function EventHubPage() {
  const { id } = useParams<{ id: string }>();
  const [tab, setTab] = useState<Tab>('overview');
  const [hub, setHub] = useState<EventHub | null>(null);
  const [health, setHealth] = useState<Record<string, { orders?: number; revenue?: number; status?: string }> | null>(null);
  const [channels, setChannels] = useState<ChannelPct>({ web: 50, taquilla: 35, api: 15 });
  const [saving, setSaving] = useState(false);
  const [publishing, setPublishing] = useState(false);
  const [offerEdits, setOfferEdits] = useState<Record<string, string>>({});
  const [pricingSaving, setPricingSaving] = useState<string | null>(null);
  const [dynamicPricing, setDynamicPricing] = useState(false);
  const [hubError, setHubError] = useState<unknown>(null);
  const [availability, setAvailability] = useState<AvailabilitySnapshot | null>(null);
  const [layoutId, setLayoutId] = useState<string | null>(null);
  const [publishValidation, setPublishValidation] = useState<EventPublishValidation | null>(null);
  const [validationRefreshKey, setValidationRefreshKey] = useState(0);
  const toast = useToast();
  const session = useSession();
  const token = session.token;

  const handleValidationChange = useCallback((validation: EventPublishValidation | null) => {
    setPublishValidation(validation);
  }, []);

  function reload() {
    if (!token || !id) return;
    setHubError(null);
    getEventHub(token, id)
      .then((data) => {
        setHub(data);
        setChannels(parseChannelAllocation(data.metadata ?? {}));
        const edits: Record<string, string> = {};
        data.event.offers?.forEach((o) => {
          edits[o.id] = String(o.basePrice);
        });
        setOfferEdits(edits);
        setDynamicPricing(Boolean((data.event as { enableDynamic?: boolean }).enableDynamic));
      })
      .catch(setHubError);

    // El contrato nuevo agrega: `availability` ya no trae `tickets[]`, así que la
    // cabecera se pinta con `totals` y el detalle vive en la pestaña «En vivo».
    getAvailability(token, id, { silent: true })
      .then(setAvailability)
      .catch(() => setAvailability(null));

    getChannelHealth(token, id).then(setHealth).catch(() => {});
    setValidationRefreshKey((k) => k + 1);
  }

  async function saveDynamicPricing() {
    if (!token || !id || !hub) return;
    const base = Number(hub.event.offers?.[0]?.basePrice ?? 100);
    try {
      await setEventPricing(token, id, {
        basePrice: base,
        dynamicPricingEnabled: dynamicPricing,
      });
      toast.success('Pricing dinámico actualizado');
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al guardar el pricing dinámico');
    }
  }

  useEffect(() => {
    reload();
    // La sesión se resuelve de forma asíncrona: sin `token` en las dependencias
    // la primera carga salía siempre vacía y la pantalla se quedaba en «Cargando».
  }, [id, token]);

  async function saveChannels() {
    const total = channels.web + channels.taquilla + channels.api;
    if (total !== 100) {
      toast.error(`La suma debe ser 100% (actual: ${total}%)`);
      return;
    }
    if (!token || !id) return;
    setSaving(true);
    try {
      await configureChannels(token, id, {
        web: { enabled: true, allocation: channels.web },
        taquilla: { enabled: true, allocation: channels.taquilla, locations: [] },
        api: { enabled: true, allocation: channels.api },
      });
      toast.success('Canales guardados');
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al guardar');
    } finally {
      setSaving(false);
    }
  }

  async function saveOfferPrice(offerId: string) {
    if (!token || !id) return;
    const price = Number(offerEdits[offerId]);
    if (!Number.isFinite(price) || price <= 0) return;
    setPricingSaving(offerId);
    try {
      await updateOffer(token, id, offerId, { basePrice: price });
      toast.success('Precio actualizado');
      reload();
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Error al guardar el precio');
    } finally {
      setPricingSaving(null);
    }
  }

  const [seats3dStatus, setSeats3dStatus] = useState<Record<string, string>>({});
  const [venueMapData, setVenueMapData] = useState<SeatMapData | null>(null);

  useEffect(() => {
    if (tab !== 'map3d' || !id) return;
    fetch(`${API}/3d/events/${id}/interactive`)
      .then((r) => (r.ok ? r.json() : null))
      .then((data: { statusBySeat?: Record<string, string> } | null) => {
        if (data?.statusBySeat) setSeats3dStatus(data.statusBySeat);
      })
      .catch(() => {});
  }, [tab, id]);

  useEffect(() => {
    const vId = (hub?.event as { venue?: { id?: string } } | undefined)?.venue?.id;
    // El layout hace falta para el 3D y también para los bloqueos, que se piden
    // contra `/layouts/:layoutId/seats/hold`, no contra el evento.
    if (!token || !vId || (tab !== 'map3d' && tab !== 'blocks')) return;
    getVenueLayout(token, vId)
      .then((data) => {
        setVenueMapData(data.layout.mapData);
        setLayoutId(data.layout.id ?? null);
      })
      .catch(() => setLayoutId(null));
  }, [tab, hub, token]);

  const normalizedVenueMap = useMemo(
    () => (venueMapData ? normalizeSeatMap(venueMapData) : null),
    [venueMapData],
  );

  const seatsFor3d = useMemo(() => {
    const normalized = normalizedVenueMap;
    if (!normalized) return [];
    const offers = hub?.event.offers ?? [];
    return flatSeats(normalized).map((seat) => {
      const sec = normalized.sections.find((s) => s.id === seat.sectionId);
      const offer = resolveOfferForSection(offers, sec?.slug ?? '', seat.sectionName);
      return {
        id: seat.id,
        label: seat.label,
        x: seat.x,
        y: seat.y,
        z: seat.position?.y ?? seat.elevation ?? 0,
        rotation: seat.rotation,
        row: seat.row,
        elevation: seat.elevation,
        position: seat.position,
        rotation3d: seat.rotation3d,
        coord3d: seat.coord3d,
        visibility: seat.visibility,
        section: seat.sectionName,
        color: seat.sectionColor,
        price: offer ? Number(offer.basePrice) : undefined,
        levelId: seat.levelId,
        status:
          seat.visibility?.blocked
            ? ('blocked' as const)
            : (seats3dStatus[seat.id] as 'available' | 'held' | 'sold' | 'blocked') || 'available',
      };
    });
  }, [normalizedVenueMap, hub, seats3dStatus]);

  const publishBlockerHint = useMemo(() => {
    if (!publishValidation || publishValidation.ready) return undefined;
    const blockers = publishValidation.checks.filter((c) => c.status === 'blocker');
    return blockers.map((b) => b.label).join(', ');
  }, [publishValidation]);

  // Sesión ausente, sin organización o 401/403: pantalla explicativa en vez de
  // un «Cargando evento…» eterno o el texto crudo del error de Nest.
  if (session.status !== 'ready' || hubError || !hub) {
    return (
      <ApiStateBoundary
        session={session}
        error={hubError}
        loading={!hub}
        context="abrir el evento"
        onRetry={reload}
        loadingLabel="Cargando evento…"
      >
        <span />
      </ApiStateBoundary>
    );
  }

  const { event, inventory } = hub;
  const venueId = (event as { venue?: { id?: string } }).venue?.id ?? '';
  const channelTotal = channels.web + channels.taquilla + channels.api;
  const canPublish = publishValidation?.ready ?? false;

  // `availability` es la fuente autoritativa; `hub.inventory` queda de respaldo
  // para eventos cuyo inventario aún no se publicó.
  const totalTickets = availability?.totalTickets ?? inventory.total;
  const sold = availability ? soldCount(availability) : inventory.sold;
  const held = availability ? countOf(availability, 'HELD') : inventory.held;
  const availableSeats = availability ? countOf(availability, 'AVAILABLE') : inventory.available;
  const occupancy = availability ? occupancyPercent(availability) : inventory.occupancyPercent;

  return (
    <div>
      <header className={platform.pageHeader}>
        <div>
          <h1>{event.title}</h1>
          <p>
            {event.venue?.name} · {new Date(event.startsAt).toLocaleString('es-MX')} ·{' '}
            {occupancy}% ocupación · {event.status}
          </p>
        </div>
        <div style={{ display: 'flex', gap: '0.5rem', flexWrap: 'wrap' }}>
          <button
            type="button"
            className={platform.primaryBtn}
            disabled={publishing || !canPublish}
            title={
              canPublish
                ? undefined
                : publishBlockerHint
                  ? `Bloqueado: ${publishBlockerHint}`
                  : 'Completa el checklist de publicación'
            }
            onClick={async () => {
              if (!canPublish) {
                toast.error('Completa los requisitos del checklist antes de publicar.');
                return;
              }
              if (!confirm('¿Publicar el inventario de este evento? Esto genera los boletos vendibles a partir del mapa guardado.')) return;
              if (!token || !id) return;
              setPublishing(true);
              try {
                const r = await publishEvent(token, id);
                toast.success(`Publicado: ${r.totalSeats} boletos en ${r.sections} zonas`);
                reload();
              } catch (e) {
                toast.error(e instanceof Error ? e.message : 'Error al publicar');
              } finally {
                setPublishing(false);
              }
            }}
          >
            {publishing ? 'Publicando…' : 'Publicar inventario'}
          </button>
          {venueId && (
            <Link href={`/venues/${venueId}/map`} className={platform.ghostBtn}>
              Editor de mapa
            </Link>
          )}
          <Link href="/events" className={platform.ghostBtn}>
            ← Eventos
          </Link>
        </div>
      </header>

      {token && (
        <EventPublishValidationPanel
          token={token}
          eventId={id}
          refreshKey={validationRefreshKey}
          onValidationChange={handleValidationChange}
        />
      )}

      <div className={platform.cardGrid}>
        <article className={platform.statCard}>
          <span>Vendidos</span>
          <strong>{sold.toLocaleString('es-MX')}</strong>
          <small>de {totalTickets.toLocaleString('es-MX')}</small>
        </article>
        <article className={platform.statCard}>
          <span>Disponibles</span>
          <strong>{availableSeats.toLocaleString('es-MX')}</strong>
        </article>
        <article className={platform.statCard}>
          <span>En hold</span>
          <strong>{held.toLocaleString('es-MX')}</strong>
          {availability && <small>{availability.activeHolds} holds activos</small>}
        </article>
        <article className={platform.statCard}>
          <span>Órdenes</span>
          <strong>{event._count?.orders ?? 0}</strong>
        </article>
      </div>

      <nav className={platform.tabs} aria-label="Secciones del evento">
        {(['overview', 'live', 'blocks', 'channels', 'map3d', 'pricing', 'compliance'] as Tab[]).map((t) => (
          <button
            key={t}
            type="button"
            aria-current={tab === t ? 'page' : undefined}
            className={tab === t ? platform.active : ''}
            onClick={() => setTab(t)}
          >
            {TAB_LABEL[t]}
          </button>
        ))}
      </nav>

      {tab === 'overview' && (
        <section className={platform.panel}>
          <h2>Ventas por canal</h2>
          <table className={platform.table}>
            <thead>
              <tr>
                <th>Canal</th>
                <th>Órdenes</th>
                <th>Ingresos</th>
              </tr>
            </thead>
            <tbody>
              {hub.channels.map((c) => (
                <tr key={c.channel}>
                  <td>{c.channel}</td>
                  <td>{c._count}</td>
                  <td>${Number(c._sum.totalAmount ?? 0).toLocaleString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
          <p style={{ marginTop: '1rem', fontSize: '0.875rem', color: 'var(--bl-gray-500)' }}>
            Asignación: Web {channels.web}% · Taquilla {channels.taquilla}% · API {channels.api}%
          </p>
        </section>
      )}

      {tab === 'live' && (
        <section className={platform.panel}>
          <h2>Onsale en vivo</h2>
          <LiveInventoryPanel token={token!} eventId={id} eventTitle={event.title} />
        </section>
      )}

      {tab === 'blocks' && (
        <section className={platform.panel}>
          <h2>Bloqueos administrativos</h2>
          <InventoryBlocksPanel token={token!} eventId={id} layoutId={layoutId} />
        </section>
      )}

      {tab === 'channels' && (
        <section className={platform.panel}>
          <h2>Asignación multi-canal (100%)</h2>
          <div>
            <label>
              Web %
              <input
                type="range"
                min={0}
                max={100}
                value={channels.web}
                onChange={(e) => setChannels({ ...channels, web: Number(e.target.value) })}
              />
              <span>{channels.web}%</span>
            </label>
            <label>
              Taquilla %
              <input
                type="range"
                min={0}
                max={100}
                value={channels.taquilla}
                onChange={(e) => setChannels({ ...channels, taquilla: Number(e.target.value) })}
              />
              <span>{channels.taquilla}%</span>
            </label>
            <label>
              API %
              <input
                type="range"
                min={0}
                max={100}
                value={channels.api}
                onChange={(e) => setChannels({ ...channels, api: Number(e.target.value) })}
              />
              <span>{channels.api}%</span>
            </label>
          </div>
          <p style={{ fontSize: '0.8125rem', color: channelTotal === 100 ? '#404040' : '#b91c1c' }}>
            Total: {channelTotal}% {channelTotal !== 100 && '— ajusta hasta 100%'}
          </p>
          <button
            type="button"
            className={platform.primaryBtn}
            disabled={saving || channelTotal !== 100}
            onClick={saveChannels}
          >
            {saving ? 'Guardando…' : 'Guardar canales'}
          </button>
          {health && (
            <div style={{ marginTop: '1.5rem' }}>
              <h3 style={{ fontSize: '0.875rem', marginBottom: '0.75rem' }}>Salud en tiempo real</h3>
              <div className={platform.cardGrid}>
                {Object.entries(health).map(([key, val]) => (
                  <article key={key} className={platform.statCard}>
                    <span>{key}</span>
                    <strong>{val.status ?? '—'}</strong>
                    <small>
                      {val.orders ?? 0} órdenes · ${(val.revenue ?? 0).toLocaleString()}
                    </small>
                  </article>
                ))}
              </div>
            </div>
          )}
        </section>
      )}

      {tab === 'map3d' && (
        <section className={platform.panel}>
          <h2>Vista 3D + asientos en vivo</h2>
          {venueMapData && seatsFor3d.length === 0 ? (
            <p style={{ fontSize: '0.8125rem', color: 'var(--bl-gray-500)' }}>
              El venue todavía no tiene asientos en su layout.
            </p>
          ) : (
            <Venue3DViewer
              mode="orbit"
              seats={seatsFor3d}
              currency="MXN"
              stage={normalizedVenueMap?.venue?.stage}
              aisles={normalizedVenueMap?.venue?.aisles}
              obstacles={normalizedVenueMap?.venue?.obstacles}
              stairs={normalizedVenueMap?.venue?.stairs}
              exits={normalizedVenueMap?.venue?.exits}
              furniture={normalizedVenueMap?.venue?.furniture}
              focusPoints={normalizedVenueMap?.venue?.focusPoints}
              levels={normalizedVenueMap?.venue?.levels}
              mapData={normalizedVenueMap}
            />
          )}
          <p style={{ marginTop: '0.75rem', fontSize: '0.8125rem', color: 'var(--bl-gray-500)' }}>
            Publica inventario antes de vender. Editor:{' '}
            <Link href={`/venues/${venueId}/map`}>mapa del venue</Link>
          </p>
        </section>
      )}

      {tab === 'compliance' && (
        <CompliancePanel
          eventId={id}
          // Publicar arranca un reloj legal y deja constancia fechada: no es una
          // acción de solo lectura y no la ofrece cualquiera.
          canWrite={['PROMOTER', 'ADMIN', 'SUPER_ADMIN'].includes(session.role ?? '')}
        />
      )}

      {tab === 'pricing' && (
        <section className={platform.panel}>
          <label style={{ display: 'flex', alignItems: 'center', gap: '0.5rem', marginBottom: '1rem' }}>
            <input
              type="checkbox"
              checked={dynamicPricing}
              onChange={(e) => setDynamicPricing(e.target.checked)}
            />
            Pricing dinámico (surge por ocupación)
          </label>
          <button type="button" className={platform.ghostBtn} onClick={saveDynamicPricing}>
            Guardar reglas dinámicas
          </button>
          <h2>Ofertas / zonas</h2>
          <table className={platform.table}>
            <thead>
              <tr>
                <th>Zona</th>
                <th>Nombre</th>
                <th>Precio (MXN)</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {event.offers?.map((o) => (
                <tr key={o.id}>
                  <td>{o.zone}</td>
                  <td>{o.name}</td>
                  <td>
                    <input
                      type="number"
                      min={1}
                      step={50}
                      value={offerEdits[o.id] ?? o.basePrice}
                      onChange={(e) => setOfferEdits({ ...offerEdits, [o.id]: e.target.value })}
                      style={{ width: 100 }}
                    />
                  </td>
                  <td>
                    <button
                      type="button"
                      className={platform.ghostBtn}
                      disabled={pricingSaving === o.id}
                      onClick={() => saveOfferPrice(o.id)}
                    >
                      {pricingSaving === o.id ? '…' : 'Guardar'}
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      )}
    </div>
  );
}


