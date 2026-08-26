'use client';

/**
 * Bitácora de auditoría.
 *
 * La pantalla anterior pedía 80 filas y las pintaba tal cual: sin filtros, sin
 * actor y comiéndose el error con `.catch(() => setRows([]))`, así que "no hay
 * eventos" y "no tienes permiso" se veían exactamente igual.
 *
 * Nota sobre el API: `GET /organization/:orgId/audit` solo acepta `limit`. No
 * hay filtros de servidor ni paginación expuesta, así que el filtrado es del
 * lado del cliente sobre la ventana traída. Está bien para operar el día a día;
 * para forensics de verdad hace falta filtrar en el servidor (ver ENTREGA).
 */

import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  FilterBar,
  KpiCard,
  PageHeader,
  Section,
  SegmentedControl,
  formatNumber,
  type DataTableColumn,
  type FilterDefinition,
  type FilterSelection,
} from '@boletera/ui';
import { ApiError, getStoredToken } from '@/lib/api';
import { getAuditLog } from '@/lib/platform-api';
import { useSession } from '@/components/Session/SessionProvider';
import { Notice } from '../orders/_ui/States';
import { formatDateTime } from '../orders/_ui/format';
import { actionLabel, actionTone, entityLabel } from './_lib/labels';
import styles from './audit.module.scss';

type AuditRow = {
  id: string;
  action: string;
  entityType: string;
  entityId: string;
  createdAt: string;
  userId?: string | null;
  metadata?: Record<string, unknown> | null;
};

/** Cuántas filas se traen por ventana. El API tope real es su propio `take`. */
const PAGE_SIZES = [80, 200, 500];

/**
 * Acciones destacadas. Las seis primeras son las que el API empezó a auditar
 * hace poco y son justo las que se buscan cuando algo salió mal con el dinero o
 * con un acceso; se listan explícitas para poder filtrarlas sin saber su nombre
 * exacto de memoria.
 */
const NOTABLE_ACTIONS: { value: string; label: string; severity: 'alert' | 'info' }[] = [
  { value: 'payment.settlement_mismatch', label: 'Descuadre de liquidación', severity: 'alert' },
  { value: 'payment.late_settlement', label: 'Liquidación tardía', severity: 'alert' },
  { value: 'order.settlement_failed', label: 'Liquidación fallida', severity: 'alert' },
  { value: 'order.insufficient_inventory', label: 'Inventario insuficiente', severity: 'alert' },
  { value: 'order.comp_issued', label: 'Cortesía emitida', severity: 'info' },
  { value: 'access.qr.reissued_by_staff', label: 'QR reemitido en puerta', severity: 'info' },
];

const NOTABLE_BY_VALUE = new Map(NOTABLE_ACTIONS.map((a) => [a.value, a]));

/** Rangos rápidos; el rango a medida siempre está disponible debajo. */
type QuickRange = 'all' | 'today' | '7d' | '30d';

const QUICK_RANGES: { value: QuickRange; label: string }[] = [
  { value: 'all', label: 'Todo' },
  { value: 'today', label: 'Hoy' },
  { value: '7d', label: '7 días' },
  { value: '30d', label: '30 días' },
];

const LIMIT_OPTIONS = PAGE_SIZES.map((n) => ({
  value: String(n),
  label: `Últimas ${n}`,
}));

function startOfQuickRange(range: QuickRange): Date | null {
  const now = new Date();
  switch (range) {
    case 'today':
      return new Date(now.getFullYear(), now.getMonth(), now.getDate());
    case '7d':
      return new Date(now.getTime() - 7 * 86_400_000);
    case '30d':
      return new Date(now.getTime() - 30 * 86_400_000);
    default:
      return null;
  }
}

/** El API no une con `User`: el correo solo aparece si la acción lo guardó. */
function actorOf(row: AuditRow): { label: string; hint: string } {
  const meta = row.metadata ?? {};
  const email =
    typeof meta.actorEmail === 'string'
      ? meta.actorEmail
      : typeof meta.email === 'string'
        ? meta.email
        : null;
  if (email) return { label: email, hint: row.userId ?? '' };
  if (row.userId) return { label: row.userId, hint: 'Solo ID: el API no devuelve el correo' };
  return { label: 'Sistema', hint: 'Acción sin usuario (proceso automático o webhook)' };
}

export default function AuditPage() {
  const { organizationId } = useSession();
  const [rows, setRows] = useState<AuditRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [limit, setLimit] = useState(PAGE_SIZES[0]);

  // Filtros
  const [actor, setActor] = useState('');
  const [action, setAction] = useState('');
  const [quick, setQuick] = useState<QuickRange>('all');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');

  const load = useCallback(async () => {
    const token = getStoredToken();
    if (!token || !organizationId) return;
    setLoading(true);
    setError(null);
    try {
      setRows(await getAuditLog(token, organizationId, limit));
    } catch (err) {
      // Un 401 ya lo reintentó `adminApi` tras reautenticar; si llega aquí es otra cosa.
      setError(err instanceof ApiError ? err.userMessage : 'No se pudo cargar la bitácora.');
      setRows([]);
    } finally {
      setLoading(false);
    }
  }, [organizationId, limit]);

  useEffect(() => {
    void load();
  }, [load]);

  /** Acciones presentes en los datos + las destacadas, para el desplegable. */
  const actionOptions = useMemo(() => {
    const present = new Set(rows.map((r) => r.action));
    NOTABLE_ACTIONS.forEach((a) => present.add(a.value));
    return [...present].sort();
  }, [rows]);

  const actionCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const row of rows) counts.set(row.action, (counts.get(row.action) ?? 0) + 1);
    return counts;
  }, [rows]);

  const actionFilterDefs = useMemo<FilterDefinition[]>(() => {
    const notableOptions = NOTABLE_ACTIONS.map((item) => ({
      value: item.value,
      label: item.label,
      count: actionCounts.get(item.value) ?? 0,
    }));
    const otherOptions = actionOptions
      .filter((value) => !NOTABLE_BY_VALUE.has(value))
      .map((value) => ({
        value,
        label: actionLabel(value),
        count: actionCounts.get(value) ?? 0,
      }));
    return [
      {
        id: 'action',
        label: 'Acción',
        multiple: false,
        options: [...notableOptions, ...otherOptions],
      },
    ];
  }, [actionCounts, actionOptions]);

  const filterSelection = useMemo<FilterSelection>(() => {
    const selection: Record<string, readonly string[]> = {};
    if (action) selection.action = [action];
    return selection;
  }, [action]);

  const filtered = useMemo(() => {
    const quickStart = startOfQuickRange(quick);
    const fromDate = from ? new Date(`${from}T00:00:00`) : quickStart;
    // El día "hasta" se incluye entero: quien escribe 16/08 espera ver el 16.
    const toDate = to ? new Date(`${to}T23:59:59.999`) : null;
    const needle = actor.trim().toLowerCase();

    return rows.filter((r) => {
      if (action && r.action !== action) return false;
      const when = new Date(r.createdAt);
      if (fromDate && when < fromDate) return false;
      if (toDate && when > toDate) return false;
      if (needle) {
        const { label } = actorOf(r);
        const haystack = `${label} ${r.userId ?? ''}`.toLowerCase();
        if (!haystack.includes(needle)) return false;
      }
      return true;
    });
  }, [rows, actor, action, quick, from, to]);

  const alerts = useMemo(
    () => filtered.filter((r) => NOTABLE_BY_VALUE.get(r.action)?.severity === 'alert').length,
    [filtered],
  );

  const distinctActions = useMemo(() => new Set(rows.map((r) => r.action)).size, [rows]);

  const anyFilter = Boolean(actor || action || from || to || quick !== 'all');

  function clearFilters() {
    setActor('');
    setAction('');
    setQuick('all');
    setFrom('');
    setTo('');
  }

  function onFilterChange(next: FilterSelection) {
    setAction(next.action?.[0] ?? '');
  }

  function onQuickRangeChange(value: QuickRange) {
    setQuick(value);
    setFrom('');
    setTo('');
  }

  const columns = useMemo<readonly DataTableColumn<AuditRow>[]>(
    () => [
      {
        key: 'createdAt',
        header: 'Fecha',
        width: 190,
        sortValue: (row) => row.createdAt,
        render: (row) => <span className={styles.when}>{formatDateTime(row.createdAt)}</span>,
      },
      {
        key: 'actor',
        header: 'Actor',
        width: 220,
        sortValue: (row) => actorOf(row).label,
        render: (row) => {
          const who = actorOf(row);
          return (
            <div>
              <span className={styles.actor}>{who.label}</span>
              {who.hint ? <span className={styles.actorHint}>{who.hint}</span> : null}
            </div>
          );
        },
      },
      {
        key: 'action',
        header: 'Acción',
        width: 260,
        sortValue: (row) => row.action,
        render: (row) => {
          const notable = NOTABLE_BY_VALUE.get(row.action);
          return (
            <div>
              {notable ? (
                <Badge
                  tone={notable.severity === 'alert' ? 'danger' : 'info'}
                  variant="soft"
                  size="sm"
                >
                  {notable.label}
                </Badge>
              ) : (
                <Badge tone={actionTone(row.action)} variant="soft" size="sm">
                  {actionLabel(row.action)}
                </Badge>
              )}
              <span className={styles.actionCode}>{row.action}</span>
            </div>
          );
        },
      },
      {
        key: 'entity',
        header: 'Entidad',
        width: 200,
        sortValue: (row) => row.entityType,
        render: (row) => (
          <div>
            <span className={styles.entity}>{entityLabel(row.entityType)}</span>
            {row.entityId ? (
              <code className={styles.entityId} title={row.entityId}>
                {row.entityId.slice(0, 12)}…
              </code>
            ) : null}
          </div>
        ),
      },
    ],
    [],
  );

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Compliance"
        title="Auditoría"
        description="Traza inmutable de acciones críticas — compliance y forensics"
        actions={
          <Button
            type="button"
            variant="outline"
            loading={loading}
            loadingLabel="Actualizando…"
            onClick={() => void load()}
          >
            Actualizar
          </Button>
        }
      />

      <Section columns={4} gap="md">
        <KpiCard label="Eventos traídos" value={formatNumber(rows.length)} tone="accent" />
        <KpiCard
          label="Coinciden filtro"
          value={formatNumber(filtered.length)}
          hint={anyFilter ? 'Sobre la ventana cargada' : 'Sin filtros activos'}
        />
        <KpiCard
          label="Requieren revisión"
          value={formatNumber(alerts)}
          tone={alerts > 0 ? 'warning' : 'neutral'}
          invertDelta
        />
        <KpiCard label="Acciones distintas" value={formatNumber(distinctActions)} />
      </Section>

      {alerts > 0 && (
        <Notice tone="danger" title={`${alerts} evento(s) de pago o inventario requieren revisión`}>
          <p>
            Descuadres de liquidación, inventario insuficiente y liquidaciones fallidas son lo primero
            que hay que mirar al abrir esta pantalla.
          </p>
        </Notice>
      )}

      <div className={styles.toolbar}>
        <FilterBar
          className={styles.filterBar}
          filters={actionFilterDefs}
          value={filterSelection}
          onChange={onFilterChange}
          search={{
            value: actor,
            onChange: setActor,
            placeholder: 'Actor: correo o ID de usuario…',
          }}
        >
          <SegmentedControl
            label="Rango rápido"
            size="sm"
            options={QUICK_RANGES}
            value={quick}
            onValueChange={onQuickRangeChange}
          />
          <SegmentedControl
            label="Filas a traer"
            size="sm"
            options={LIMIT_OPTIONS}
            value={String(limit)}
            onValueChange={(value) => setLimit(Number(value))}
          />
        </FilterBar>
        <div className={styles.filterMeta}>
          <span>
            {loading
              ? 'Cargando eventos…'
              : `${filtered.length} de ${rows.length} eventos traídos${
                  anyFilter ? ' coinciden con los filtros' : ''
                }.`}
          </span>
          {anyFilter ? (
            <button type="button" className={styles.clearBtn} onClick={clearFilters}>
              Limpiar filtros
            </button>
          ) : null}
        </div>
      </div>

      <div className={styles.dateRow}>
        <div className={styles.field}>
          <label htmlFor="audit-from">Desde</label>
          <input
            id="audit-from"
            type="date"
            value={from}
            max={to || undefined}
            onChange={(e) => {
              setFrom(e.target.value);
              setQuick('all');
            }}
          />
        </div>
        <div className={styles.field}>
          <label htmlFor="audit-to">Hasta</label>
          <input
            id="audit-to"
            type="date"
            value={to}
            min={from || undefined}
            onChange={(e) => {
              setTo(e.target.value);
              setQuick('all');
            }}
          />
        </div>
      </div>

      <DataTable
        label="Eventos de auditoría de la organización, del más reciente al más antiguo"
        columns={columns}
        data={filtered}
        rowKey={(row) => row.id}
        loading={loading}
        loadingRows={8}
        error={error}
        onRetry={() => void load()}
        defaultSort={{ key: 'createdAt', direction: 'desc' }}
        empty={
          <EmptyState
            title={
              rows.length === 0
                ? 'Sin eventos registrados'
                : 'Ningún evento coincide con los filtros'
            }
            description={
              rows.length === 0
                ? 'No hay eventos de auditoría para esta organización.'
                : 'Prueba a ampliar el rango, traer más filas o quitar algún filtro.'
            }
            action={
              anyFilter ? (
                <Button type="button" variant="outline" onClick={clearFilters}>
                  Limpiar filtros
                </Button>
              ) : undefined
            }
          />
        }
      />
    </div>
  );
}
