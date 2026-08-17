import type {
  AiAnomaliesResponse,
  AiExecutiveNarrativeResponse,
  AiFraudRiskResponse,
  AiRecommendationsResponse,
  AiSalesForecastResponse,
  AiSegmentationResponse,
} from '@boletera/shared';
import {
  formatCount,
  formatImpactValue,
  formatMxn,
  formatPercentPoints,
} from './format';
import {
  anomalyMetricLabel,
  fraudBandLabel,
  impactMetricLabel,
  priorityLabel,
  recommendationKindLabel,
  segmentLabel,
  sufficiencyLabel,
} from './labels';

export type AiChatRole = 'user' | 'assistant' | 'system';

export type AiChatCitation = {
  source: string;
  detail: string;
};

export type AiChatMessage = {
  id: string;
  role: AiChatRole;
  content: string;
  citations?: readonly AiChatCitation[];
  createdAt: string;
};

export type AiGroundedContext = {
  rangeLabel: string;
  eventLabel: string | null;
  facts: string[];
  citations: AiChatCitation[];
  unavailable: string[];
};

export type AiChatBundle = {
  rangeLabel: string;
  eventLabel: string | null;
  summary?: AiExecutiveNarrativeResponse;
  anomalies?: AiAnomaliesResponse;
  recommendations?: AiRecommendationsResponse;
  fraud?: AiFraudRiskResponse;
  segmentation?: AiSegmentationResponse;
  forecast?: AiSalesForecastResponse;
  unavailable: readonly string[];
};

function pushFact(
  facts: string[],
  citations: AiChatCitation[],
  source: string,
  detail: string,
): void {
  facts.push(detail);
  citations.push({ source, detail });
}

export function buildGroundedContext(bundle: AiChatBundle): AiGroundedContext {
  const facts: string[] = [];
  const citations: AiChatCitation[] = [];

  facts.push(`Periodo analizado: ${bundle.rangeLabel}.`);
  if (bundle.eventLabel) {
    facts.push(`Evento en foco: ${bundle.eventLabel}.`);
  }

  const summary = bundle.summary;
  if (summary) {
    pushFact(
      facts,
      citations,
      'Resumen ejecutivo',
      `Narrativa: ${summary.narrative.trim() || 'sin texto'}`,
    );
    for (const kpi of summary.kpisCited.slice(0, 6)) {
      const unit =
        kpi.unit === 'mxn'
          ? formatMxn(kpi.value)
          : kpi.unit === 'percent'
            ? formatPercentPoints(kpi.value)
            : kpi.unit === 'ratio'
              ? formatPercentPoints(kpi.value * 100)
              : formatCount(kpi.value);
      pushFact(
        facts,
        citations,
        'KPI citado',
        `${kpi.label}: ${unit}${
          kpi.deltaPercent === null
            ? ''
            : ` (Δ ${kpi.deltaPercent >= 0 ? '+' : ''}${formatCount(kpi.deltaPercent, 1)} %)`
        }`,
      );
    }
    for (const item of summary.highlights.slice(0, 4)) {
      pushFact(facts, citations, 'Highlight', item);
    }
    for (const item of summary.watchouts.slice(0, 4)) {
      pushFact(facts, citations, 'Watchout', item);
    }
  }

  const anomalies = bundle.anomalies;
  if (anomalies) {
    pushFact(
      facts,
      citations,
      'Anomalías',
      `${formatCount(anomalies.anomalies.length)} alertas · ${sufficiencyLabel(anomalies.sufficiency)} · z ≥ ${formatCount(anomalies.zThreshold, 1)}`,
    );
    for (const row of anomalies.anomalies.slice(0, 5)) {
      pushFact(
        facts,
        citations,
        'Anomalía',
        `${anomalyMetricLabel(row.metric)} (${row.direction}, ${row.severity}): observado ${formatCount(row.observed, 2)}, z ${formatCount(row.zScore, 2)}${row.eventTitle ? ` · ${row.eventTitle}` : ''}`,
      );
    }
  }

  const recommendations = bundle.recommendations;
  if (recommendations) {
    pushFact(
      facts,
      citations,
      'Recomendaciones',
      `${formatCount(recommendations.recommendations.length)} insights accionables`,
    );
    for (const rec of recommendations.recommendations.slice(0, 6)) {
      const impact = rec.estimatedImpact
        ? ` · impacto ${formatImpactValue(rec.estimatedImpact.metric, rec.estimatedImpact.value)} (${impactMetricLabel(rec.estimatedImpact.metric)})`
        : ' · impacto no estimable';
      pushFact(
        facts,
        citations,
        'Insight',
        `${priorityLabel(rec.priority)} · ${recommendationKindLabel(rec.kind)}: ${rec.title}${impact}`,
      );
    }
  }

  const fraud = bundle.fraud;
  if (fraud) {
    pushFact(
      facts,
      citations,
      'Fraude',
      `${formatCount(fraud.summary.scored)} evaluados · ${formatCount(fraud.summary.highOrCritical)} alto/crítico · score medio ${formatCount(fraud.summary.averageScore, 2)}`,
    );
    for (const score of fraud.scores.slice(0, 4)) {
      pushFact(
        facts,
        citations,
        'Riesgo',
        `${score.subjectType} ${score.subjectId}: banda ${fraudBandLabel(score.band)} (${formatCount(score.score, 2)})`,
      );
    }
  }

  const segmentation = bundle.segmentation;
  if (segmentation) {
    pushFact(
      facts,
      citations,
      'Segmentación',
      `${sufficiencyLabel(segmentation.sufficiency)} · muestra ${formatCount(segmentation.sampleSize)}`,
    );
    for (const row of segmentation.segments.slice(0, 6)) {
      pushFact(
        facts,
        citations,
        'Segmento',
        `${segmentLabel(row.segment)}: ${formatCount(row.count)} (${formatPercentPoints(row.percentOfTotal)}) · ticket medio ${formatMxn(row.averageMonetaryMxn)}`,
      );
    }
  }

  const forecast = bundle.forecast;
  if (forecast) {
    pushFact(
      facts,
      citations,
      'Pronóstico',
      `${forecast.eventTitle}: ocupación actual ${formatPercentPoints(forecast.occupancyPercent)}; proyectada ${formatPercentPoints(forecast.projectedOccupancyPercent.point)} (${formatPercentPoints(forecast.projectedOccupancyPercent.lower)}–${formatPercentPoints(forecast.projectedOccupancyPercent.upper)}); ingreso proyectado ${formatMxn(forecast.projectedGrossRevenue.point)}`,
    );
  }

  return {
    rangeLabel: bundle.rangeLabel,
    eventLabel: bundle.eventLabel,
    facts,
    citations,
    unavailable: [...bundle.unavailable],
  };
}

const PROMPTS: Array<{
  id: string;
  label: string;
  match: RegExp;
  answer: (ctx: AiGroundedContext) => string;
}> = [
  {
    id: 'summary',
    label: 'Resume el periodo',
    match: /resumen|narrativa|ejecutivo|periodo|cómo vamos|como vamos/i,
    answer: (ctx) => {
      const narrative = ctx.citations.find((c) => c.source === 'Resumen ejecutivo');
      if (!narrative) {
        return 'No hay resumen ejecutivo cargado. Cuando GET /ai/summaries/executive responda, podré citarlo aquí sin inventar cifras.';
      }
      return [
        `Periodo ${ctx.rangeLabel}${ctx.eventLabel ? ` · ${ctx.eventLabel}` : ''}.`,
        narrative.detail.replace(/^Narrativa:\s*/, ''),
        ctx.unavailable.length > 0
          ? `Fuentes aún no disponibles: ${ctx.unavailable.join(', ')}.`
          : null,
      ]
        .filter((line): line is string => Boolean(line))
        .join('\n\n');
    },
  },
  {
    id: 'anomalies',
    label: '¿Hay anomalías?',
    match: /anomal|alerta|pico|ca[ií]da|z-?score/i,
    answer: (ctx) => {
      const rows = ctx.citations.filter((c) => c.source === 'Anomalía' || c.source === 'Anomalías');
      if (rows.length === 0) {
        return 'No hay datos de anomalías en contexto. El panel solo muestra picos/caídas cuando el motor responde; no invento alertas.';
      }
      return ['Alertas observadas (solo hechos del motor):', ...rows.map((r) => `• ${r.detail}`)].join(
        '\n',
      );
    },
  },
  {
    id: 'recommendations',
    label: '¿Qué recomiendas?',
    match: /recomiend|insight|accion|acción|qu[eé] hacer|prioriz/i,
    answer: (ctx) => {
      const rows = ctx.citations.filter((c) => c.source === 'Insight' || c.source === 'Recomendaciones');
      if (rows.length === 0) {
        return 'No hay recomendaciones cargadas. Cuando existan, aparecerán con prioridad e impacto estimado solo si el motor lo calcula.';
      }
      return [
        'Insights accionables (requieren confirmación humana antes de mutar):',
        ...rows.map((r) => `• ${r.detail}`),
      ].join('\n');
    },
  },
  {
    id: 'fraud',
    label: 'Riesgo de fraude',
    match: /fraude|riesgo|score/i,
    answer: (ctx) => {
      const rows = ctx.citations.filter((c) => c.source === 'Fraude' || c.source === 'Riesgo');
      if (rows.length === 0) {
        return 'Sin puntuaciones de fraude en el contexto actual. No invento scores.';
      }
      return ['Riesgo reportado por el motor:', ...rows.map((r) => `• ${r.detail}`)].join('\n');
    },
  },
  {
    id: 'forecast',
    label: 'Pronóstico del evento',
    match: /pron[oó]st|predic|ocupaci[oó]n|forecast|proyec/i,
    answer: (ctx) => {
      const row = ctx.citations.find((c) => c.source === 'Pronóstico');
      if (!row) {
        return ctx.eventLabel
          ? `Hay un evento seleccionado (${ctx.eventLabel}), pero aún no hay proyección cargada. Selecciona el evento y espera GET /ai/forecast/events/:id.`
          : 'Selecciona un evento en la barra superior para consultar ocupación e ingreso proyectados. Sin evento no hay pronóstico.';
      }
      return row.detail;
    },
  },
  {
    id: 'segments',
    label: 'Segmentos de clientes',
    match: /segment|rfm|churn|clientes|audiencia/i,
    answer: (ctx) => {
      const rows = ctx.citations.filter(
        (c) => c.source === 'Segmentación' || c.source === 'Segmento',
      );
      if (rows.length === 0) {
        return 'Sin segmentación en contexto. Con historial insuficiente el motor lo declara; no fabrico RFM.';
      }
      return ['Segmentación observada:', ...rows.map((r) => `• ${r.detail}`)].join('\n');
    },
  },
];

export const AI_CHAT_SUGGESTIONS = PROMPTS.map((p) => ({
  id: p.id,
  label: p.label,
}));

export function answerFromContext(
  question: string,
  ctx: AiGroundedContext,
): { content: string; citations: AiChatCitation[] } {
  const trimmed = question.trim();
  if (!trimmed) {
    return {
      content: 'Escribe una pregunta sobre métricas, anomalías, fraude, segmentos o el pronóstico del evento seleccionado.',
      citations: [],
    };
  }

  if (ctx.facts.length <= 1 && ctx.unavailable.length > 0) {
    return {
      content: `Todavía no hay hechos del motor en este periodo. Fuentes pendientes: ${ctx.unavailable.join(', ')}. Prefiero dejar el chat vacío a inventar números.`,
      citations: [],
    };
  }

  const prompt = PROMPTS.find((p) => p.match.test(trimmed));
  if (prompt) {
    return {
      content: prompt.answer(ctx),
      citations: ctx.citations.slice(0, 8),
    };
  }

  const keywords = trimmed
    .toLowerCase()
    .normalize('NFD')
    .replace(/\p{M}/gu, '')
    .split(/\s+/)
    .filter((token) => token.length > 3);

  const matched = ctx.citations.filter((citation) => {
    const hay = citation.detail.toLowerCase();
    return keywords.some((token) => hay.includes(token));
  });

  if (matched.length > 0) {
    return {
      content: [
        'Solo puedo citar hechos ya cargados del motor. Coincidencias:',
        ...matched.slice(0, 6).map((row) => `• [${row.source}] ${row.detail}`),
      ].join('\n'),
      citations: matched.slice(0, 6),
    };
  }

  return {
    content: [
      'No encontré esa cifra en el contexto cargado. Prueba con: resumen, anomalías, recomendaciones, fraude, segmentos o pronóstico.',
      ctx.unavailable.length > 0
        ? `Pendientes: ${ctx.unavailable.join(', ')}.`
        : `Hechos disponibles: ${formatCount(ctx.facts.length)}.`,
    ].join('\n\n'),
    citations: [],
  };
}

export function createMessage(
  role: AiChatRole,
  content: string,
  citations?: readonly AiChatCitation[],
): AiChatMessage {
  return {
    id: `${role}-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
    role,
    content,
    citations,
    createdAt: new Date().toISOString(),
  };
}
