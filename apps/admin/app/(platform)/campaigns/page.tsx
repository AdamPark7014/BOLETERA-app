'use client';

/**
 * Campañas y presales.
 *
 * Antes cada acción (crear, publicar, exportar códigos) era un `await` sin
 * `catch`: si el API respondía 403 la pantalla se quedaba igual y el usuario
 * creía que había funcionado. Ahora cada acción confirma o explica, y la lista
 * distingue vacío de fallo de sin permiso.
 */

import { useCallback, useState } from 'react';
import { ApiError, getStoredToken } from '@/lib/api';
import {
  createCampaign,
  exportPresaleCodes,
  listCampaigns,
  listEvents,
  publishCampaignApi,
  type EventRow,
} from '@/lib/platform-api';
import { useToast } from '@/components/Toast/ToastProvider';
import platform from '../_styles/platform.module.scss';
import styles from '../orders/orders.module.scss';
import { EmptyBlock, Notice, ResourceView } from '../orders/_ui/States';
import { useAdminSession, useResource } from '../orders/_ui/useResource';
import { formatNumber, formatPercent } from '../orders/_ui/format';

type Campaign = {
  id: string;
  name: string;
  type: string;
  status: string;
  allocation: number;
  discountValue: number;
  redeemed?: number;
  codes?: string[];
};

const STATUS: Record<string, { label: string; cls: string }> = {
  DRAFT: { label: 'Borrador', cls: 'refunded' },
  ACTIVE: { label: 'Activa', cls: 'paid' },
  PAUSED: { label: 'Pausada', cls: 'pending' },
  ENDED: { label: 'Terminada', cls: 'refunded' },
  SCHEDULED: { label: 'Programada', cls: 'hold' },
};

const TYPES = [
  { value: 'presale', label: 'Presale' },
  { value: 'early_bird', label: 'Early bird' },
  { value: 'vip', label: 'VIP' },
  { value: 'group', label: 'Grupal' },
];

export default function CampaignsPage() {
  const session = useAdminSession();
  const toast = useToast();
  const [eventId, setEventId] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [form, setForm] = useState({
    name: '',
    type: 'presale',
    discountValue: 15,
    allocation: 100,
    quantityPerUser: 4,
    startsAt: '',
    endsAt: '',
  });

  const events = useResource<EventRow[]>(
    useCallback(async ({ token }) => {
      const list = await listEvents(token);
      setEventId((current) => current || list[0]?.id || '');
      return list;
    }, []),
    { requiresOrg: false },
  );

  const campaigns = useResource<Campaign[]>(
    useCallback(
      async ({ token }) => (eventId ? ((await listCampaigns(token, eventId)) as Campaign[]) : []),
      [eventId],
    ),
    { requiresOrg: false, deps: [eventId] },
  );

  function fail(e: unknown, fallback: string) {
    toast.error(e instanceof ApiError ? e.userMessage : fallback);
  }

  async function handleCreate(e: React.FormEvent) {
    e.preventDefault();
    const token = getStoredToken();
    if (!token || session.phase !== 'ready' || !eventId) {
      toast.error('Necesitas una organización y un evento seleccionado para crear la campaña.');
      return;
    }
    if (new Date(form.endsAt) <= new Date(form.startsAt)) {
      toast.error('La fecha de fin debe ser posterior a la de inicio.');
      return;
    }
    setBusy('create');
    try {
      await createCampaign(token, session.orgId, eventId, {
        ...form,
        discountType: 'percentage',
        startsAt: new Date(form.startsAt),
        endsAt: new Date(form.endsAt),
      });
      toast.success(`Campaña "${form.name}" creada en borrador`);
      setForm((f) => ({ ...f, name: '', startsAt: '', endsAt: '' }));
      campaigns.reload();
    } catch (e) {
      fail(e, 'No se pudo crear la campaña');
    } finally {
      setBusy(null);
    }
  }

  async function publish(c: Campaign) {
    const token = getStoredToken();
    if (!token) return;
    if (!confirm(`¿Publicar "${c.name}"? Quedará visible para los compradores.`)) return;
    setBusy(c.id);
    try {
      await publishCampaignApi(token, c.id);
      toast.success('Campaña publicada');
      campaigns.reload();
    } catch (e) {
      fail(e, 'No se pudo publicar la campaña');
    } finally {
      setBusy(null);
    }
  }

  async function exportCodes(c: Campaign) {
    const token = getStoredToken();
    if (!token) return;
    setBusy(c.id);
    try {
      const csv = await exportPresaleCodes(token, c.id);
      const blob = new Blob([`﻿${csv}`], { type: 'text/csv;charset=utf-8' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `codigos-presale-${c.name.replace(/\W+/g, '-').toLowerCase()}.csv`;
      a.click();
      URL.revokeObjectURL(url);
      toast.success('Códigos exportados');
    } catch (e) {
      fail(e, 'No se pudieron exportar los códigos');
    } finally {
      setBusy(null);
    }
  }

  return (
    <div>
      <header className={platform.pageHeader}>
        <div>
          <h1>Campañas y presales</h1>
          <p>Presale, early bird, VIP — cupos, descuentos y códigos por evento</p>
        </div>
      </header>

      <section className={platform.panel}>
        <h2>Evento</h2>
        <ResourceView resource={events} context="los eventos" loadingRows={1}>
          {(list) =>
            list.length === 0 ? (
              <EmptyBlock
                title="No hay eventos en tu organización"
                hint="Crea un evento antes de configurar campañas."
              />
            ) : (
              <label htmlFor="campaign-event" className={styles.subtle}>
                Campañas del evento
                <select
                  id="campaign-event"
                  value={eventId}
                  onChange={(e) => setEventId(e.target.value)}
                  style={{ display: 'block', marginTop: '0.35rem', width: '100%', maxWidth: 420, minHeight: 36 }}
                >
                  {list.map((ev) => (
                    <option key={ev.id} value={ev.id}>
                      {ev.title}
                    </option>
                  ))}
                </select>
              </label>
            )
          }
        </ResourceView>
      </section>

      <section className={platform.panel}>
        <h2>Nueva campaña</h2>
        <form className={platform.formGrid} onSubmit={handleCreate}>
          <label className={platform.full}>
            Nombre
            <input
              required
              value={form.name}
              onChange={(e) => setForm({ ...form, name: e.target.value })}
            />
          </label>
          <label>
            Tipo
            <select value={form.type} onChange={(e) => setForm({ ...form, type: e.target.value })}>
              {TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label>
            Descuento (%)
            <input
              type="number"
              min="0"
              max="100"
              value={form.discountValue}
              onChange={(e) => setForm({ ...form, discountValue: Number(e.target.value) })}
            />
          </label>
          <label>
            Cupo (boletos)
            <input
              type="number"
              min="1"
              value={form.allocation}
              onChange={(e) => setForm({ ...form, allocation: Number(e.target.value) })}
            />
          </label>
          <label>
            Máximo por persona
            <input
              type="number"
              min="1"
              value={form.quantityPerUser}
              onChange={(e) => setForm({ ...form, quantityPerUser: Number(e.target.value) })}
            />
          </label>
          <label>
            Inicio
            <input
              type="datetime-local"
              required
              value={form.startsAt}
              onChange={(e) => setForm({ ...form, startsAt: e.target.value })}
            />
          </label>
          <label>
            Fin
            <input
              type="datetime-local"
              required
              value={form.endsAt}
              onChange={(e) => setForm({ ...form, endsAt: e.target.value })}
            />
          </label>
          <div className={platform.full}>
            <button
              type="submit"
              className={platform.primaryBtn}
              disabled={busy !== null || !eventId}
            >
              {busy === 'create' ? 'Creando…' : 'Crear campaña'}
            </button>
          </div>
        </form>
      </section>

      <section className={platform.panel}>
        <h2>Campañas del evento</h2>
        <Notice tone="info" title="Dónde viven estas campañas">
          <p>
            Se guardan dentro de los metadatos del evento, no en una tabla propia: no hay historial
            ni bitácora por campaña, y borrar el evento se las lleva.
          </p>
        </Notice>
        <ResourceView resource={campaigns} context="las campañas" loadingRows={3}>
          {(list) =>
            list.length === 0 ? (
              <EmptyBlock
                title="Sin campañas para este evento"
                hint="Crea una arriba; queda en borrador hasta que la publiques."
              />
            ) : (
              <table className={platform.table}>
                <caption className={styles.srOnly}>
                  Campañas con tipo, estado, cupo, canje y descuento
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Nombre</th>
                    <th scope="col">Tipo</th>
                    <th scope="col">Estado</th>
                    <th scope="col" className={styles.numeric}>
                      Cupo
                    </th>
                    <th scope="col" className={styles.numeric}>
                      Canjeado
                    </th>
                    <th scope="col" className={styles.numeric}>
                      Descuento
                    </th>
                    <th scope="col">Acciones</th>
                  </tr>
                </thead>
                <tbody>
                  {list.map((c) => {
                    const st = STATUS[c.status] ?? { label: c.status, cls: 'refunded' };
                    const redeemed = c.redeemed ?? 0;
                    const pct = c.allocation > 0 ? (redeemed / c.allocation) * 100 : 0;
                    return (
                      <tr key={c.id}>
                        <th scope="row">{c.name}</th>
                        <td>{TYPES.find((t) => t.value === c.type)?.label ?? c.type}</td>
                        <td>
                          <span className={`${styles.status} ${styles[st.cls]}`}>{st.label}</span>
                        </td>
                        <td className={styles.numeric}>{formatNumber(c.allocation)}</td>
                        <td className={styles.numeric}>
                          {formatNumber(redeemed)}
                          <br />
                          <small className={styles.subtle}>{formatPercent(pct, 0)}</small>
                        </td>
                        <td className={styles.numeric}>{c.discountValue}%</td>
                        <td>
                          {c.status === 'DRAFT' && (
                            <button
                              type="button"
                              className={platform.ghostBtn}
                              disabled={busy !== null}
                              onClick={() => void publish(c)}
                            >
                              {busy === c.id ? 'Guardando…' : 'Publicar'}
                            </button>
                          )}
                          {c.type === 'presale' && (
                            <button
                              type="button"
                              className={platform.ghostBtn}
                              disabled={busy !== null}
                              onClick={() => void exportCodes(c)}
                            >
                              {busy === c.id ? 'Exportando…' : 'Exportar códigos'}
                            </button>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )
          }
        </ResourceView>
      </section>
    </div>
  );
}
