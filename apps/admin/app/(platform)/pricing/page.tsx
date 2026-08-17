'use client';

import Link from 'next/link';
import { Suspense, useEffect, useMemo, useState } from 'react';
import {
  Badge,
  BarChart,
  Button,
  EmptyState,
  FilterBar,
  KpiCard,
  PageHeader,
  Section,
  SegmentedControl,
  Skeleton,
  SkeletonCard,
  StatusDot,
  formatCurrency,
  formatNumber,
  formatPercent,
  type FilterDefinition,
  type SegmentedOption,
} from '@boletera/ui';
import { useToast } from '@/components/Toast/ToastProvider';
import { PermissionError } from '@/lib/http';
import { useEvents } from '@/lib/queries';
import { useSession } from '@/lib/use-session';
import { PendingApprovalsPanel } from './_components/PendingApprovalsPanel';
import { RecommendationDetailDrawer } from './_components/RecommendationDetailDrawer';
import { RecommendationsTable } from './_components/RecommendationsTable';
import { SignalsPanel } from './_components/SignalsPanel';
import {
  buildPendingRows,
  filterPendingRows,
  filterRecommendations,
  generatedAgeLabel,
  isActionable,
  paginate,
  priceComparisonSeries,
  summarizeRecommendations,
} from './_lib/derive';
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
import {
  usePricingUrlState,
  type PricingView,
} from './_lib/use-pricing-url-state';
import type { OfferRecommendation } from './_lib/types';
import styles from './pricing.module.scss';

const VIEW_OPTIONS: readonly SegmentedOption<PricingView>[] = [
  { value: 'recomendaciones', label: 'Recomendaciones' },
  { value: 'aprobaciones', label: 'Aprobaciones' },
  { value: 'senales', label: 'Señales' },
];

const VIEW_LABELS: Record<PricingView, string> = {
  recomendaciones: 'Recomendaciones',
  aprobaciones: 'Aprobaciones',
  senales: 'Señales',
};

function PricingSkeleton() {
  return (
    <div className={styles.page} aria-busy="true" aria-label="Cargando pricing">
      <SkeletonCard lines={3} />
      <div className={styles.kpiGrid}>
        <SkeletonCard lines={2} />
        <SkeletonCard lines={2} />
        <SkeletonCard lines={2} />
        <SkeletonCard lines={2} />
      </div>
      <Skeleton height={280} />
    </div>
  );
}

function PricingConsole() {
  const toast = useToast();
  const { status, can } = useSession();
  const canWrite = can('price:write');
  const url = usePricingUrlState();
  const eventsQ = useEvents();

  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [now] = useState(() => Date.now());
  const [previewMode, setPreviewMode] = useState(false);

  // Primer evento disponible si la URL no trae uno válido.
  useEffect(() => {
    if (url.eventId || !eventsQ.data?.length) return;
    url.setEventId(eventsQ.data[0].id);
  }, [eventsQ.data, url.eventId, url.setEventId]);

  const eventExists = Boolean(
    url.eventId && eventsQ.data?.some((event) => event.id === url.eventId),
  );
  const activeEventId = eventExists ? url.eventId : '';

  const bundleQ = useRecommendationBundle(activeEventId);
  const pendingQ = usePendingRecommendations(activeEventId);
  const revenueQ = useRevenueEstimate(activeEventId);
  const applyMutation = useApplyRecommendations(activeEventId);
  const reviewMutation = useReviewRecommendation(activeEventId);
  const previewMutation = usePreviewRecommendations(activeEventId);
  const updateMutation = useUpdateDynamicPrices(activeEventId);

  const selectedRecommendation = useMemo(() => {
    if (!url.offerId || !bundleQ.data) return null;
    return (
      bundleQ.data.recommendations.find((item) => item.offerId === url.offerId) ?? null
    );
  }, [bundleQ.data, url.offerId]);

  const historyQ = useOfferPriceHistory(selectedRecommendation?.offerId ?? null);

  const summary = useMemo(
    () => summarizeRecommendations(bundleQ.data?.recommendations ?? []),
    [bundleQ.data],
  );

  const filtered = useMemo(
    () =>
      filterRecommendations(bundleQ.data?.recommendations ?? [], {
        query: url.query,
        directions: url.directions,
        approvalOnly: url.approvalOnly,
        clampedOnly: url.clampedOnly,
      }),
    [
      bundleQ.data,
      url.approvalOnly,
      url.clampedOnly,
      url.directions,
      url.query,
    ],
  );

  const page = useMemo(
    () => paginate(filtered, url.page, url.pageSize),
    [filtered, url.page, url.pageSize],
  );

  // Si los filtros dejan la página fuera de rango, corrige la URL.
  useEffect(() => {
    if (page.page !== url.page) url.setPage(page.page);
  }, [page.page, url.page, url.setPage]);

  const pendingRows = useMemo(
    () =>
      buildPendingRows(
        pendingQ.data ?? [],
        bundleQ.data?.recommendations ?? [],
        now,
      ),
    [bundleQ.data, now, pendingQ.data],
  );

  const filteredPending = useMemo(
    () => filterPendingRows(pendingRows, url.query),
    [pendingRows, url.query],
  );

  const chartSeries = useMemo(() => {
    const actionable = filtered.filter(isActionable).slice(0, 12);
    return priceComparisonSeries(actionable);
  }, [filtered]);

  const filterDefs = useMemo<FilterDefinition[]>(() => {
    const recommendations = bundleQ.data?.recommendations ?? [];
    const countDirection = (direction: OfferRecommendation['direction']) =>
      recommendations.filter((item) => item.direction === direction).length;
    return [
      {
        id: 'direccion',
        label: 'Dirección',
        multiple: true,
        options: [
          { value: 'increase', label: 'Subir', count: countDirection('increase') },
          { value: 'decrease', label: 'Bajar', count: countDirection('decrease') },
          { value: 'hold', label: 'Mantener', count: countDirection('hold') },
        ],
      },
      {
        id: 'marca',
        label: 'Marcas',
        multiple: true,
        options: [
          {
            value: 'aprobacion',
            label: 'Requiere aprobación',
            count: summary.requiresApproval,
          },
          {
            value: 'banda',
            label: 'Acotadas por banda',
            count: summary.clamped,
          },
        ],
      },
    ];
  }, [bundleQ.data, summary.clamped, summary.requiresApproval]);

  const selectedEvent = eventsQ.data?.find((event) => event.id === activeEventId);
  const forbidden =
    bundleQ.error instanceof PermissionError ||
    pendingQ.error instanceof PermissionError;

  async function refreshAll() {
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
    try {
      await previewMutation.mutateAsync();
      setPreviewMode(true);
      url.setView('recomendaciones');
      toast.success('Vista previa generada sin escribir DynamicPrice');
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'No se pudo previsualizar',
      );
    }
  }

  async function onGenerate() {
    if (!activeEventId) return;
    try {
      const result = await updateMutation.mutateAsync();
      setPreviewMode(false);
      setSelectedKeys([]);
      toast.success(
        result.message ||
          `Aplicadas ${result.applied} · pendientes ${result.pendingApproval} · retenidas ${result.held}`,
      );
      if (result.pendingApproval > 0) url.setView('aprobaciones');
    } catch (error) {
      toast.error(
        error instanceof Error ? error.message : 'No se pudo generar',
      );
    }
  }

  async function applyOffers(offerIds: readonly string[], confirmApproval: boolean) {
    if (!activeEventId || offerIds.length === 0) return;
    try {
      const result = await applyMutation.mutateAsync({
        offerIds,
        confirmApproval,
      });
      setSelectedKeys([]);
      setPreviewMode(false);
      const parts = [
        result.applied.length ? `${result.applied.length} aplicadas` : null,
        result.pendingCreated.length
          ? `${result.pendingCreated.length} encoladas`
          : null,
        result.skipped.length ? `${result.skipped.length} omitidas` : null,
      ].filter(Boolean);
      toast.success(parts.join(' · ') || 'Sin cambios');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo aplicar');
    }
  }

  async function review(
    recommendationId: string,
    decision: 'approve' | 'reject',
    note: string,
  ) {
    try {
      await reviewMutation.mutateAsync({ recommendationId, decision, note });
      toast.success(decision === 'approve' ? 'Recomendación aprobada' : 'Recomendación rechazada');
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo revisar');
    }
  }

  if (status === 'loading') {
    return <PricingSkeleton />;
  }

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Revenue suite · Pricing dinámico"
        title="Consola de pricing"
        description="Recomendaciones explicables por oferta, cola de aprobación humana y señales reales del motor. Solo se muestra lo que publica la API del evento seleccionado."
        breadcrumbs={[
          { label: 'TicketOS', href: '/dashboard' },
          { label: 'Pricing' },
        ]}
        actions={
          <div className={styles.headerActions}>
            {bundleQ.data ? (
              <StatusDot
                tone={bundleQ.data.enableDynamic ? 'success' : 'warning'}
                label={
                  bundleQ.data.enableDynamic
                    ? 'Pricing dinámico activo'
                    : 'Pricing dinámico apagado'
                }
              />
            ) : null}
            {activeEventId ? (
              <Link href={`/events/${activeEventId}`} className={styles.hubLink}>
                Hub del evento
              </Link>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              loading={previewMutation.isPending}
              disabled={!activeEventId || updateMutation.isPending}
              onClick={() => void onPreview()}
            >
              Previsualizar
            </Button>
            {canWrite ? (
              <Button
                size="sm"
                loading={updateMutation.isPending}
                disabled={!activeEventId || previewMutation.isPending}
                onClick={() => void onGenerate()}
              >
                Generar y aplicar seguros
              </Button>
            ) : null}
            <Button
              variant="secondary"
              size="sm"
              loading={
                bundleQ.isFetching || pendingQ.isFetching || revenueQ.isFetching
              }
              disabled={!activeEventId}
              onClick={() => void refreshAll()}
            >
              Actualizar
            </Button>
          </div>
        }
      >
        <div className={styles.eventSelect}>
          <label htmlFor="pricing-event">Evento</label>
          <select
            id="pricing-event"
            value={activeEventId}
            disabled={eventsQ.isPending || !eventsQ.data?.length}
            onChange={(event) => {
              setSelectedKeys([]);
              setPreviewMode(false);
              url.setEventId(event.target.value);
            }}
          >
            {!eventsQ.data?.length ? (
              <option value="">Sin eventos</option>
            ) : (
              eventsQ.data.map((event) => (
                <option key={event.id} value={event.id}>
                  {event.title}
                </option>
              ))
            )}
          </select>
        </div>
      </PageHeader>

      {!canWrite ? (
        <p className={styles.permissionNote} role="note">
          Tu rol puede consultar recomendaciones, pero no aplicarlas ni revisar la
          cola. Necesitas el permiso <code>price:write</code>.
        </p>
      ) : null}

      {previewMode && bundleQ.data ? (
        <div className={styles.previewBanner} role="status">
          <Badge tone="info">Preview</Badge>
          <span>
            Bundle calculado sin persistir DynamicPrice ·{' '}
            {generatedAgeLabel(bundleQ.data, now)}
          </span>
          {canWrite ? (
            <Button
              type="button"
              size="sm"
              variant="secondary"
              loading={updateMutation.isPending}
              onClick={() => void onGenerate()}
            >
              Confirmar generación
            </Button>
          ) : null}
        </div>
      ) : null}

      {eventsQ.error ? (
        <EmptyState
          illustration="error"
          tone="danger"
          title="No se pudo cargar el catálogo de eventos"
          description={
            eventsQ.error instanceof Error
              ? eventsQ.error.message
              : 'Error inesperado al listar eventos.'
          }
          action={
            <Button onClick={() => void eventsQ.refetch()}>Reintentar</Button>
          }
        />
      ) : eventsQ.isPending ? (
        <PricingSkeleton />
      ) : !eventsQ.data?.length ? (
        <EmptyState
          illustration="inbox"
          title="Sin eventos en la organización"
          description="Crea o publica un evento para evaluar recomendaciones de precio. Esta consola opera por evento, no inventa plantillas globales."
          action={
            <Link href="/events/new" className={styles.hubLink}>
              Crear evento
            </Link>
          }
        />
      ) : !activeEventId ? (
        <EmptyState
          illustration="search"
          title="Selecciona un evento"
          description="Las recomendaciones, la cola de aprobación y las señales se calculan por evento."
        />
      ) : forbidden ? (
        <EmptyState
          illustration="error"
          tone="danger"
          title="Sin permiso para ver pricing"
          description="Tu rol no tiene acceso a las recomendaciones de este evento. Pide a un administrador el permiso de lectura de pricing."
        />
      ) : bundleQ.error ? (
        <EmptyState
          illustration="error"
          tone="danger"
          title="No se pudieron cargar las recomendaciones"
          description={
            bundleQ.error instanceof Error
              ? bundleQ.error.message
              : 'Error inesperado al consultar el motor de pricing.'
          }
          action={
            <Button onClick={() => void bundleQ.refetch()}>Reintentar</Button>
          }
        />
      ) : (
        <>
          <Section columns={4} gap="md" aria-label="Resumen de pricing">
            <KpiCard
              label="Ofertas evaluadas"
              value={formatNumber(summary.total)}
              hint={
                selectedEvent
                  ? selectedEvent.title
                  : bundleQ.data?.title ?? 'Evento seleccionado'
              }
              tone="accent"
              loading={bundleQ.isPending}
            />
            <KpiCard
              label="Pendientes de aprobación"
              value={formatNumber(pendingRows.length)}
              hint={
                pendingRows.some((row) => row.expired)
                  ? 'Hay recomendaciones expiradas (> 24 h)'
                  : 'Cola humana del evento'
              }
              tone={pendingRows.length > 0 ? 'warning' : 'neutral'}
              loading={pendingQ.isPending}
            />
            <KpiCard
              label="Auto-aplicables"
              value={formatNumber(summary.autoApplicable)}
              hint={`${formatNumber(summary.requiresApproval)} exigen firma`}
              tone={summary.autoApplicable > 0 ? 'success' : 'neutral'}
              loading={bundleQ.isPending}
            />
            <KpiCard
              label="Ocupación"
              value={
                bundleQ.data
                  ? formatPercent(bundleQ.data.signals.occupancyPercent / 100)
                  : '—'
              }
              hint={
                bundleQ.data
                  ? `${formatNumber(bundleQ.data.signals.soldTickets)} / ${formatNumber(bundleQ.data.signals.totalCapacity)} boletos`
                  : 'Señales del motor'
              }
              tone="info"
              loading={bundleQ.isPending}
            />
          </Section>

          {bundleQ.data ? (
            <p className={styles.summaryLine}>
              {bundleQ.data.summary} · {generatedAgeLabel(bundleQ.data, now)}
            </p>
          ) : null}

          <div className={styles.layout}>
            <div className={styles.stack}>
              <div className={styles.card}>
                <div className={styles.cardHead}>
                  <div>
                    <h2>Comparativa de precios</h2>
                    <p className={styles.muted}>
                      Precio vigente vs. recomendado · hasta 12 ofertas accionables del
                      filtro actual
                    </p>
                  </div>
                </div>
                {bundleQ.isPending ? (
                  <Skeleton height={240} />
                ) : chartSeries.current.length === 0 ? (
                  <EmptyState
                    size="sm"
                    illustration="chart"
                    title="Sin ofertas accionables"
                    description="No hay alzas ni bajas en el filtro actual para graficar. Los holds no mueven precio."
                  />
                ) : (
                  <BarChart
                    label="Precio vigente frente a recomendado por oferta"
                    height={240}
                    formatValue={(value) => formatCurrency(value, 0)}
                    series={[
                      {
                        id: 'current',
                        name: 'Vigente',
                        data: chartSeries.current,
                      },
                      {
                        id: 'recommended',
                        name: 'Recomendado',
                        data: chartSeries.recommended,
                      },
                    ]}
                  />
                )}
              </div>

              <div className={styles.card}>
                <div className={styles.toolbar}>
                  <SegmentedControl
                    size="sm"
                    label="Vista de pricing"
                    options={VIEW_OPTIONS}
                    value={url.view}
                    onValueChange={url.setView}
                  />
                  <Badge tone="neutral" variant="outline">
                    {VIEW_LABELS[url.view]}
                  </Badge>
                </div>

                {url.view !== 'senales' ? (
                  <FilterBar
                    filters={url.view === 'recomendaciones' ? filterDefs : []}
                    value={url.filterSelection}
                    onChange={url.setFilterSelection}
                    search={{
                      value: url.query,
                      onChange: url.setQuery,
                      placeholder:
                        url.view === 'aprobaciones'
                          ? 'Buscar oferta o id de recomendación…'
                          : 'Buscar oferta, zona o id…',
                    }}
                  />
                ) : null}

                {url.view === 'recomendaciones' ? (
                  <RecommendationsTable
                    page={page}
                    pageSize={url.pageSize}
                    loading={bundleQ.isPending}
                    canWrite={canWrite}
                    selectedKeys={selectedKeys}
                    applying={applyMutation.isPending}
                    emptyBecauseFilters={
                      url.hasFilters && (bundleQ.data?.recommendations.length ?? 0) > 0
                    }
                    onSelectionChange={setSelectedKeys}
                    onRowOpen={url.setOfferId}
                    onPageChange={url.setPage}
                    onPageSizeChange={url.setPageSize}
                    onClearFilters={url.clearFilters}
                    onApplySelection={(confirmApproval) => {
                      void applyOffers(selectedKeys, confirmApproval);
                    }}
                  />
                ) : null}

                {url.view === 'aprobaciones' ? (
                  pendingQ.error && !(pendingQ.error instanceof PermissionError) ? (
                    <EmptyState
                      size="sm"
                      tone="danger"
                      illustration="error"
                      title="No se pudo cargar la cola"
                      description={
                        pendingQ.error instanceof Error
                          ? pendingQ.error.message
                          : 'Error inesperado.'
                      }
                      action={
                        <Button
                          size="sm"
                          variant="outline"
                          onClick={() => void pendingQ.refetch()}
                        >
                          Reintentar
                        </Button>
                      }
                    />
                  ) : (
                    <PendingApprovalsPanel
                      rows={filteredPending}
                      loading={pendingQ.isPending}
                      canWrite={canWrite}
                      reviewingId={
                        reviewMutation.isPending
                          ? (reviewMutation.variables?.recommendationId ?? null)
                          : null
                      }
                      emptyBecauseFilters={
                        url.query.trim().length > 0 && pendingRows.length > 0
                      }
                      onClearFilters={url.clearFilters}
                      onApprove={(id, note) => void review(id, 'approve', note)}
                      onReject={(id, note) => void review(id, 'reject', note)}
                    />
                  )
                ) : null}

                {url.view === 'senales' ? (
                  <SignalsPanel
                    bundle={bundleQ.data}
                    revenue={revenueQ.data}
                    revenueLoading={revenueQ.isPending}
                    revenueError={
                      revenueQ.error instanceof Error ? revenueQ.error : null
                    }
                  />
                ) : null}
              </div>
            </div>

            <aside className={styles.stack} aria-label="Resumen lateral">
              <div className={styles.card}>
                <div className={styles.cardHead}>
                  <h2>Desglose del paquete</h2>
                </div>
                {bundleQ.isPending ? (
                  <Skeleton height={160} />
                ) : summary.total === 0 ? (
                  <EmptyState
                    size="sm"
                    illustration="inbox"
                    title="Paquete vacío"
                    description="El motor no evaluó ofertas para este evento."
                  />
                ) : (
                  <ul className={styles.recs}>
                    <li className={styles.rec}>
                      <p className={styles.recTitle}>
                        {formatNumber(summary.increases)} alzas ·{' '}
                        {formatNumber(summary.decreases)} bajas ·{' '}
                        {formatNumber(summary.holds)} holds
                      </p>
                      <p className={styles.recBody}>
                        {formatNumber(summary.autoApplicable)} seguras para aplicar ·{' '}
                        {formatNumber(summary.requiresApproval)} con firma ·{' '}
                        {formatNumber(summary.clamped)} acotadas por banda
                      </p>
                    </li>
                    {bundleQ.data?.enableDynamic === false ? (
                      <li className={styles.rec}>
                        <Badge tone="warning">Dinámico apagado</Badge>
                        <p className={styles.recBody}>
                          El evento tiene el pricing dinámico desactivado. Las
                          recomendaciones siguen siendo consultables, pero la ocupación
                          no aplica surge.
                        </p>
                        <p className={styles.recAction}>
                          Actívalo desde el hub del evento → pestaña Pricing.
                        </p>
                      </li>
                    ) : null}
                  </ul>
                )}
              </div>

              <div className={styles.card}>
                <div className={styles.cardHead}>
                  <h2>Contratos de datos</h2>
                </div>
                <ul className={styles.recs}>
                  <li className={styles.rec}>
                    <p className={styles.recTitle}>Disponibles</p>
                    <p className={styles.recBody}>
                      <code className={styles.mono}>
                        GET /pricing/events/:id/recommendations
                      </code>
                      <br />
                      <code className={styles.mono}>
                        GET /pricing/events/:id/recommendations/pending
                      </code>
                      <br />
                      <code className={styles.mono}>
                        GET /pricing/events/:id/revenue-estimate
                      </code>
                      <br />
                      <code className={styles.mono}>
                        GET /pricing/offers/:id/history
                      </code>
                    </p>
                  </li>
                  <li className={styles.rec}>
                    <p className={styles.recTitle}>Acciones</p>
                    <p className={styles.recBody}>
                      <code className={styles.mono}>
                        POST …/recommendations/apply
                      </code>
                      <br />
                      <code className={styles.mono}>
                        POST /pricing/recommendations/:id/approve|reject
                      </code>
                    </p>
                  </li>
                </ul>
              </div>
            </aside>
          </div>
        </>
      )}

      <RecommendationDetailDrawer
        recommendation={selectedRecommendation}
        canWrite={canWrite}
        applying={applyMutation.isPending}
        history={historyQ.data ?? []}
        historyLoading={historyQ.isPending}
        historyError={historyQ.error instanceof Error ? historyQ.error : null}
        onClose={() => url.setOfferId(null)}
        onApplySafe={(offerId) => void applyOffers([offerId], false)}
        onQueueApproval={(offerId) => void applyOffers([offerId], false)}
        onRetryHistory={() => void historyQ.refetch()}
      />
    </div>
  );
}

export default function PricingPage() {
  return (
    <Suspense fallback={<PricingSkeleton />}>
      <PricingConsole />
    </Suspense>
  );
}
