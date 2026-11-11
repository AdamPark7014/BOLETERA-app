'use client';

import { Suspense, useMemo, useState, type ReactNode } from 'react';
import type { AiRecommendation } from '@boletera/shared';
import { TicketButton } from '@boletera/ui';
import {
  useAiAnomalies,
  useAiCustomerSegmentation,
  useAiExecutiveSummary,
  useAiFraudRisk,
  useAiRecommendations,
  useAiSalesForecast,
  useEvents,
} from '@/lib/queries';
import { AnonymousView, NoOrgView, useSession } from '../events/_shared/api-state';
import { AdminFrame } from '../events/_ticket/AdminFrame';
import { Segment, SheetSelect } from '../events/_ticket/controls';
import styles from '../events/_ticket/frame.module.scss';
import { ActionsPanel } from './_components/ActionsPanel';
import { AnomaliesPanel } from './_components/AnomaliesPanel';
import { ChatPanel } from './_components/ChatPanel';
import { ForecastPanel } from './_components/ForecastPanel';
import { FraudRiskPanel } from './_components/FraudRiskPanel';
import { NarrativePanel } from './_components/NarrativePanel';
import { FigureRow } from './_components/PanelState';
import { RecommendationsPanel } from './_components/RecommendationsPanel';
import { SegmentationPanel } from './_components/SegmentationPanel';
import { createProposedAction, type AiProposedAction } from './_lib/actions';
import type { AiChatBundle } from './_lib/chat';
import {
  formatCount,
  formatGeneratedAt,
  formatImpactValue,
  formatMxn,
  formatPercentPoints,
} from './_lib/format';
import { AI_RANGE_OPTIONS, buildAiRange, type AiRangeKey } from './_lib/range';
import { isAiServiceUnavailable } from './_lib/status';

type AiView = 'chat' | 'insights' | 'panels' | 'actions';

const GOVERNANCE_NOTES = [
  {
    title: 'Trazabilidad por respuesta',
    body: 'Cada salida conserva método, rango, muestra y hora de generación. Sin traza no hay acción.',
  },
  {
    title: 'Insuficiencia explícita',
    body: 'Si la muestra es limitada o insuficiente, el copiloto lo declara. Nunca rellena huecos con cifras inventadas.',
  },
  {
    title: 'Recomendar no es cambiar',
    body: 'Las recomendaciones orientan; cambios de precio, campañas o fraude siguen flujos con confirmación humana.',
  },
] as const;

const AI_ENDPOINTS = [
  '/ai/summaries/executive',
  '/ai/anomalies',
  '/ai/recommendations',
  '/ai/fraud/risk',
  '/ai/segmentation/customers',
  '/ai/forecast/events/:eventId',
];

export default function AiPage() {
  return (
    <Suspense fallback={null}>
      <AdminFrame>
        <IaBody />
      </AdminFrame>
    </Suspense>
  );
}

function IaBody() {
  const session = useSession();
  if (session.status === 'anonymous') return <AnonymousView />;
  if (session.status === 'no-org') return <NoOrgView />;
  if (session.status === 'loading') return <p className={styles.quiet}>Cargando IA.</p>;
  return <Copiloto />;
}

function Block({ title, note, children }: { title: string; note: string; children: ReactNode }) {
  return (
    <section className={styles.stack} style={{ marginTop: 24 }}>
      <header className={styles.sectionHead} style={{ marginBottom: 0 }}>
        <p className={styles.rowTitle}>{title}</p>
        <p className={styles.tertiary}>{note}</p>
      </header>
      {children}
    </section>
  );
}

function Copiloto() {
  const [rangeKey, setRangeKey] = useState<AiRangeKey>('30d');
  const [eventId, setEventId] = useState<string>('');
  const [view, setView] = useState<AiView>('chat');
  const [proposedActions, setProposedActions] = useState<AiProposedAction[]>([]);
  const [reviewingId, setReviewingId] = useState<string | null>(null);

  const range = useMemo(() => buildAiRange(rangeKey), [rangeKey]);
  const rangeParams = useMemo(
    () => ({ from: range.from, to: range.to, eventId: eventId || undefined }),
    [eventId, range.from, range.to]
  );

  const eventsQ = useEvents();
  const summaryQ = useAiExecutiveSummary(rangeParams);
  const anomaliesQ = useAiAnomalies(rangeParams);
  const recommendationsQ = useAiRecommendations({ ...rangeParams, limit: 25 });
  const fraudQ = useAiFraudRisk({ ...rangeParams, limit: 50 });
  const segmentationQ = useAiCustomerSegmentation({ ...rangeParams, limit: 100 });
  const forecastQ = useAiSalesForecast(eventId || null, { from: range.from, to: range.to });

  const eventOptions = useMemo(() => {
    const rows = eventsQ.data ?? [];
    return [...rows]
      .sort((a, b) => a.title.localeCompare(b.title, 'es-MX'))
      .map((event) => ({
        id: event.id,
        label: `${event.title}${event.status ? ` · ${event.status}` : ''}`,
      }));
  }, [eventsQ.data]);

  const selectedEventLabel = eventOptions.find((option) => option.id === eventId)?.label ?? null;

  const aiUnavailable =
    isAiServiceUnavailable(summaryQ.error) ||
    isAiServiceUnavailable(anomaliesQ.error) ||
    isAiServiceUnavailable(recommendationsQ.error) ||
    isAiServiceUnavailable(fraudQ.error) ||
    isAiServiceUnavailable(segmentationQ.error) ||
    (Boolean(eventId) && isAiServiceUnavailable(forecastQ.error));

  const loadingKpis =
    summaryQ.isPending || anomaliesQ.isPending || recommendationsQ.isPending || fraudQ.isPending;

  const anomalyCount = anomaliesQ.data?.anomalies.length;
  const recommendationCount = recommendationsQ.data?.recommendations.length;
  const urgentCount = recommendationsQ.data?.recommendations.filter(
    (item) => item.priority === 'urgent' || item.priority === 'high'
  ).length;
  const highFraud = fraudQ.data?.summary.highOrCritical;
  const projectedOccupancy = forecastQ.data?.projectedOccupancyPercent.point;
  const projectedRevenue = forecastQ.data?.projectedGrossRevenue.point;
  const pendingActions = proposedActions.filter(
    (row) => row.status === 'pending_confirmation'
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
    ]
  );

  const proposedIds = useMemo(
    () =>
      new Set(
        proposedActions
          .filter((row) => row.status === 'pending_confirmation')
          .map((row) => row.recommendationId)
      ),
    [proposedActions]
  );

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
      ? `${formatImpactValue(recommendation.estimatedImpact.metric, recommendation.estimatedImpact.value)} (${
          recommendation.estimatedImpact.unit || recommendation.estimatedImpact.metric
        })`
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

  function resolveAction(actionId: string, status: 'confirmed' | 'dismissed', note: string) {
    setProposedActions((prev) =>
      prev.map((row) =>
        row.id === actionId
          ? { ...row, status, note: note || undefined, resolvedAt: new Date().toISOString() }
          : row
      )
    );
    setReviewingId(null);
  }

  const wait = (pending: boolean, value: string) => (pending ? '—' : value);

  return (
    <section>
      <header className={styles.sectionHead}>
        <h1 className={styles.sectionTitle}>IA</h1>
        <p className={styles.quiet}>
          Cálculos deterministas sobre órdenes, reembolsos y señales de fraude reales: agregados,
          reglas estadísticas y plantillas, sin modelo de lenguaje. Lo que no tiene fuente queda
          vacío con su motivo.
        </p>
        <p className={styles.tertiary}>
          {range.label} · America/Mexico_City · MXN · última generación:{' '}
          {formatGeneratedAt(generatedAt)}
        </p>
      </header>

      <div className={styles.stack}>
        <Segment<AiRangeKey>
          label="Periodo"
          value={rangeKey}
          onChange={setRangeKey}
          options={AI_RANGE_OPTIONS.map((key) => ({ value: key, label: buildAiRange(key).label }))}
        />
        <SheetSelect
          label="Evento para la predicción"
          value={eventId}
          placeholder={eventsQ.isPending ? 'Cargando eventos' : 'Todos, sin evento'}
          options={[
            { value: '', label: 'Todos, sin evento' },
            ...eventOptions.map((option) => ({ value: option.id, label: option.label })),
          ]}
          onChange={setEventId}
        />
        <div>
          <TicketButton variant="ghost" onClick={refreshAll}>
            Actualizar
          </TicketButton>
        </div>

        {aiUnavailable ? (
          <div className={styles.stack} role="status">
            <p className={styles.rowTitle}>Motor de IA no disponible</p>
            <p className={styles.quiet}>
              La pantalla consulta {AI_ENDPOINTS.length} rutas del ai-engine. Mientras no respondan,
              cada panel muestra un vacío honesto basado en{' '}
              <span className={styles.mono}>ai-contracts</span>.
            </p>
            <p className={styles.tertiary}>
              {AI_ENDPOINTS.map((path, index) => (
                <span key={path}>
                  {index > 0 ? ' · ' : ''}
                  <span className={styles.mono}>{path}</span>
                </span>
              ))}
            </p>
          </div>
        ) : null}

        <div className={styles.rows}>
          <FigureRow
            label="Alertas de anomalía"
            meta={
              anomaliesQ.data
                ? `Umbral z ${formatCount(anomaliesQ.data.zThreshold, 1)}`
                : 'Requiere /ai/anomalies'
            }
            value={wait(loadingKpis, anomalyCount === undefined ? '—' : formatCount(anomalyCount))}
          />
          <FigureRow
            label="Recomendaciones accionables"
            meta={
              urgentCount === undefined
                ? 'Requiere /ai/recommendations'
                : `${formatCount(urgentCount)} urgentes o altas`
            }
            value={wait(
              loadingKpis,
              recommendationCount === undefined ? '—' : formatCount(recommendationCount)
            )}
          />
          <FigureRow
            label="Riesgo alto o crítico"
            meta={
              fraudQ.data
                ? `${formatCount(fraudQ.data.summary.scored)} evaluados`
                : 'Requiere /ai/fraud/risk'
            }
            value={wait(loadingKpis, highFraud === undefined ? '—' : formatCount(highFraud))}
          />
          <FigureRow
            label="Ocupación proyectada"
            meta={
              eventId
                ? (forecastQ.data?.eventTitle ??
                  (projectedRevenue !== undefined ? formatMxn(projectedRevenue) : 'Evento elegido'))
                : 'Elige un evento'
            }
            value={wait(
              Boolean(eventId) && forecastQ.isPending,
              projectedOccupancy === undefined ? '—' : formatPercentPoints(projectedOccupancy)
            )}
          />
        </div>

        <Segment<AiView>
          label="Vistas del copiloto"
          value={view}
          onChange={setView}
          options={[
            { value: 'chat', label: 'Chat' },
            { value: 'insights', label: 'Recomendaciones' },
            {
              value: 'actions',
              label: pendingActions > 0 ? `Acciones · ${pendingActions}` : 'Acciones',
            },
            { value: 'panels', label: 'Paneles' },
          ]}
        />
      </div>

      {view === 'chat' ? (
        <Block
          title="Chat anclado a hechos"
          note="Responde solo con métricas y eventos ya cargados. Si falta dato, lo declara."
        >
          <ChatPanel bundle={chatBundle} loading={loadingKpis} />
        </Block>
      ) : null}

      {view === 'insights' ? (
        <>
          <Block
            title="Recomendaciones"
            note="Priorizadas con confianza e impacto solo cuando el motor lo estima. Propón acciones a la cola de confirmación."
          >
            <RecommendationsPanel
              query={recommendationsQ}
              onPropose={proposeRecommendation}
              proposedIds={proposedIds}
            />
          </Block>
          <Block
            title="Alertas"
            note="Anomalías estadísticas (z) sobre ventas, ingresos, reembolsos, pagos y accesos."
          >
            <AnomaliesPanel query={anomaliesQ} />
          </Block>
        </>
      ) : null}

      {view === 'actions' ? (
        <Block
          title="Cola de confirmación humana"
          note="Ninguna recomendación cambia el sistema sola. Confirma o descarta con nota de auditoría."
        >
          <ActionsPanel
            actions={proposedActions}
            reviewingId={reviewingId}
            onReview={(action) => setReviewingId(action ? action.id : null)}
            onResolve={resolveAction}
          />
        </Block>
      ) : null}

      {view === 'panels' ? (
        <>
          <Block
            title="Resumen ejecutivo"
            note="Narrativa determinista en español. Solo cita cifras observadas o proyectadas por el motor."
          >
            <NarrativePanel query={summaryQ} />
          </Block>
          <Block
            title="Alertas"
            note="Anomalías estadísticas (z) sobre ventas, ingresos, reembolsos, pagos y accesos."
          >
            <AnomaliesPanel query={anomaliesQ} />
          </Block>
          <Block
            title="Recomendaciones"
            note="Acciones priorizadas con confianza, suficiencia de datos e impacto estimado cuando se puede."
          >
            <RecommendationsPanel
              query={recommendationsQ}
              onPropose={proposeRecommendation}
              proposedIds={proposedIds}
            />
          </Block>
          <Block
            title="Predicción de ventas"
            note="Boletos, ocupación e ingreso bruto con intervalo de confianza."
          >
            <ForecastPanel eventId={eventId || null} query={forecastQ} />
          </Block>
          <Block
            title="Riesgo de fraude"
            note="Puntajes explicables por orden o usuario, con el peso de cada factor."
          >
            <FraudRiskPanel query={fraudQ} />
          </Block>
          <Block
            title="Segmentación de clientes"
            note="RFM y probabilidad de abandono. Declara insuficiencia cuando no hay historial."
          >
            <SegmentationPanel query={segmentationQ} />
          </Block>
          <Block title="Gobernanza del copiloto" note="El copiloto recomienda; no ejecuta cambios.">
            <ul className={styles.rows}>
              {GOVERNANCE_NOTES.map((note) => (
                <li key={note.title} className={styles.row}>
                  <div className={styles.rowMain}>
                    <p className={styles.rowTitle}>{note.title}</p>
                    <p className={styles.rowMeta}>{note.body}</p>
                  </div>
                </li>
              ))}
            </ul>
          </Block>
        </>
      ) : null}
    </section>
  );
}
