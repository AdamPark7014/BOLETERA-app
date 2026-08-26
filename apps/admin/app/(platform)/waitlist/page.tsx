'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
  KpiCard,
  PageHeader,
  SearchInput,
  Section,
  formatNumber,
  type BadgeTone,
} from '@boletera/ui';
import {
  listWaitlistByOrg,
  notifyWaitlistBatch,
  type WaitlistRow,
} from '@/lib/platform-api';
import { formatDateTime } from '../orders/_ui/format';
import {
  AnonymousView,
  ApiErrorView,
  LoadingView,
  NoOrgView,
  useSession,
} from '../events/_shared/api-state';
import platform from '../_styles/platform.module.scss';
import styles from './waitlist.module.scss';

const STATUS_LABEL: Record<string, string> = {
  PENDING: 'En espera',
  NOTIFIED: 'Notificado',
  CONVERTED: 'Convertido',
  EXPIRED: 'Expirado',
  CANCELLED: 'Cancelado',
};

const STATUS_TONE: Record<string, BadgeTone> = {
  PENDING: 'warning',
  NOTIFIED: 'info',
  CONVERTED: 'success',
  EXPIRED: 'neutral',
  CANCELLED: 'danger',
};

function statusLabel(status: string): string {
  return STATUS_LABEL[status] ?? status;
}

function statusTone(status: string): BadgeTone {
  return STATUS_TONE[status] ?? 'neutral';
}

function displayName(row: WaitlistRow): string | null {
  const parts = [row.firstName, row.lastName].filter(Boolean);
  return parts.length > 0 ? parts.join(' ') : null;
}

function rowMatchesQuery(row: WaitlistRow, needle: string): boolean {
  if (!needle) return true;
  const name = displayName(row) ?? '';
  return (
    row.email.toLowerCase().includes(needle) ||
    name.toLowerCase().includes(needle) ||
    row.event.title.toLowerCase().includes(needle) ||
    (row.phone ?? '').toLowerCase().includes(needle)
  );
}

export default function WaitlistPage() {
  const session = useSession();
  const [rows, setRows] = useState<WaitlistRow[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('ALL');
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

  const needle = q.trim().toLowerCase();

  const filtered = useMemo(() => {
    return rows.filter((row) => {
      if (status !== 'ALL' && row.status !== status) return false;
      return rowMatchesQuery(row, needle);
    });
  }, [rows, needle, status]);

  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.status, (counts.get(row.status) ?? 0) + 1);
    return counts;
  }, [rows]);

  const byEvent = useMemo(() => {
    const map = new Map<string, WaitlistRow[]>();
    for (const row of filtered) {
      const list = map.get(row.event.id);
      if (list) list.push(row);
      else map.set(row.event.id, [row]);
    }
    return Array.from(map.entries()).sort((a, b) =>
      (a[1][0]?.event.title ?? '').localeCompare(b[1][0]?.event.title ?? '', 'es-MX'),
    );
  }, [filtered]);

  const stats = useMemo(() => {
    const events = new Set(rows.map((r) => r.event.id)).size;
    const pending = rows.filter((r) => r.status === 'PENDING').length;
    const notified = rows.filter((r) => r.status === 'NOTIFIED').length;
    return { total: rows.length, events, pending, notified };
  }, [rows]);

  const anyFilter = Boolean(needle || status !== 'ALL');

  if (session.status === 'anonymous') return <AnonymousView />;
  if (session.status === 'no-org') return <NoOrgView />;
  if (error) {
    return (
      <ApiErrorView error={error} context="leer la lista de espera" onRetry={reload} />
    );
  }

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Operaciones"
        title="Lista de espera"
        description="Fans en cola cuando el evento está agotado — notificación masiva al liberar cupo"
        actions={
          <Button
            type="button"
            variant="outline"
            loading={loading}
            loadingLabel="Actualizando…"
            onClick={() => reload()}
          >
            Actualizar
          </Button>
        }
      />

      <Section columns={4} gap="md" className={styles.kpiStrip}>
        <KpiCard label="Registros" value={formatNumber(stats.total)} tone="accent" />
        <KpiCard label="Eventos con cola" value={formatNumber(stats.events)} />
        <KpiCard
          label="En espera"
          value={formatNumber(stats.pending)}
          tone={stats.pending > 0 ? 'warning' : 'neutral'}
          invertDelta
        />
        <KpiCard
          label="Notificados"
          value={formatNumber(stats.notified)}
          tone={stats.notified > 0 ? 'info' : 'neutral'}
          hint="Pendientes de comprar tras el aviso"
        />
      </Section>

      {rows.length > 0 && (
        <Card padding="md" className={styles.filterCard}>
          <div className={styles.toolbar}>
            <SearchInput
              value={q}
              onValueChange={setQ}
              placeholder="Correo, nombre, teléfono o evento…"
              aria-label="Buscar en la lista de espera"
              className={styles.searchInput}
              inputSize="sm"
            />
          </div>

          <div className={styles.filters} role="group" aria-label="Filtrar por estado">
            <button
              type="button"
              aria-pressed={status === 'ALL'}
              className={status === 'ALL' ? styles.filterActive : styles.filter}
              onClick={() => setStatus('ALL')}
            >
              Todos ({rows.length})
            </button>
            {Array.from(statusCounts.entries())
              .sort((a, b) => b[1] - a[1])
              .map(([s, n]) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={status === s}
                  className={status === s ? styles.filterActive : styles.filter}
                  onClick={() => setStatus(s)}
                >
                  {statusLabel(s)} ({n})
                </button>
              ))}
          </div>

          <p className={styles.filterMeta}>
            {filtered.length === rows.length
              ? `${filtered.length} registros en ${byEvent.length} evento(s)`
              : `${filtered.length} de ${rows.length} registros coinciden con los filtros`}
          </p>
        </Card>
      )}

      {loading && <LoadingView label="Cargando lista de espera…" />}

      {!loading && !rows.length && (
        <EmptyState
          title="Sin registros en lista de espera"
          description="Cuando un evento se agote, los fans que pidan aviso aparecerán aquí para notificarlos al liberar cupo."
        />
      )}

      {!loading && rows.length > 0 && filtered.length === 0 && (
        <EmptyState
          title="Ningún resultado con los filtros actuales"
          description="Prueba otro correo, evento o quita algún filtro de estado."
          action={
            anyFilter ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  setQ('');
                  setStatus('ALL');
                }}
              >
                Limpiar filtros
              </Button>
            ) : undefined
          }
        />
      )}

      {!loading &&
        byEvent.map(([eventId, entries]) => {
          const pendingInEvent = entries.filter((e) => e.status === 'PENDING').length;
          return (
            <Card key={eventId} padding="md" className={styles.eventSection}>
              <CardHeader
                as="h2"
                title={
                  <div className={styles.eventTitle}>
                    <span>{entries[0]?.event.title}</span>
                    <Badge tone="neutral" variant="soft" size="sm">
                      {formatNumber(entries.length)} en pantalla
                    </Badge>
                    {pendingInEvent > 0 && (
                      <Badge tone="warning" variant="soft" size="sm" dot>
                        {formatNumber(pendingInEvent)} en espera
                      </Badge>
                    )}
                  </div>
                }
                actions={
                  <Button
                    type="button"
                    disabled={busy === eventId || pendingInEvent === 0}
                    loading={busy === eventId}
                    loadingLabel="Enviando…"
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
                    Notificar lote
                  </Button>
                }
              />

              <table className={platform.table}>
                <caption className={styles.srOnly}>
                  Registros en lista de espera para {entries[0]?.event.title}
                </caption>
                <thead>
                  <tr>
                    <th scope="col">Contacto</th>
                    <th scope="col" className={styles.numeric}>Cantidad</th>
                    <th scope="col">Estado</th>
                    <th scope="col">Registro</th>
                  </tr>
                </thead>
                <tbody>
                  {entries.map((entry) => {
                    const name = displayName(entry);
                    return (
                      <tr key={entry.id}>
                        <td className={styles.emailCell}>
                          <strong>{entry.email}</strong>
                          {name ? <span className={styles.subtle}>{name}</span> : null}
                          {entry.phone ? (
                            <span className={styles.subtle}>{entry.phone}</span>
                          ) : null}
                        </td>
                        <td className={styles.numeric}>{formatNumber(entry.quantity)}</td>
                        <td>
                          <Badge tone={statusTone(entry.status)} variant="soft" size="sm" dot>
                            {statusLabel(entry.status)}
                          </Badge>
                        </td>
                        <td className={styles.when}>{formatDateTime(entry.createdAt)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </Card>
          );
        })}
    </div>
  );
}
