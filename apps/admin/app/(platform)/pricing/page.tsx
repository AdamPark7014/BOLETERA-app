'use client';

/**
 * Precios dinámicos por evento: recomendaciones por oferta, cola de aprobación
 * humana y señales del motor.
 *
 * Conserva todas las llamadas y acciones de la consola anterior: previsualizar,
 * generar y aplicar seguros, aplicar selección (con o sin aprobación), aprobar o
 * rechazar con nota, e historial por oferta. Si el API responde 404 en
 * recomendaciones o en la cola, se muestra tal cual, sin inventar paquetes.
 */

import Link from 'next/link';
import { Suspense, useEffect, useMemo, useState } from 'react';
import {
  Field,
  ParameterCard,
  TicketButton,
  formatCurrency,
  formatDateTime,
  formatDelta,
  formatNumber,
  formatPercent,
} from '@boletera/ui';
import { HttpError, PermissionError } from '@/lib/http';
import { useEvents } from '@/lib/queries';
import { useSession as useAppSession } from '@/lib/use-session';
import { AnonymousView, NoOrgView, useSession } from '../events/_shared/api-state';
import { AdminFrame } from '../events/_ticket/AdminFrame';
import { Param, Segment, SheetSelect, Switch } from '../events/_ticket/controls';
import styles from '../events/_ticket/frame.module.scss';
import {
  PAGE_SIZES,
  buildPendingRows,
  filterPendingRows,
  filterRecommendations,
  generatedAgeLabel,
  isActionable,
  paginate,
  summarizeRecommendations,
  type PageSize,
  type PendingRow,
} from './_lib/derive';
import {
  confidenceLabel,
  describeHistoryReason,
  directionLabel,
  factorLabel,
  shortId,
} from './_lib/labels';
import {
  useApplyRecommendations,
  useOfferPriceHistory,
  usePendingRecommendations,
  usePreviewRecommendations,
  useRecommendationBundle,
  useRevenueEstimate,
  useReviewRecommendation,
  useUpdateDynamicPrices,
} from './_lib/queries';
import type {
  OfferRecommendation,
  PriceHistoryEntry,
  PricingDirection,
  RecommendationBundle,
  RevenueEstimate,
} from './_lib/types';
import { toAmount } from './_lib/types';
import { usePricingUrlState, type PricingView } from './_lib/use-pricing-url-state';
import local from './pricing.module.scss';

const VIEW_OPTIONS: { value: PricingView; label: string }[] = [
  { value: 'recomendaciones', label: 'Recomendaciones' },
  { value: 'aprobaciones', label: 'Aprobaciones' },
  { value: 'senales', label: 'Señales' },
];

type DirectionChoice = 'todas' | PricingDirection;

const DIRECTION_OPTIONS: { value: DirectionChoice; label: string }[] = [
  { value: 'todas', label: 'Todas' },
  { value: 'increase', label: 'Subir' },
  { value: 'decrease', label: 'Bajar' },
  { value: 'hold', label: 'Mantener' },
];

function errorText(error: unknown): string {
  if (error instanceof HttpError) {
    return error.status ? `Error ${error.status} · ${error.message}` : error.message;
  }
  if (error instanceof Error) return error.message;
  return 'Sin respuesta.';
}

function failText(error: unknown, fallback: string): string {
  return error instanceof Error ? error.message : fallback;
}

export default function PricingPage() {
  return (
    <Suspense fallback={null}>
      <AdminFrame>
        <PreciosGate />
      </AdminFrame>
    </Suspense>
  );
}

function PreciosGate() {
  const session = useSession();
  if (session.status === 'anonymous') return <AnonymousView />;
  if (session.status === 'no-org') return <NoOrgView />;
  if (session.status === 'loading') return <p className={styles.quiet}>Cargando precios.</p>;
  return <PreciosBody />;
}

function PreciosBody() {
  const { can } = useAppSession();
  const canWrite = can('price:write');
  const url = usePricingUrlState();
  const eventsQ = useEvents();

  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [now] = useState(() => Date.now());
  const [previewMode, setPreviewMode] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [actionError, setActionError] = useState<string | null>(null);

  // Primer evento disponible si la URL no trae uno.
  useEffect(() => {
    if (url.eventId || !eventsQ.data?.length) return;
    url.setEventId(eventsQ.data[0].id);
  }, [eventsQ.data, url.eventId, url.setEventId]);

  const eventExists = Boolean(
    url.eventId && eventsQ.data?.some((event) => event.id === url.eventId)
  );
  const activeEventId = eventExists ? url.eventId : '';

  const bundleQ = useRecommendationBundle(activeEventId);
  const pendingQ = usePendingRecommendations(activeEventId);
  const revenueQ = useRevenueEstimate(activeEventId);
  const applyMutation = useApplyRecommendations(activeEventId);
  const reviewMutation = useReviewRecommendation(activeEventId);
  const previewMutation = usePreviewRecommendations(activeEventId);
  const updateMutation = useUpdateDynamicPrices(activeEventId);

  const recommendations = useMemo(() => bundleQ.data?.recommendations ?? [], [bundleQ.data]);
  const openRecommendation = useMemo(
    () =>
      url.offerId ? (recommendations.find((item) => item.offerId === url.offerId) ?? null) : null,
    [recommendations, url.offerId]
  );
  const historyQ = useOfferPriceHistory(openRecommendation?.offerId ?? null);

  const summary = useMemo(() => summarizeRecommendations(recommendations), [recommendations]);
  const filtered = useMemo(
    () =>
      filterRecommendations(recommendations, {
        query: url.query,
        directions: url.directions,
        approvalOnly: url.approvalOnly,
        clampedOnly: url.clampedOnly,
      }),
    [recommendations, url.approvalOnly, url.clampedOnly, url.directions, url.query]
  );
  const page = useMemo(
    () => paginate(filtered, url.page, url.pageSize),
    [filtered, url.page, url.pageSize]
  );

  // Si los filtros dejan la página fuera de rango, corrige la URL.
  useEffect(() => {
    if (page.page !== url.page) url.setPage(page.page);
  }, [page.page, url.page, url.setPage]);

  const pendingRows = useMemo(
    () => buildPendingRows(pendingQ.data ?? [], recommendations, now),
    [now, pendingQ.data, recommendations]
  );
  const filteredPending = useMemo(
    () => filterPendingRows(pendingRows, url.query),
    [pendingRows, url.query]
  );

  const selectedEvent = eventsQ.data?.find((event) => event.id === activeEventId);
  const forbidden =
    bundleQ.error instanceof PermissionError || pendingQ.error instanceof PermissionError;

  function setMarks(next: { approval?: boolean; clamped?: boolean }) {
    const approval = next.approval ?? url.approvalOnly;
    const clamped = next.clamped ?? url.clampedOnly;
    const marks = [approval ? 'aprobacion' : null, clamped ? 'banda' : null].filter(
      (mark): mark is string => mark != null
    );
    url.setFilterSelection({ direccion: url.directions, marca: marks });
  }

  function setDirection(choice: DirectionChoice) {
    url.setFilterSelection({
      direccion: choice === 'todas' ? [] : [choice],
      marca: [url.approvalOnly ? 'aprobacion' : null, url.clampedOnly ? 'banda' : null].filter(
        (mark): mark is string => mark != null
      ),
    });
  }

  async function refreshAll() {
    setActionError(null);
    await Promise.all([
      eventsQ.refetch(),
      bundleQ.refetch(),
      pendingQ.refetch(),
      revenueQ.refetch(),
    ]);
    setPreviewMode(false);
  }

  async function onPreview() {
    if (!activeEventId) return;
    setActionError(null);
    try {
      await previewMutation.mutateAsync();
      setPreviewMode(true);
      url.setView('recomendaciones');
      setNotice('Vista previa generada. No se escribió ningún precio.');
    } catch (error) {
      setActionError(failText(error, 'No se pudo previsualizar.'));
    }
  }

  async function onGenerate() {
    if (!activeEventId) return;
    setActionError(null);
    try {
      const result = await updateMutation.mutateAsync();
      setPreviewMode(false);
      setSelectedKeys([]);
      setNotice(
        result.message ||
          `Aplicadas ${result.applied} · pendientes ${result.pendingApproval} · retenidas ${result.held}`
      );
      if (result.pendingApproval > 0) url.setView('aprobaciones');
    } catch (error) {
      setActionError(failText(error, 'No se pudo generar.'));
    }
  }

  async function applyOffers(offerIds: readonly string[], confirmApproval: boolean) {
    if (!activeEventId || offerIds.length === 0) return;
    setActionError(null);
    try {
      const result = await applyMutation.mutateAsync({ offerIds, confirmApproval });
      setSelectedKeys([]);
      setPreviewMode(false);
      const parts = [
        result.applied.length ? `${result.applied.length} aplicadas` : null,
        result.pendingCreated.length ? `${result.pendingCreated.length} encoladas` : null,
        result.skipped.length ? `${result.skipped.length} omitidas` : null,
      ].filter(Boolean);
      setNotice(parts.join(' · ') || 'Sin cambios.');
    } catch (error) {
      setActionError(failText(error, 'No se pudo aplicar.'));
    }
  }

  async function review(recommendationId: string, decision: 'approve' | 'reject', note: string) {
    setActionError(null);
    try {
      await reviewMutation.mutateAsync({ recommendationId, decision, note });
      setNotice(decision === 'approve' ? 'Recomendación aprobada.' : 'Recomendación rechazada.');
    } catch (error) {
      setActionError(failText(error, 'No se pudo revisar.'));
    }
  }

  const head = (
    <header className={styles.sectionHead}>
      <h1 className={styles.sectionTitle}>Precios</h1>
      <p className={styles.quiet}>
        Recomendaciones por oferta, cola de aprobación y señales del motor. Se calcula por evento.
      </p>
    </header>
  );

  if (eventsQ.error) {
    return (
      <section>
        {head}
        <div className={styles.stack}>
          <p className={styles.danger} role="alert">
            No se pudo cargar el catálogo de eventos. {errorText(eventsQ.error)}
          </p>
          <div>
            <TicketButton variant="secondary" onClick={() => void eventsQ.refetch()}>
              Reintentar
            </TicketButton>
          </div>
        </div>
      </section>
    );
  }
  if (eventsQ.isPending) {
    return (
      <section>
        {head}
        <p className={styles.quiet}>Cargando eventos.</p>
      </section>
    );
  }
  if (!eventsQ.data?.length) {
    return (
      <section>
        {head}
        <div className={styles.stack}>
          <p className={styles.quiet}>Sin eventos. Crea o publica uno para evaluar precios.</p>
          <Link href="/events/new" className={local.link}>
            Crear evento
          </Link>
        </div>
      </section>
    );
  }

  const busy = previewMutation.isPending || updateMutation.isPending;
  const refreshing = bundleQ.isFetching || pendingQ.isFetching || revenueQ.isFetching;

  return (
    <section>
      {head}

      <div className={styles.stack}>
        <div className={local.eventPick}>
          <SheetSelect
            label="Evento"
            value={activeEventId}
            placeholder="Elige un evento"
            options={eventsQ.data.map((event) => ({ value: event.id, label: event.title }))}
            onChange={(value) => {
              setSelectedKeys([]);
              setPreviewMode(false);
              setNotice(null);
              url.setEventId(value);
            }}
          />
        </div>
        {activeEventId ? (
          <Link href={`/events/${activeEventId}`} className={local.link}>
            Abrir la ficha del evento
          </Link>
        ) : null}
        <div className={local.toolbar}>
          <TicketButton
            variant="secondary"
            disabled={!activeEventId || busy}
            onClick={() => void onPreview()}
          >
            {previewMutation.isPending ? 'Previsualizando' : 'Previsualizar'}
          </TicketButton>
          {canWrite ? (
            <TicketButton disabled={!activeEventId || busy} onClick={() => void onGenerate()}>
              {updateMutation.isPending ? 'Generando' : 'Generar y aplicar seguros'}
            </TicketButton>
          ) : null}
          <TicketButton
            variant="ghost"
            disabled={!activeEventId || refreshing}
            onClick={() => void refreshAll()}
          >
            {refreshing ? 'Actualizando' : 'Actualizar'}
          </TicketButton>
        </div>
        {!canWrite ? (
          <p className={styles.tertiary}>
            Tu rol consulta. Aplicar y revisar la cola pide el permiso price:write.
          </p>
        ) : null}
        {previewMode && bundleQ.data ? (
          <div className={local.toolbar}>
            <p className={styles.quiet} role="status">
              Vista previa sin guardar · {generatedAgeLabel(bundleQ.data, now)}
            </p>
            {canWrite ? (
              <TicketButton variant="secondary" disabled={busy} onClick={() => void onGenerate()}>
                Confirmar generación
              </TicketButton>
            ) : null}
          </div>
        ) : null}
        {actionError ? (
          <p className={styles.danger} role="alert">
            {actionError}
          </p>
        ) : null}
        {notice ? (
          <p className={styles.quiet} aria-live="polite">
            {notice}
          </p>
        ) : null}
      </div>

      {!activeEventId ? (
        <p className={`${styles.quiet} ${local.block}`}>Elige un evento.</p>
      ) : forbidden ? (
        <p className={`${styles.danger} ${local.block}`} role="alert">
          Tu rol no tiene acceso a los precios de este evento. Pide a un administrador el permiso de
          lectura de precios.
        </p>
      ) : (
        <>
          <ul className={`${styles.rows} ${local.block}`} aria-label="Resumen de precios">
            <li className={styles.row}>
              <div className={styles.rowMain}>
                <p className={styles.rowTitle}>Ofertas evaluadas</p>
                <p className={styles.rowMeta}>
                  {selectedEvent?.title ?? bundleQ.data?.title ?? 'Evento elegido'}
                </p>
              </div>
              <span />
              <p className={styles.figure}>{bundleQ.data ? formatNumber(summary.total) : '—'}</p>
            </li>
            <li className={styles.row}>
              <div className={styles.rowMain}>
                <p className={styles.rowTitle}>Pendientes de aprobación</p>
                <p className={styles.rowMeta}>
                  {pendingRows.some((row) => row.expired)
                    ? 'Hay recomendaciones vencidas (más de 24 h)'
                    : 'Cola humana'}
                </p>
              </div>
              <span />
              <p className={styles.figure}>
                {pendingQ.data ? formatNumber(pendingRows.length) : '—'}
              </p>
            </li>
            <li className={styles.row}>
              <div className={styles.rowMain}>
                <p className={styles.rowTitle}>Aplicables sin firma</p>
                <p className={styles.rowMeta}>
                  {formatNumber(summary.requiresApproval)} piden firma
                </p>
              </div>
              <span />
              <p className={styles.figure}>
                {bundleQ.data ? formatNumber(summary.autoApplicable) : '—'}
              </p>
            </li>
            <li className={styles.row}>
              <div className={styles.rowMain}>
                <p className={styles.rowTitle}>Ocupación</p>
                <p className={styles.rowMeta}>
                  {bundleQ.data
                    ? `${formatNumber(bundleQ.data.signals.soldTickets)} / ${formatNumber(bundleQ.data.signals.totalCapacity)} boletos`
                    : 'Señales del motor'}
                </p>
              </div>
              <span />
              <p className={styles.figure}>
                {bundleQ.data ? formatPercent(bundleQ.data.signals.occupancyPercent / 100) : '—'}
              </p>
            </li>
          </ul>
          {bundleQ.data ? (
            <p className={styles.tertiary}>
              {bundleQ.data.summary} · {generatedAgeLabel(bundleQ.data, now)} · dinámico{' '}
              {bundleQ.data.enableDynamic ? 'encendido' : 'apagado'}
            </p>
          ) : null}

          <div className={`${styles.stack} ${local.block}`}>
            <Segment
              label="Vista de precios"
              value={url.view}
              options={VIEW_OPTIONS}
              onChange={url.setView}
            />
            {url.view !== 'senales' ? (
              <Field
                label="Buscar"
                kind="search"
                value={url.query}
                placeholder={
                  url.view === 'aprobaciones' ? 'Oferta o id de recomendación' : 'Oferta, zona o id'
                }
                onChange={(event) => url.setQuery(event.target.value)}
              />
            ) : null}
          </div>

          {url.view === 'recomendaciones' ? (
            <div className={local.block}>
              {bundleQ.error ? (
                <BundleUnavailable error={bundleQ.error} onRetry={() => void bundleQ.refetch()} />
              ) : bundleQ.isPending ? (
                <p className={styles.quiet}>Cargando recomendaciones.</p>
              ) : (
                <div className={styles.stack}>
                  <Segment
                    label="Dirección"
                    value={url.directions.length === 1 ? url.directions[0] : 'todas'}
                    options={DIRECTION_OPTIONS}
                    onChange={setDirection}
                  />
                  <div className={local.toolbar}>
                    <Switch
                      label="Solo las que piden aprobación"
                      on={url.approvalOnly}
                      onChange={(on) => setMarks({ approval: on })}
                    />
                    <p className={styles.quiet}>
                      Solo con aprobación · {formatNumber(summary.requiresApproval)}
                    </p>
                    <Switch
                      label="Solo acotadas por banda"
                      on={url.clampedOnly}
                      onChange={(on) => setMarks({ clamped: on })}
                    />
                    <p className={styles.quiet}>
                      Solo acotadas por banda · {formatNumber(summary.clamped)}
                    </p>
                  </div>
                  <p className={styles.tertiary}>
                    {formatNumber(summary.increases)} alzas · {formatNumber(summary.decreases)}{' '}
                    bajas · {formatNumber(summary.holds)} sin cambio
                  </p>
                  {bundleQ.data?.enableDynamic === false ? (
                    <p className={styles.quiet}>
                      El evento tiene el precio dinámico apagado: nada se aplica solo, cada cambio
                      pide aprobación. Se enciende en la ficha del evento.
                    </p>
                  ) : null}

                  {selectedKeys.length > 0 ? (
                    <div className={local.toolbar} role="status">
                      <p className={styles.quiet}>
                        {formatNumber(selectedKeys.length)} seleccionada
                        {selectedKeys.length === 1 ? '' : 's'}
                      </p>
                      <TicketButton
                        variant="secondary"
                        disabled={!canWrite || applyMutation.isPending}
                        onClick={() => void applyOffers(selectedKeys, false)}
                      >
                        Aplicar seguras
                      </TicketButton>
                      <TicketButton
                        variant="secondary"
                        disabled={!canWrite || applyMutation.isPending}
                        onClick={() => void applyOffers(selectedKeys, true)}
                      >
                        Aplicar con aprobación
                      </TicketButton>
                      <TicketButton
                        variant="ghost"
                        disabled={applyMutation.isPending}
                        onClick={() => setSelectedKeys([])}
                      >
                        Limpiar
                      </TicketButton>
                    </div>
                  ) : null}

                  {recommendations.length === 0 ? (
                    <p className={styles.quiet}>El motor no evaluó ofertas para este evento.</p>
                  ) : filtered.length === 0 ? (
                    <div className={styles.stack}>
                      <p className={styles.quiet}>Ninguna oferta con ese criterio.</p>
                      <div>
                        <TicketButton variant="ghost" onClick={url.clearFilters}>
                          Limpiar filtros
                        </TicketButton>
                      </div>
                    </div>
                  ) : (
                    <>
                      {page.rows.map((item) => (
                        <RecommendationItem
                          key={item.offerId}
                          item={item}
                          open={url.offerId === item.offerId}
                          canWrite={canWrite}
                          applying={applyMutation.isPending}
                          selected={selectedKeys.includes(item.offerId)}
                          history={historyQ.data ?? []}
                          historyPending={historyQ.isPending}
                          historyError={historyQ.error}
                          onToggle={() =>
                            url.setOfferId(url.offerId === item.offerId ? null : item.offerId)
                          }
                          onSelect={(on) =>
                            setSelectedKeys((current) =>
                              on
                                ? [...current, item.offerId]
                                : current.filter((key) => key !== item.offerId)
                            )
                          }
                          onApply={() => void applyOffers([item.offerId], false)}
                          onRetryHistory={() => void historyQ.refetch()}
                        />
                      ))}
                      <div className={local.toolbar}>
                        <p className={styles.tertiary}>
                          {formatNumber(page.from)}–{formatNumber(page.to)} de{' '}
                          {formatNumber(page.total)}
                        </p>
                        <TicketButton
                          variant="ghost"
                          disabled={page.page <= 1}
                          onClick={() => url.setPage(page.page - 1)}
                        >
                          Anterior
                        </TicketButton>
                        <TicketButton
                          variant="ghost"
                          disabled={page.page >= page.pageCount}
                          onClick={() => url.setPage(page.page + 1)}
                        >
                          Siguiente
                        </TicketButton>
                        <Segment
                          label="Por página"
                          value={String(url.pageSize)}
                          options={PAGE_SIZES.map((size) => ({
                            value: String(size),
                            label: String(size),
                          }))}
                          onChange={(value) => url.setPageSize(Number(value) as PageSize)}
                        />
                      </div>
                    </>
                  )}
                </div>
              )}
            </div>
          ) : null}

          {url.view === 'aprobaciones' ? (
            <div className={local.block}>
              {pendingQ.error ? (
                <div className={styles.stack}>
                  <Param name="Cola de aprobación">
                    <ParameterCard
                      name="Cola de aprobación"
                      value="No disponible"
                      effect="La cola se lee de /pricing/events/:id/recommendations/pending."
                    />
                  </Param>
                  <p className={styles.danger} role="alert">
                    {errorText(pendingQ.error)}
                  </p>
                  <div>
                    <TicketButton variant="secondary" onClick={() => void pendingQ.refetch()}>
                      Reintentar
                    </TicketButton>
                  </div>
                </div>
              ) : pendingQ.isPending ? (
                <p className={styles.quiet}>Cargando la cola.</p>
              ) : filteredPending.length === 0 ? (
                <div className={styles.stack}>
                  <p className={styles.quiet}>
                    {url.query.trim() && pendingRows.length > 0
                      ? 'Ninguna recomendación pendiente coincide con la búsqueda.'
                      : 'Cola vacía. Las que pasan del tope automático aparecen aquí al aplicarlas.'}
                  </p>
                  {url.query.trim() && pendingRows.length > 0 ? (
                    <div>
                      <TicketButton variant="ghost" onClick={url.clearFilters}>
                        Limpiar búsqueda
                      </TicketButton>
                    </div>
                  ) : null}
                </div>
              ) : (
                <div className={styles.stack}>
                  {[...filteredPending]
                    .sort(
                      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
                    )
                    .map((row) => (
                      <PendingItem
                        key={row.id}
                        row={row}
                        canWrite={canWrite}
                        reviewing={
                          reviewMutation.isPending &&
                          reviewMutation.variables?.recommendationId === row.id
                        }
                        onReview={(decision, note) => void review(row.id, decision, note)}
                      />
                    ))}
                </div>
              )}
            </div>
          ) : null}

          {url.view === 'senales' ? (
            <SignalsBlock
              bundle={bundleQ.data}
              bundleError={bundleQ.error}
              revenue={revenueQ.data}
              revenuePending={revenueQ.isPending}
              revenueError={revenueQ.error}
              onRetryRevenue={() => void revenueQ.refetch()}
            />
          ) : null}
        </>
      )}
    </section>
  );
}

function BundleUnavailable({ error, onRetry }: { error: unknown; onRetry: () => void }) {
  return (
    <div className={styles.stack}>
      <Param name="Recomendaciones">
        <ParameterCard
          name="Recomendaciones"
          value="No disponible"
          effect="El paquete se lee de /pricing/events/:id/recommendations. Sin respuesta no se muestran precios sugeridos."
        />
      </Param>
      <p className={styles.danger} role="alert">
        {errorText(error)}
      </p>
      <div>
        <TicketButton variant="secondary" onClick={onRetry}>
          Reintentar
        </TicketButton>
      </div>
    </div>
  );
}

function RecommendationItem({
  item,
  open,
  canWrite,
  applying,
  selected,
  history,
  historyPending,
  historyError,
  onToggle,
  onSelect,
  onApply,
  onRetryHistory,
}: {
  item: OfferRecommendation;
  open: boolean;
  canWrite: boolean;
  applying: boolean;
  selected: boolean;
  history: readonly PriceHistoryEntry[];
  historyPending: boolean;
  historyError: unknown;
  onToggle: () => void;
  onSelect: (on: boolean) => void;
  onApply: () => void;
  onRetryHistory: () => void;
}) {
  const actionable = isActionable(item);
  const label = item.zone === item.name ? item.name : `${item.zone} · ${item.name}`;
  const marks = [
    directionLabel(item.direction),
    formatDelta(item.deltaPercent),
    item.requiresApproval ? 'pide aprobación' : null,
    item.guardrail.clamped ? 'acotada' : null,
  ].filter(Boolean);
  return (
    <div className={styles.stack}>
      <button
        type="button"
        className={open ? `${styles.zoneButton} ${styles.zoneOpen}` : styles.zoneButton}
        aria-expanded={open}
        onClick={onToggle}
      >
        <span>
          {label}
          <span className={styles.rowMeta}> · {marks.join(' · ')}</span>
        </span>
        <span className={styles.figure}>
          {formatCurrency(item.currentPrice)} → {formatCurrency(item.recommendedPrice)}
        </span>
      </button>
      {open ? (
        <div className={local.detail}>
          <p className={styles.mono}>{item.offerId}</p>
          <ul className={styles.rows}>
            <DetailRow name="Precio vigente" value={formatCurrency(item.currentPrice)} />
            <DetailRow name="Recomendado" value={formatCurrency(item.recommendedPrice)} />
            <DetailRow name="Precio base" value={formatCurrency(item.basePrice)} />
            <DetailRow name="Variación" value={formatDelta(item.deltaPercent)} />
            <DetailRow
              name="Multiplicador"
              value={`×${formatNumber(item.recommendedMultiplier, 3)}`}
            />
            <DetailRow name="Confianza" value={confidenceLabel(item.confidence)} />
            <DetailRow
              name="Banda"
              value={`${item.guardrail.bandLabel}${item.guardrail.clamped ? ' · acotado' : ''}`}
            />
          </ul>
          <p className={styles.quiet}>{item.explanation}</p>
          <p className={styles.tertiary}>
            {item.guardrail.clamped
              ? `El candidato era ${formatCurrency(item.guardrail.preClampPrice)}; el motor lo recortó a ${formatCurrency(item.guardrail.floor)} – ${formatCurrency(item.guardrail.ceiling)}.`
              : `Dentro de ${formatCurrency(item.guardrail.floor)} – ${formatCurrency(item.guardrail.ceiling)}.`}
          </p>

          <p className={local.subTitle}>Factores</p>
          {item.factors.length === 0 ? (
            <p className={styles.quiet}>El motor no adjuntó factores para esta oferta.</p>
          ) : (
            <ul className={styles.rows}>
              {item.factors.map((factor) => (
                <li key={`${factor.code}-${factor.detail}`} className={styles.row}>
                  <div className={styles.rowMain}>
                    <p className={styles.rowTitle}>{factorLabel(factor.code)}</p>
                    <p className={styles.rowMeta}>{factor.detail}</p>
                  </div>
                  <p className={styles.tertiary}>
                    {factor.threshold !== undefined
                      ? `umbral ${formatNumber(factor.threshold, 2)}`
                      : ''}
                  </p>
                  <p className={styles.figure}>×{formatNumber(factor.contribution, 3)}</p>
                </li>
              ))}
            </ul>
          )}

          <p className={local.subTitle}>Historial de precios</p>
          {historyError ? (
            <div className={styles.stack}>
              <p className={styles.danger} role="alert">
                {errorText(historyError)}
              </p>
              <div>
                <TicketButton variant="ghost" onClick={onRetryHistory}>
                  Reintentar
                </TicketButton>
              </div>
            </div>
          ) : historyPending ? (
            <p className={styles.quiet}>Cargando historial.</p>
          ) : history.length === 0 ? (
            <p className={styles.quiet}>Sin cambios de precio registrados.</p>
          ) : (
            <ul className={styles.rows}>
              {history.map((entry) => {
                const reason = describeHistoryReason(entry.reason);
                return (
                  <li key={entry.id} className={styles.row}>
                    <div className={styles.rowMain}>
                      <p className={styles.rowTitle}>{reason.label}</p>
                      <p className={styles.rowMeta}>
                        {[formatDateTime(entry.createdAt), reason.detail || null]
                          .filter(Boolean)
                          .join(' · ')}
                      </p>
                    </div>
                    <p className={styles.tertiary}>×{formatNumber(entry.priceMultiplier, 3)}</p>
                    <p className={styles.figure}>{formatCurrency(toAmount(entry.adjustedPrice))}</p>
                  </li>
                );
              })}
            </ul>
          )}

          {actionable && canWrite ? (
            <div className={local.toolbar}>
              <Switch label={`Seleccionar ${label}`} on={selected} onChange={onSelect} />
              <p className={styles.quiet}>Incluir en la selección</p>
              <TicketButton variant="secondary" disabled={applying} onClick={onApply}>
                {item.requiresApproval ? 'Encolar aprobación' : 'Aplicar cambio seguro'}
              </TicketButton>
            </div>
          ) : null}
          {!actionable ? (
            <p className={styles.tertiary}>Sin cambio: no hay nada que aplicar.</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function DetailRow({ name, value }: { name: string; value: string }) {
  return (
    <li className={styles.row}>
      <p className={styles.rowTitle}>{name}</p>
      <span />
      <p className={styles.figure}>{value}</p>
    </li>
  );
}

function PendingItem({
  row,
  canWrite,
  reviewing,
  onReview,
}: {
  row: PendingRow;
  canWrite: boolean;
  reviewing: boolean;
  onReview: (decision: 'approve' | 'reject', note: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState('');
  return (
    <div className={styles.stack}>
      <button
        type="button"
        className={open ? `${styles.zoneButton} ${styles.zoneOpen}` : styles.zoneButton}
        aria-expanded={open}
        onClick={() => setOpen((current) => !current)}
      >
        <span>
          {row.offerName}
          <span className={styles.rowMeta}>
            {' '}
            · {row.zone} · {directionLabel(row.direction)} {formatDelta(row.deltaPercent)}
            {row.expired ? ' · vencida' : ''}
          </span>
        </span>
        <span className={styles.figure}>
          {formatCurrency(row.currentPrice)} → {formatCurrency(row.adjustedPrice)}
        </span>
      </button>
      {open ? (
        <div className={local.detail}>
          <p className={styles.mono}>{shortId(row.id)}</p>
          <p className={styles.quiet}>
            {row.payload?.explanation ?? 'Sin explicación adjunta; revisa el paquete vigente.'}
          </p>
          <p className={styles.tertiary}>
            Creada {formatDateTime(row.createdAt)} ·{' '}
            {row.expired
              ? 'vencida: genera un paquete nuevo'
              : `vence ${formatDateTime(row.expiresAt)}`}
          </p>
          {canWrite ? (
            <>
              <Field
                label="Nota"
                hint="Queda en la bitácora. En un rechazo, es el motivo."
                value={note}
                maxLength={500}
                onChange={(event) => setNote(event.target.value)}
              />
              <div className={local.toolbar}>
                <TicketButton
                  variant="secondary"
                  disabled={row.expired || reviewing}
                  onClick={() => onReview('approve', note)}
                >
                  Aprobar
                </TicketButton>
                <TicketButton
                  variant="danger"
                  disabled={reviewing}
                  onClick={() => onReview('reject', note)}
                >
                  Rechazar
                </TicketButton>
              </div>
            </>
          ) : (
            <p className={styles.tertiary}>Revisar la cola pide el permiso price:write.</p>
          )}
        </div>
      ) : null}
    </div>
  );
}

function SignalsBlock({
  bundle,
  bundleError,
  revenue,
  revenuePending,
  revenueError,
  onRetryRevenue,
}: {
  bundle: RecommendationBundle | undefined;
  bundleError: unknown;
  revenue: RevenueEstimate | undefined;
  revenuePending: boolean;
  revenueError: unknown;
  onRetryRevenue: () => void;
}) {
  return (
    <>
      <div className={local.block}>
        <p className={local.subTitle}>Señales del evento</p>
        {bundle ? (
          <ul className={styles.rows}>
            <DetailRow
              name="Días al evento"
              value={formatNumber(bundle.signals.daysUntilEvent, 1)}
            />
            <DetailRow
              name="Ocupación"
              value={formatPercent(bundle.signals.occupancyPercent / 100)}
            />
            <DetailRow name="Ritmo esperado" value={formatPercent(bundle.signals.expectedPace)} />
            <DetailRow name="Ritmo real" value={formatPercent(bundle.signals.actualPace)} />
            <DetailRow
              name="Diferencia de ritmo"
              value={`${formatNumber(bundle.signals.paceDelta * 100, 1)} pp`}
            />
            <DetailRow
              name="Vendidos / aforo"
              value={`${formatNumber(bundle.signals.soldTickets)} / ${formatNumber(bundle.signals.totalCapacity)}`}
            />
          </ul>
        ) : (
          <p
            className={bundleError ? styles.danger : styles.quiet}
            role={bundleError ? 'alert' : undefined}
          >
            {bundleError
              ? `Las señales vienen con las recomendaciones. ${errorText(bundleError)}`
              : 'Sin señales todavía.'}
          </p>
        )}
      </div>
      <div className={local.block}>
        <p className={local.subTitle}>Estimación de ingreso</p>
        <p className={styles.tertiary}>Ingreso bruto a precio base, según el API.</p>
        {revenueError ? (
          <div className={styles.stack}>
            <p className={styles.danger} role="alert">
              {errorText(revenueError)}
            </p>
            <div>
              <TicketButton variant="ghost" onClick={onRetryRevenue}>
                Reintentar
              </TicketButton>
            </div>
          </div>
        ) : revenuePending ? (
          <p className={styles.quiet}>Cargando estimación.</p>
        ) : !revenue ? (
          <p className={styles.quiet}>El API no devolvió estimación para este evento.</p>
        ) : (
          <ul className={styles.rows}>
            <DetailRow name="Ingreso bruto" value={formatCurrency(revenue.grossRevenue, 0)} />
            <DetailRow name="Comisión" value={formatCurrency(revenue.commission, 0)} />
            <DetailRow name="Ingreso neto" value={formatCurrency(revenue.netRevenue, 0)} />
            <DetailRow name="Ocupación reportada" value={`${revenue.occupancyPercent}%`} />
          </ul>
        )}
      </div>
    </>
  );
}
