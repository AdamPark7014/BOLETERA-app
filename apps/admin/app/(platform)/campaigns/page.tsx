'use client';

/**
 * Campañas y presales.
 *
 * Antes cada acción (crear, publicar, exportar códigos) era un `await` sin
 * `catch`: si el API respondía 403 la pantalla se quedaba igual y el usuario
 * creía que había funcionado. Ahora cada acción confirma o explica, y la lista
 * distingue vacío de fallo de sin permiso.
 */

import { useCallback, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  FilterBar,
  KpiCard,
  PageHeader,
  Section,
  formatNumber,
  type DataTableColumn,
  type FilterDefinition,
  type FilterSelection,
} from '@boletera/ui';
import { ApiError, getStoredToken } from '@/lib/api';
import type { Campaign } from '@/lib/queries';
import {
  createCampaign,
  exportPresaleCodes,
  listCampaigns,
  listEvents,
  publishCampaignApi,
  type EventRow,
} from '@/lib/platform-api';
import { useToast } from '@/components/Toast/ToastProvider';
import { Notice, ResourceView } from '../orders/_ui/States';
import { useAdminSession, useResource } from '../orders/_ui/useResource';
import { CampaignComposer, type ComposerPayload } from './CampaignComposer';
import {
  buildCalendar,
  buildRecommendations,
  campaignStatusMeta,
  campaignTypeLabel,
  discountLabel,
  formatCount,
  formatDateShort,
  formatDateTime,
  formatPercentPoints,
  severityMeta,
  summarizeAllocation,
  summarizeRevenue,
  toCampaignView,
  type CampaignView,
  type RecommendationAction,
} from './model';
import styles from './campaigns.module.scss';

const STATUS_FILTERS = [
  { value: 'ALL', label: 'Todas' },
  { value: 'DRAFT', label: 'Borrador' },
  { value: 'ACTIVE', label: 'Activa' },
  { value: 'PAUSED', label: 'Pausada' },
  { value: 'ENDED', label: 'Finalizada' },
] as const;

type StatusFilter = (typeof STATUS_FILTERS)[number]['value'];

export default function CampaignsPage() {
  const session = useAdminSession();
  const toast = useToast();
  const [eventId, setEventId] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [composerOpen, setComposerOpen] = useState(false);
  const [createError, setCreateError] = useState<string | null>(null);
  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<StatusFilter>('ALL');
  const [selectedId, setSelectedId] = useState<string | null>(null);

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

  const selectedEvent = useMemo(
    () => (events.state.phase === 'ready' ? events.state.data.find((e) => e.id === eventId) : null),
    [events.state, eventId],
  );

  function fail(e: unknown, fallback: string) {
    toast.error(e instanceof ApiError ? e.userMessage : fallback);
  }

  async function handleCreate(payload: ComposerPayload) {
    const token = getStoredToken();
    if (!token || session.phase !== 'ready' || !eventId) {
      toast.error('Necesitas una organización y un evento seleccionado para crear la campaña.');
      return;
    }
    if (new Date(payload.endsAt) <= new Date(payload.startsAt)) {
      toast.error('La fecha de fin debe ser posterior a la de inicio.');
      return;
    }
    setBusy('create');
    setCreateError(null);
    try {
      await createCampaign(token, session.orgId, eventId, {
        ...payload,
        startsAt: new Date(payload.startsAt),
        endsAt: new Date(payload.endsAt),
      });
      toast.success(`Campaña "${payload.name}" creada en borrador`);
      setComposerOpen(false);
      campaigns.reload();
    } catch (e) {
      const message = e instanceof ApiError ? e.userMessage : 'No se pudo crear la campaña';
      setCreateError(message);
      fail(e, message);
    } finally {
      setBusy(null);
    }
  }

  async function publish(c: { id: string; name: string }) {
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

  async function exportCodes(c: { id: string; name: string }) {
    const token = getStoredToken();
    if (!token) return;
    setBusy(c.id);
    try {
      const csv = await exportPresaleCodes(token, c.id);
      const blob = new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8' });
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

  function handleRecommendationAction(action: RecommendationAction) {
    if (action.kind === 'publish') {
      const campaign = campaigns.state.phase === 'ready'
        ? campaigns.state.data.find((item) => item.id === action.campaignId)
        : null;
      if (campaign) void publish(campaign);
      return;
    }
    if (action.kind === 'export') {
      const campaign = campaigns.state.phase === 'ready'
        ? campaigns.state.data.find((item) => item.id === action.campaignId)
        : null;
      if (campaign) void exportCodes(campaign);
      return;
    }
    setComposerOpen(true);
  }

  return (
    <div className={styles.wrap}>
      <PageHeader
        eyebrow="Promoción"
        title="Campañas y presales"
        description="Presale, early bird, VIP — cupos, descuentos y códigos por evento"
        actions={
          <div className={styles.headerControls}>
            <ResourceView resource={events} context="los eventos" loadingRows={1}>
              {(list) =>
                list.length === 0 ? null : (
                  <>
                    <label htmlFor="campaign-event" className={styles.srOnly}>
                      Evento
                    </label>
                    <select
                      id="campaign-event"
                      className={styles.eventSelect}
                      value={eventId}
                      onChange={(e) => {
                        setEventId(e.target.value);
                        setSelectedId(null);
                      }}
                    >
                      {list.map((ev) => (
                        <option key={ev.id} value={ev.id}>
                          {ev.title}
                        </option>
                      ))}
                    </select>
                  </>
                )
              }
            </ResourceView>
            <Button
              type="button"
              disabled={!eventId || busy !== null}
              onClick={() => {
                setCreateError(null);
                setComposerOpen(true);
              }}
            >
              Nueva campaña
            </Button>
          </div>
        }
      />

      <ResourceView resource={events} context="los eventos" loadingRows={1}>
        {(list) =>
          list.length === 0 ? (
            <EmptyState
              title="No hay eventos en tu organización"
              description="Crea un evento antes de configurar campañas."
            />
          ) : (
            <ResourceView resource={campaigns} context="las campañas" loadingRows={3}>
              {(list) => (
                <CampaignsDashboard
                  campaigns={list}
                  eventTitle={selectedEvent?.title ?? 'el evento'}
                  busy={busy}
                  search={search}
                  statusFilter={statusFilter}
                  selectedId={selectedId}
                  onSearchChange={setSearch}
                  onStatusFilterChange={setStatusFilter}
                  onSelect={setSelectedId}
                  onPublish={publish}
                  onExport={exportCodes}
                  onRecommendationAction={handleRecommendationAction}
                />
              )}
            </ResourceView>
          )
        }
      </ResourceView>

      <CampaignComposer
        open={composerOpen}
        eventTitle={selectedEvent?.title ?? 'el evento'}
        submitting={busy === 'create'}
        error={createError}
        onClose={() => {
          if (busy === 'create') return;
          setComposerOpen(false);
          setCreateError(null);
        }}
        onSubmit={(payload) => void handleCreate(payload)}
      />
    </div>
  );
}

type DashboardProps = {
  campaigns: Campaign[];
  eventTitle: string;
  busy: string | null;
  search: string;
  statusFilter: StatusFilter;
  selectedId: string | null;
  onSearchChange: (value: string) => void;
  onStatusFilterChange: (value: StatusFilter) => void;
  onSelect: (id: string | null) => void;
  onPublish: (campaign: { id: string; name: string }) => void;
  onExport: (campaign: { id: string; name: string }) => void;
  onRecommendationAction: (action: RecommendationAction) => void;
};

function CampaignsDashboard({
  campaigns,
  eventTitle,
  busy,
  search,
  statusFilter,
  selectedId,
  onSearchChange,
  onStatusFilterChange,
  onSelect,
  onPublish,
  onExport,
  onRecommendationAction,
}: DashboardProps) {
  const views = useMemo(() => campaigns.map((item) => toCampaignView(item)), [campaigns]);
  const summary = useMemo(() => summarizeAllocation(views), [views]);
  const revenue = useMemo(() => summarizeRevenue([]), []);
  const recommendations = useMemo(
    () => buildRecommendations(views, [], revenue),
    [views, revenue],
  );
  const calendar = useMemo(() => buildCalendar(views), [views]);

  const statusCounts = useMemo(() => {
    const counts = new Map<string, number>();
    for (const view of views) counts.set(view.status, (counts.get(view.status) ?? 0) + 1);
    return counts;
  }, [views]);

  const filterDefs = useMemo<FilterDefinition[]>(
    () => [
      {
        id: 'status',
        label: 'Estado',
        multiple: false,
        options: STATUS_FILTERS.filter((item) => item.value !== 'ALL').map((item) => ({
          value: item.value,
          label: item.label,
          count: statusCounts.get(item.value) ?? 0,
        })),
      },
    ],
    [statusCounts],
  );

  const filterSelection = useMemo<FilterSelection>(() => {
    const selection: Record<string, readonly string[]> = {};
    if (statusFilter !== 'ALL') selection.status = [statusFilter];
    return selection;
  }, [statusFilter]);

  const needle = search.trim().toLowerCase();
  const filtered = useMemo(() => {
    return views.filter((view) => {
      if (statusFilter !== 'ALL' && view.status !== statusFilter) return false;
      if (!needle) return true;
      return (
        view.name.toLowerCase().includes(needle) ||
        view.type.toLowerCase().includes(needle) ||
        campaignTypeLabel(view.type).toLowerCase().includes(needle)
      );
    });
  }, [views, statusFilter, needle]);

  const selected = useMemo(
    () => views.find((view) => view.id === selectedId) ?? filtered[0] ?? null,
    [views, selectedId, filtered],
  );

  const columns = useMemo<readonly DataTableColumn<CampaignView>[]>(
    () => [
      {
        key: 'name',
        header: 'Campaña',
        sortValue: (row) => row.name,
        render: (row) => (
          <div className={styles.rowTitle}>
            <strong>{row.name}</strong>
            <span>{campaignTypeLabel(row.type)}</span>
          </div>
        ),
      },
      {
        key: 'status',
        header: 'Estado',
        width: 130,
        sortValue: (row) => row.status,
        render: (row) => {
          const meta = campaignStatusMeta(row.status);
          return (
            <Badge tone={meta.tone} variant="soft" size="sm">
              {meta.label}
            </Badge>
          );
        },
      },
      {
        key: 'allocation',
        header: 'Cupo',
        width: 100,
        align: 'right',
        sortValue: (row) => row.allocation,
        render: (row) => formatCount(row.allocation),
      },
      {
        key: 'redeemed',
        header: 'Canjeado',
        width: 140,
        align: 'right',
        sortValue: (row) => row.redeemed,
        render: (row) => (
          <div className={styles.progressCell}>
            <span>{formatCount(row.redeemed)}</span>
            <div className={styles.track} aria-hidden>
              <div
                className={styles.fill}
                style={{ width: `${Math.min(100, row.redemptionRate)}%` }}
              />
            </div>
            <span className={styles.progressMeta}>{formatPercentPoints(row.redemptionRate)}</span>
          </div>
        ),
      },
      {
        key: 'discount',
        header: 'Descuento',
        width: 110,
        align: 'right',
        sortValue: (row) => row.discountValue,
        render: (row) => discountLabel(row),
      },
      {
        key: 'window',
        header: 'Ventana',
        width: 180,
        sortValue: (row) => row.startsAt ?? '',
        render: (row) => (
          <span className={styles.rowTitle}>
            <strong>{formatDateShort(row.startsAt)}</strong>
            <span>hasta {formatDateShort(row.endsAt)}</span>
          </span>
        ),
      },
      {
        key: 'actions',
        header: 'Acciones',
        width: 220,
        render: (row) => (
          <div className={styles.actions}>
            {row.status === 'DRAFT' ? (
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={busy !== null}
                loading={busy === row.id}
                loadingLabel="Guardando…"
                onClick={() => onPublish(row)}
              >
                Publicar
              </Button>
            ) : null}
            {row.type === 'presale' ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                disabled={busy !== null}
                loading={busy === row.id}
                loadingLabel="Exportando…"
                onClick={() => onExport(row)}
              >
                Exportar códigos
              </Button>
            ) : null}
          </div>
        ),
      },
    ],
    [busy, onExport, onPublish],
  );

  const anyFilter = statusFilter !== 'ALL' || Boolean(needle);

  function clearFilters() {
    onSearchChange('');
    onStatusFilterChange('ALL');
  }

  if (views.length === 0) {
    return (
      <EmptyState
        title="Sin campañas para este evento"
        description="Crea una campaña de preventa o descuento; queda en borrador hasta que la publiques."
        action={
          <Button type="button" onClick={() => onRecommendationAction({ kind: 'compose', label: '' })}>
            Crear primera campaña
          </Button>
        }
      />
    );
  }

  return (
    <>
      <Section columns={3} gap="md" className={styles.kpiGrid}>
        <KpiCard label="Cupo total" value={formatNumber(summary.allocation)} tone="accent" />
        <KpiCard label="Redimido" value={formatNumber(summary.redeemed)} tone="success" />
        <KpiCard
          label="Disponible"
          value={formatNumber(summary.remaining)}
          hint={`${formatPercentPoints(summary.redemptionRate)} del cupo`}
        />
        <KpiCard label="Activas" value={formatNumber(summary.activeCount)} />
        <KpiCard
          label="En borrador"
          value={formatNumber(summary.draftCount)}
          tone={summary.draftCount > 0 ? 'warning' : 'neutral'}
        />
        <KpiCard label="Códigos emitidos" value={formatNumber(summary.codesIssued)} />
      </Section>

      <Notice tone="info" title="Dónde viven estas campañas">
        <p>
          Se guardan dentro de los metadatos del evento <strong>{eventTitle}</strong>, no en una tabla
          propia: no hay historial ni bitácora por campaña, y borrar el evento se las lleva.
        </p>
      </Notice>

      <div className={styles.panel}>
        <FilterBar
          filters={filterDefs}
          value={filterSelection}
          onChange={(next) => onStatusFilterChange((next.status?.[0] as StatusFilter) ?? 'ALL')}
          search={{
            value: search,
            onChange: onSearchChange,
            placeholder: 'Buscar por nombre o tipo…',
          }}
        />
        <div className={styles.panelHead}>
          <div>
            <h2>Campañas del evento</h2>
            <p>
              {filtered.length} de {views.length} campañas
              {anyFilter ? ' coinciden con los filtros' : ''}.
            </p>
          </div>
          {anyFilter ? (
            <Button type="button" variant="ghost" size="sm" onClick={clearFilters}>
              Limpiar filtros
            </Button>
          ) : null}
        </div>

        <DataTable
          label="Campañas con tipo, estado, cupo, canje y descuento"
          columns={columns}
          data={filtered}
          rowKey={(row) => row.id}
          onRowClick={(row) => onSelect(row.id)}
          selectedKeys={selected ? [selected.id] : []}
          defaultSort={{ key: 'name', direction: 'asc' }}
          empty={
            <EmptyState
              title="Ninguna campaña coincide con los filtros"
              description="Prueba otro término o quita el filtro de estado."
              action={
                <Button type="button" variant="outline" onClick={clearFilters}>
                  Limpiar filtros
                </Button>
              }
            />
          }
        />
      </div>

      <div className={styles.twoCol}>
        <section className={styles.panel}>
          <div className={styles.panelHead}>
            <div>
              <h2>Calendario de ventanas</h2>
              <p>Vigencia de cada campaña sobre la línea de tiempo del evento.</p>
            </div>
          </div>
          {calendar ? (
            <div className={styles.calendar}>
              <div className={styles.calendarAxis} aria-hidden>
                {calendar.ticks.map((tick) => (
                  <span
                    key={tick.iso}
                    className={styles.calendarTick}
                    style={{ left: `${tick.percent}%` }}
                  >
                    {formatDateShort(tick.iso)}
                  </span>
                ))}
                {calendar.todayPercent != null ? (
                  <span
                    className={styles.calendarToday}
                    style={{ left: `${calendar.todayPercent}%` }}
                  />
                ) : null}
              </div>
              <div className={styles.calendarRows}>
                {calendar.bars.map((bar) => (
                  <div key={bar.id} className={styles.calendarRow}>
                    <div className={styles.calendarLabel}>
                      <strong>{bar.name}</strong>
                      <span>
                        {formatDateShort(bar.startsAt)} – {formatDateShort(bar.endsAt)}
                      </span>
                    </div>
                    <div className={styles.calendarTrack}>
                      <div
                        className={[
                          styles.calendarBar,
                          bar.live
                            ? styles.calendarBarActive
                            : bar.status === 'DRAFT'
                              ? styles.calendarBarDraft
                              : bar.status === 'PAUSED'
                                ? styles.calendarBarPaused
                                : styles.calendarBarEnded,
                        ].join(' ')}
                        style={{
                          left: `${bar.offsetPercent}%`,
                          width: `${bar.widthPercent}%`,
                        }}
                        title={`${bar.name}: ${formatDateTime(bar.startsAt)} – ${formatDateTime(bar.endsAt)}`}
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          ) : (
            <p className={styles.callout}>
              Las campañas actuales no tienen fechas de inicio y fin configuradas para dibujar el
              calendario.
            </p>
          )}
        </section>

        <section className={styles.panel}>
          <div className={styles.panelHead}>
            <div>
              <h2>Recomendaciones</h2>
              <p>Acciones sugeridas según cupo, borradores y ventanas.</p>
            </div>
          </div>
          {recommendations.length === 0 ? (
            <p className={styles.callout}>No hay recomendaciones pendientes para este evento.</p>
          ) : (
            <ul className={styles.recoList}>
              {recommendations.slice(0, 5).map((item) => {
                const meta = severityMeta(item.severity);
                return (
                  <li key={item.id} className={styles.recoItem}>
                    <div className={styles.recoTop}>
                      <span className={styles.recoTitle}>{item.title}</span>
                      <Badge tone={meta.tone} variant="soft" size="sm">
                        {meta.label}
                      </Badge>
                    </div>
                    <p className={styles.recoBody}>{item.explanation}</p>
                    <p className={styles.recoAction}>{item.suggestion}</p>
                    {item.action ? (
                      <Button
                        type="button"
                        variant="outline"
                        size="sm"
                        onClick={() => onRecommendationAction(item.action!)}
                      >
                        {item.action.label}
                      </Button>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
        </section>
      </div>

      {selected ? (
        <section
          className={[styles.panel, styles.detailCard, styles.detailCardSelected].join(' ')}
          aria-label="Detalle de campaña seleccionada"
        >
          <div className={styles.detailHead}>
            <div>
              <h2>{selected.name}</h2>
              <p>{campaignTypeLabel(selected.type)}</p>
            </div>
            <Badge tone={campaignStatusMeta(selected.status).tone} variant="soft">
              {campaignStatusMeta(selected.status).label}
            </Badge>
          </div>
          <dl className={styles.detailDl}>
            <dt>Cupo</dt>
            <dd>{formatCount(selected.allocation)}</dd>
            <dt>Redimido</dt>
            <dd>
              {formatCount(selected.redeemed)} ({formatPercentPoints(selected.redemptionRate)})
            </dd>
            <dt>Descuento</dt>
            <dd>{discountLabel(selected)}</dd>
            <dt>Por usuario</dt>
            <dd>{selected.quantityPerUser != null ? formatCount(selected.quantityPerUser) : '—'}</dd>
            <dt>Abre</dt>
            <dd>{formatDateTime(selected.startsAt)}</dd>
            <dt>Cierra</dt>
            <dd>{formatDateTime(selected.endsAt)}</dd>
            <dt>Códigos</dt>
            <dd>{formatCount(selected.codes.length)}</dd>
          </dl>
        </section>
      ) : null}
    </>
  );
}
