'use client';

import { useEffect, useState } from 'react';
import Link from 'next/link';
import { listEvents, getChannelHealth, configureChannels, type EventRow } from '@/lib/platform-api';
import { ApiError } from '@/lib/api';
import {
  AnonymousView,
  ApiErrorView,
  NoOrgView,
  useSession,
} from '../events/_shared/api-state';
import platform from '../_styles/platform.module.scss';

type ChannelPct = { web: number; taquilla: number; api: number };

function parseChannels(metadata?: Record<string, unknown>): ChannelPct {
  const ch = metadata?.channels as Record<string, { allocation?: number }> | undefined;
  if (ch) {
    return {
      web: Number(ch.web?.allocation ?? 50),
      taquilla: Number(ch.taquilla?.allocation ?? 35),
      api: Number(ch.api?.allocation ?? 15),
    };
  }
  return { web: 50, taquilla: 35, api: 15 };
}

export default function ChannelsPage() {
  const [events, setEvents] = useState<EventRow[]>([]);
  const [selected, setSelected] = useState('');
  const [health, setHealth] = useState<Record<string, { orders?: number; revenue?: number; status?: string }> | null>(null);
  const [channels, setChannels] = useState<ChannelPct>({ web: 50, taquilla: 35, api: 15 });
  const [saving, setSaving] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [nonce, setNonce] = useState(0);
  const session = useSession();
  const token = session.token;

  useEffect(() => {
    if (!token) return;
    setError(null);
    listEvents(token)
      .then((list) => {
        setEvents(list);
        if (list[0]) setSelected(list[0].id);
      })
      .catch(setError);
  }, [token, nonce]);

  useEffect(() => {
    if (!selected || !token) return;
    // La salud de canales es accesoria: si falla no debe tumbar la pantalla,
    // pero tampoco puede quedar como un rechazo sin capturar.
    getChannelHealth(token, selected)
      .then(setHealth)
      .catch(() => setHealth(null));
    const ev = events.find((e) => e.id === selected);
    if (ev?.metadata) setChannels(parseChannels(ev.metadata));
  }, [selected, events, token]);

  const total = channels.web + channels.taquilla + channels.api;

  async function save() {
    if (total !== 100) {
      setMsg('La suma debe ser 100%');
      return;
    }
    if (!token || !selected) return;
    setSaving(true);
    setMsg(null);
    try {
      await configureChannels(token, selected, {
        web: { enabled: true, allocation: channels.web },
        taquilla: { enabled: true, allocation: channels.taquilla, locations: [] },
        api: { enabled: true, allocation: channels.api },
      });
      setMsg('Canales guardados');
      const list = await listEvents(token);
      setEvents(list);
    } catch (e) {
      setMsg(
        e instanceof ApiError
          ? `${e.userMessage} (${e.status})`
          : e instanceof Error
            ? e.message
            : 'Error',
      );
    } finally {
      setSaving(false);
    }
  }

  if (session.status === 'anonymous') return <AnonymousView />;
  if (session.status === 'no-org') return <NoOrgView />;
  if (error) {
    return (
      <ApiErrorView
        error={error}
        context="cargar los eventos de tu organización"
        onRetry={() => setNonce((n) => n + 1)}
      />
    );
  }

  return (
    <div>
      <header className={platform.pageHeader}>
        <div>
          <h1>Canales de venta</h1>
          <p>Web · Taquilla · API — asignación y salud</p>
        </div>
      </header>

      <section className={platform.panel}>
        <label style={{ display: 'block', marginBottom: '1rem', fontSize: '0.875rem' }}>
          Evento
          <select
            value={selected}
            onChange={(e) => setSelected(e.target.value)}
            style={{ display: 'block', marginTop: '0.35rem', padding: '0.5rem', width: '100%', maxWidth: 400 }}
          >
            {events.map((e) => (
              <option key={e.id} value={e.id}>
                {e.title}
              </option>
            ))}
          </select>
        </label>

        <div className={platform.formGrid}>
          <label>
            Web %
            <input
              type="number"
              min={0}
              max={100}
              value={channels.web}
              onChange={(e) => setChannels({ ...channels, web: Number(e.target.value) })}
            />
          </label>
          <label>
            Taquilla %
            <input
              type="number"
              min={0}
              max={100}
              value={channels.taquilla}
              onChange={(e) => setChannels({ ...channels, taquilla: Number(e.target.value) })}
            />
          </label>
          <label>
            API %
            <input
              type="number"
              min={0}
              max={100}
              value={channels.api}
              onChange={(e) => setChannels({ ...channels, api: Number(e.target.value) })}
            />
          </label>
        </div>
        <p style={{ fontSize: '0.8125rem', color: total === 100 ? '#404040' : '#b91c1c' }}>Total: {total}%</p>
        <button type="button" className={platform.primaryBtn} disabled={saving || total !== 100} onClick={save}>
          {saving ? 'Guardando…' : 'Guardar asignación'}
        </button>
        {msg && <p style={{ marginTop: '0.75rem', fontSize: '0.875rem' }}>{msg}</p>}
        {selected && (
          <Link href={`/events/${selected}`} className={platform.ghostBtn} style={{ display: 'inline-block', marginTop: '1rem' }}>
            Ver hub del evento →
          </Link>
        )}

        {health && (
          <div style={{ marginTop: '1.5rem' }}>
            <h3 style={{ fontSize: '0.875rem', marginBottom: '0.75rem' }}>Salud en tiempo real</h3>
            <div className={platform.cardGrid}>
              {Object.entries(health).map(([name, data]) => (
                <article key={name} className={platform.statCard}>
                  <span>{name.toUpperCase()}</span>
                  <strong>{data.status ?? '—'}</strong>
                  <small>
                    {data.orders ?? 0} órdenes · ${(data.revenue ?? 0).toLocaleString()}
                  </small>
                </article>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
