'use client';

import { useMemo, useState } from 'react';
import type { AiRecommendation } from '@boletera/shared';
import {
  Badge,
  Button,
  KpiCard,
  PageHeader,
  Section,
  SegmentedControl,
  Tabs,
  formatNumber,
} from '@boletera/ui';
import {
  useAiAnomalies,
  useAiCustomerSegmentation,
  useAiExecutiveSummary,
  useAiFraudRisk,
  useAiRecommendations,
  useAiSalesForecast,
  useEvents,
} from '@/lib/queries';
import { ActionsPanel } from './_components/ActionsPanel';
import { AnomaliesPanel } from './_components/AnomaliesPanel';
import { ChatPanel } from './_components/ChatPanel';
import { ConfirmActionModal } from './_components/ConfirmActionModal';
import { ForecastPanel } from './_components/ForecastPanel';
import { FraudRiskPanel } from './_components/FraudRiskPanel';
import { NarrativePanel } from './_components/NarrativePanel';
import { RecommendationsPanel } from './_components/RecommendationsPanel';
import { SegmentationPanel } from './_components/SegmentationPanel';
import {
  createProposedAction,
  type AiProposedAction,
} from './_lib/actions';
import type { AiChatBundle } from './_lib/chat';
import {
  formatGeneratedAt,
  formatImpactValue,
  formatMxn,
  formatPercentPoints,
} from './_lib/format';
import { AI_RANGE_OPTIONS, buildAiRange, type AiRangeKey } from './_lib/range';
import { isAiServiceUnavailable } from './_lib/status';
import styles from './ai.module.scss';

type AiView = 'chat' | 'insights' | 'panels' | 'actions';

const GOVERNANCE_NOTES = [
  {
    title: 'Trazabilidad por respuesta',
    body: 'Cada salida debe conservar método, rango, muestra y hora de generación. Sin traza no hay acción.',
  },
  {
    title: 'Insuficiencia explícita',
    body: 'Si la muestra es limitada o insuficiente, el copiloto lo declara. Nunca rellena huecos con cifras inventadas.',
  },
  {
    title: 'Insight ≠ mutación',
    body: 'Las recomendaciones orientan; cambios de precio, campañas o fraude siguen flujos con confirmación humana.',
  },
] as const;

export default function AiPage() {
  const [rangeKey, setRangeKey] = useState<AiRangeKey>('30d');
  const [eventId, setEventId] = useState<string>('');
  const [view, setView] = useState<AiView>('chat');
  const [proposedActions, setProposedActions] = useState<AiProposedAction[]>([]);
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const range = useMemo(() => buildAiRange(rangeKey), [rangeKey]);
  const rangeParams = useMemo(
    () => ({
      from: range.from,
      to: range.to,
      eventId: eventId || undefined,
    }),
    [eventId, range.from, range.to],
  );

  const eventsQ = useEvents();
  const summaryQ = useAiExecutiveSummary(rangeParams);
  const anomaliesQ = useAiAnomalies(rangeParams);
  const recommendationsQ = useAiRecommendations({ ...rangeParams, limit: 25 });
  const fraudQ = useAiFraudRisk({ ...rangeParams, limit: 50 });
  const segmentationQ = useAiCustomerSegmentation({ ...rangeParams, limit: 100 });
  const forecastQ = useAiSalesForecast(eventId || null, {
    from: range.from,
    to: range.to,
  });

  const eventOptions = useMemo(() => {
    const rows = eventsQ.data ?? [];
    return [...rows]
      .sort((a, b) => a.title.localeCompare(b.title, 'es-MX'))
      .map((event) => ({
        id: event.id,
        label: `${event.title}${event.status ? ` · ${event.status}` : ''}`,
      }));
  }, [eventsQ.data]);

  const selectedEventLabel =
    eventOptions.find((option) => option.id === eventId)?.label ?? null;

  const aiUnavailable =
    isAiServiceUnavailable(summaryQ.error) ||
    isAiServiceUnavailable(anomaliesQ.error) ||
    isAiServiceUnavailable(recommendationsQ.error) ||
    isAiServiceUnavailable(fraudQ.error) ||
    isAiServiceUnavailable(segmentationQ.error) ||
    (Boolean(eventId) && isAiServiceUnavailable(forecastQ.error));

  const loadingKpis =
    summaryQ.isPending ||
    anomaliesQ.isPending ||
    recommendationsQ.isPending ||
    fraudQ.isPending;

  const anomalyCount = anomaliesQ.data?.anomalies.length;
  const recommendationCount = recommendationsQ.data?.recommendations.length;
  const urgentCount = recommendationsQ.data?.recommendations.filter(
    (item) => item.priority === 'urgent' || item.priority === 'high',
  ).length;
  const highFraud = fraudQ.data?.summary.highOrCritical;
  const projectedOccupancy = forecastQ.data?.projectedOccupancyPercent.point;
  const projectedRevenue = forecastQ.data?.projectedGrossRevenue.point;
  const pendingActions = proposedActions.filter(
    (row) => row.status === 'pending_confirmation',
  ).length;

  const generatedAt = useMemo(() => {
    const stamps = [
      summaryQ.data?.generatedAt,
      anomaliesQ.data?.generatedAt,
      recommendationsQ.data?.generatedAt,
      fraudQ.data?.generatedAt,
      segmentationQ.data?.generatedAt,
      forecastQ.data?.generatedAt,
    ].filter((value): value is string => Boolean(value));
    if (stamps.length === 0) return undefined;
    return stamps.sort().at(-1);
  }, [
    anomaliesQ.data?.generatedAt,
    forecastQ.data?.generatedAt,
    fraudQ.data?.generatedAt,
    recommendationsQ.data?.generatedAt,
    segmentationQ.data?.generatedAt,
    summaryQ.data?.generatedAt,
  ]);

  const unavailableSources = useMemo(() => {
    const sources: string[] = [];
    if (!summaryQ.data) sources.push('resumen ejecutivo');
    if (!anomaliesQ.data) sources.push('anomalías');
    if (!recommendationsQ.data) sources.push('recomendaciones');
    if (!fraudQ.data) sources.push('fraude');
    if (!segmentationQ.data) sources.push('segmentación');
    if (eventId && !forecastQ.data) sources.push('pronóstico');
    return sources;
  }, [
    anomaliesQ.data,
    eventId,
    forecastQ.data,
    fraudQ.data,
    recommendationsQ.data,
    segmentationQ.data,
    summaryQ.data,
  ]);

  const chatBundle = useMemo<AiChatBundle>(
    () => ({
      rangeLabel: range.label,
      eventLabel: selectedEventLabel,
      summary: summaryQ.data,
      anomalies: anomaliesQ.data,
      recommendations: recommendationsQ.data,
      fraud: fraudQ.data,
      segmentation: segmentationQ.data,
      forecast: forecastQ.data,
      unavailable: unavailableSources,
    }),
    [
      anomaliesQ.data,
      forecastQ.data,
      fraudQ.data,
      range.label,
      recommendationsQ.data,
      segmentationQ.data,
      selectedEventLabel,
      summaryQ.data,
      unavailableSources,
    ],
  );

  const proposedIds = useMemo(
    () =>
      new Set(
        proposedActions
          .filter((row) => row.status === 'pending_confirmation')
          .map((row) => row.recommendationId),
      ),
    [proposedActions],
  );

  const reviewing = proposedActions.find((row) => row.id === reviewingId) ?? null;

  function refreshAll() {
    void summaryQ.refetch();
    void anomaliesQ.refetch();
    void recommendationsQ.refetch();
    void fraudQ.refetch();
    void segmentationQ.refetch();
    if (eventId) void forecastQ.refetch();
  }

  function proposeRecommendation(recommendation: AiRecommendation) {
    if (proposedIds.has(recommendation.id)) return;
    const impactLabel = recommendation.estimatedImpact
      ? `${formatImpactValue(
          recommendation.estimatedImpact.metric,
          recommendation.estimatedImpact.value,
        )} (${recommendation.estimatedImpact.unit || recommendation.estimatedImpact.metric})`
      : null;
    setProposedActions((prev) => [
      createProposedAction({
        recommendationId: recommendation.id,
        title: recommendation.title,
        action: recommendation.action,
        rationale: recommendation.rationale,
        priority: recommendation.priority,
        kind: recommendation.kind,
        entityLabel: recommendation.entityLabel,
        estimatedImpactLabel: impactLabel,
      }),
      ...prev,
    ]);
    setView('actions');
  }

  function resolveAction(
    actionId: string,
    status: 'confirmed' | 'dismissed',
    note: string,
  ) {
    setProposedActions((prev) =>
      prev.map((row) =>
        row.id === actionId
          ? {
              ...row,
              status,
              note: note || undefined,
              resolvedAt: new Date().toISOString(),
            }
          : row,
      ),
    );
    setReviewingId(null);
  }

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Inteligencia · Copiloto"
        title="IA administrativa"
        description="Chat contextual anclado a métricas y eventos, insights del motor y acciones con confirmación humana. Si el ai-engine no responde, no se inventan cifras."
        actions={
          <div className={styles.toolbar}>
            <SegmentedControl
              label="Periodo"
              size="sm"
              value={rangeKey}
              onValueChange={setRangeKey}
              options={AI_RANGE_OPTIONS.map((key) => ({
                value: key,
                label: buildAiRange(key).label,
              }))}
            />
            <div className={styles.field}>
              <label htmlFor="ai-event">Evento (predicción)</label>
              <select
                id="ai-event"
                value={eventId}
                onChange={(event) => setEventId(event.target.value)}
                disabled={eventsQ.isPending}
              >
                <option value="">Todos / sin evento</option>
                {eventOptions.map((option) => (
                  <option key={option.id} value={option.id}>
                    {option.label}
                  </option>
                ))}
              </select>
            </div>
            <Button variant="secondary" size="sm" onClick={refreshAll}>
              Actualizar
            </Button>
          </div>
        }
      >
        <div className={styles.metaRow}>
          <Badge tone="info" variant="outline">
            {range.label}
          </Badge>
          <Badge tone="neutral" variant="outline">
            America/Mexico_City · MXN
          </Badge>
          <span className={styles.muted}>
            Última generación: {formatGeneratedAt(generatedAt)}
          </span>
        </div>
      </PageHeader>

      {aiUnavailable ? (
        <div className={styles.banner} role="status">
          <strong>Motor de IA no disponible</strong>
          <p>
            Los hooks consultan <code>/ai/summaries/executive</code>,{' '}
            <code>/ai/anomalies</code>, <code>/ai/recommendations</code>,{' '}
            <code>/ai/fraud/risk</code>, <code>/ai/segmentation/customers</code> y{' '}
            <code>/ai/forecast/events/:eventId</code>. Mientras no respondan, la UI
            muestra empty states honestos basados en <code>ai-contracts</code>.
          </p>
        </div>
      ) : null}

      <section className={styles.kpiGrid} aria-label="Indicadores del copiloto">
        <KpiCard
          label="Alertas de anomalía"
          value={anomalyCount === undefined ? '—' : formatNumber(anomalyCount)}
          tone="warning"
          loading={loadingKpis}
          hint={
            anomaliesQ.data
              ? `Umbral z ${formatNumber(anomaliesQ.data.zThreshold, 1)}`
              : 'Requiere GET /ai/anomalies'
          }
        />
        <KpiCard
          label="Insights accionables"
          value={
            recommendationCount === undefined ? '—' : formatNumber(recommendationCount)
          }
          tone="accent"
          loading={loadingKpis}
          hint={
            urgentCount === undefined
              ? 'Requiere GET /ai/recommendations'
              : `${formatNumber(urgentCount)} urgentes/altas`
          }
        />
        <KpiCard
          label="Riesgo alto/crítico"
          value={highFraud === undefined ? '—' : formatNumber(highFraud)}
          tone="danger"
          loading={loadingKpis}
          hint={
            fraudQ.data
              ? `${formatNumber(fraudQ.data.summary.scored)} evaluados`
              : 'Requiere GET /ai/fraud/risk'
          }
        />
        <KpiCard
          label="Ocupación proyectada"
          value={
            projectedOccupancy === undefined
              ? '—'
              : formatPercentPoints(projectedOccupancy)
          }
          tone="info"
          loading={Boolean(eventId) && forecastQ.isPending}
          hint={
            eventId
              ? forecastQ.data?.eventTitle ??
                (projectedRevenue !== undefined
                  ? formatMxn(projectedRevenue)
                  : 'Evento seleccionado')
              : 'Selecciona un evento'
          }
        />
      </section>

      <Tabs
        label="Vistas del copiloto"
        variant="pill"
        value={view}
        onValueChange={(id) => setView(id as AiView)}
        items={[
          { id: 'chat', label: 'Chat contextual' },
          { id: 'insights', label: 'Insights' },
          {
            id: 'actions',
            label: 'Acciones HITL',
            badge: pendingActions > 0 ? String(pendingActions) : undefined,
          },
          { id: 'panels', label: 'Paneles' },
        ]}
      />

      {view === 'chat' ? (
        <Section
          title="Chat anclado a hechos"
          description="Responde solo con métricas y eventos ya cargados. Si falta dato, lo declara."
        >
          <ChatPanel bundle={chatBundle} loading={loadingKpis} />
        </Section>
      ) : null}

      {view === 'insights' ? (
        <div className={styles.gridEqual}>
          <Section
            title="Insights y recomendaciones"
            description="Priorizadas con confianza e impacto solo cuando el motor lo estima. Propón acciones a la cola HITL."
          >
            <RecommendationsPanel
              query={recommendationsQ}
              onPropose={proposeRecommendation}
              proposedIds={proposedIds}
            />
          </Section>
          <Section
            title="Alertas"
            description="Anomalías estadísticas (z-score) sobre ventas, ingresos, reembolsos, pagos y accesos."
          >
            <AnomaliesPanel query={anomaliesQ} />
          </Section>
        </div>
      ) : null}

      {view === 'actions' ? (
        <Section
          title="Cola de confirmación humana"
          description="Ninguna recomendación muta el sistema sola. Confirma o descarta con nota de auditoría."
        >
          <ActionsPanel
            actions={proposedActions}
            onReview={(action) => setReviewingId(action.id)}
          />
        </Section>
      ) : null}

      {view === 'panels' ? (
        <>
          <div className={styles.grid}>
            <Section
              title="Resumen ejecutivo"
              description="Narrativa determinista en español. Solo cita KPIs observados o proyectados por el motor."
            >
              <NarrativePanel query={summaryQ} />
            </Section>

            <Section
              title="Alertas"
              description="Anomalías estadísticas (z-score) sobre ventas, ingresos, reembolsos, pagos y accesos."
            >
              <AnomaliesPanel query={anomaliesQ} />
            </Section>
          </div>

          <div className={styles.gridEqual}>
            <Section
              title="Insights y recomendaciones"
              description="Acciones priorizadas con confianza, suficiencia de datos e impacto estimado cuando sea posible."
            >
              <RecommendationsPanel
                query={recommendationsQ}
                onPropose={proposeRecommendation}
                proposedIds={proposedIds}
              />
            </Section>

            <Section
              title="Predicción de ventas"
              description="Proyección de boletos, ocupación e ingreso bruto con intervalo de confianza."
            >
              <ForecastPanel eventId={eventId || null} query={forecastQ} />
            </Section>
          </div>

          <div className={styles.gridEqual}>
            <Section
              title="Riesgo de fraude"
              description="Scores explicables por orden o usuario. Factores con peso; sin black-box."
            >
              <FraudRiskPanel query={fraudQ} />
            </Section>

            <Section
              title="Segmentación de clientes"
              description="RFM + probabilidad de abandono. Declara insuficiencia cuando no hay historial."
            >
              <SegmentationPanel query={segmentationQ} />
            </Section>
          </div>

          <Section
            title="Gobernanza del copiloto"
            description="Guardrails operativos. El copiloto recomienda; no ejecuta mutaciones."
          >
            <ul className={styles.governanceList}>
              {GOVERNANCE_NOTES.map((note) => (
                <li key={note.title} className={styles.governanceItem}>
                  <strong>{note.title}</strong>
                  <p className={styles.muted}>{note.body}</p>
                </li>
              ))}
            </ul>
          </Section>
        </>
      ) : null}

      <ConfirmActionModal
        open={Boolean(reviewing)}
        action={reviewing}
        onClose={() => setReviewingId(null)}
        onConfirm={(note) => {
          if (reviewing) resolveAction(reviewing.id, 'confirmed', note);
        }}
        onDismiss={(note) => {
          if (reviewing) resolveAction(reviewing.id, 'dismissed', note);
        }}
      />
    </div>
  );
}
