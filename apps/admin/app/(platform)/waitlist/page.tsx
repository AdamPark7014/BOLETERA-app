'use client';

import { useEffect, useState } from 'react';
import {
  listWaitlistByOrg,
  notifyWaitlistBatch,
  type WaitlistRow,
} from '@/lib/platform-api';
import {
  AnonymousView,
  ApiErrorView,
  LoadingView,
  NoOrgView,
  useSession,
} from '../events/_shared/api-state';
import platform from '../_styles/platform.module.scss';

export default function WaitlistPage() {
  const session = useSession();
  const [rows, setRows] = useState<WaitlistRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const { token, orgId } = session;

  function reload() {
    if (!token || !orgId) return;
    setLoading(true);
    setError(null);
    // `catch(() => setRows([]))` convertía un 403 en «sin registros»: la pantalla
    // mentía diciendo que no había nadie en cola.
    listWaitlistByOrg(token, orgId)
      .then((data) => {
        setRows(data);
        setError(null);
      })
      .catch(setError)
      .finally(() => setLoading(false));
  }

  useEffect(() => {
    if (session.status === 'ready') reload();
    else if (session.status !== 'loading') setLoading(false);
  }, [orgId, token, session.status]);

  if (session.status === 'anonymous') return <AnonymousView />;
  if (session.status === 'no-org') return <NoOrgView />;
  if (error) {
    return (
      <ApiErrorView error={error} context="leer la lista de espera" onRetry={reload} />
    );
  }

  const byEvent = rows.reduce<Record<string, WaitlistRow[]>>((acc, r) => {
    const id = r.event.id;
    if (!acc[id]) acc[id] = [];
    acc[id].push(r);
    return acc;
  }, {});

  return (
    <div>
      <header className={platform.pageHeader}>
        <div>
          <h1>Lista de espera</h1>
          <p>Fans en cola cuando el evento está agotado — notificación masiva al liberar cupo</p>
        </div>
      </header>

      {Object.entries(byEvent).map(([eventId, entries]) => (
        <section key={eventId} className={platform.panel}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <h2>{entries[0]?.event.title}</h2>
            <button
              type="button"
              className={platform.primaryBtn}
              disabled={busy === eventId}
              onClick={async () => {
                if (!token) return;
                setBusy(eventId);
                try {
                  await notifyWaitlistBatch(token, eventId);
                  reload();
                } catch (err) {
                  setError(err);
                } finally {
                  setBusy(null);
                }
              }}
            >
              {busy === eventId ? 'Enviando…' : 'Notificar lote'}
            </button>
          </div>
          <table className={platform.table}>
            <thead>
              <tr>
                <th>Email</th>
                <th>Cantidad</th>
                <th>Estado</th>
                <th>Registro</th>
              </tr>
            </thead>
            <tbody>
              {entries.map((e) => (
                <tr key={e.id}>
                  <td>{e.email}</td>
                  <td>{e.quantity}</td>
                  <td>{e.status}</td>
                  <td>{new Date(e.createdAt).toLocaleString('es-MX')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </section>
      ))}

      {loading && <LoadingView label="Cargando lista de espera…" />}
      {!loading && !rows.length && (
        <p style={{ color: '#525252' }}>Sin registros en lista de espera para tu organización.</p>
      )}
    </div>
  );
}
