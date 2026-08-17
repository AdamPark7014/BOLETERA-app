import type { EgressOverviewVenue } from '@/lib/platform-api';
import type { BadgeTone } from '@boletera/ui';

export type EgressStatus = EgressOverviewVenue['status'];

export type EgressSeverityRank = 0 | 1 | 2 | 3 | 4;

export type EgressRiskCard = {
  venueId: string;
  venueName: string;
  status: EgressStatus;
  severity: EgressSeverityRank;
  headline: string;
  narrative: string;
  actions: readonly string[];
  statusReason: string;
};

export const STATUS_LABEL: Record<EgressStatus, string> = {
  ok: 'OK',
  warn: 'Alerta',
  critical: 'Crítico',
  'no-network': 'Sin red',
  empty: 'Vacío',
};

export function statusTone(status: EgressStatus): BadgeTone {
  switch (status) {
    case 'ok':
      return 'success';
    case 'warn':
      return 'warning';
    case 'critical':
      return 'danger';
    case 'no-network':
      return 'neutral';
    case 'empty':
      return 'info';
  }
}

/** Mayor número = mayor severidad operativa. */
export function severityRank(status: EgressStatus): EgressSeverityRank {
  switch (status) {
    case 'critical':
      return 4;
    case 'warn':
      return 3;
    case 'no-network':
      return 2;
    case 'empty':
      return 1;
    case 'ok':
      return 0;
  }
}

export function severityLabel(rank: EgressSeverityRank): string {
  switch (rank) {
    case 4:
      return 'Severidad alta';
    case 3:
      return 'Severidad media';
    case 2:
      return 'Configuración incompleta';
    case 1:
      return 'Sin layout';
    case 0:
      return 'Sin riesgo';
  }
}

function clearanceNarrative(minutes: number | null): string {
  if (minutes == null || !Number.isFinite(minutes)) {
    return 'No hay estimación de vaciado disponible.';
  }
  if (minutes > 12) {
    return `El vaciado estimado es de ${minutes.toFixed(1)} min, por encima de un umbral operativo cómodo.`;
  }
  if (minutes > 8) {
    return `El vaciado estimado es de ${minutes.toFixed(1)} min; conviene revisar cuellos de botella.`;
  }
  return `El vaciado estimado es de ${minutes.toFixed(1)} min.`;
}

function bottleneckNarrative(venue: EgressOverviewVenue): string {
  if (venue.topBottleneckUtilization == null) {
    return 'Sin cuello de botella dominante reportado.';
  }
  const pct = Math.round(venue.topBottleneckUtilization * 100);
  const kind = venue.topBottleneckKind ? ` (${venue.topBottleneckKind})` : '';
  if (pct >= 90) {
    return `Hay un bottleneck saturado al ${pct}%${kind} que puede frenar la evacuación.`;
  }
  if (pct >= 70) {
    return `El bottleneck principal opera al ${pct}%${kind}.`;
  }
  return `Utilización del bottleneck principal: ${pct}%${kind}.`;
}

export function buildActions(venue: EgressOverviewVenue): readonly string[] {
  switch (venue.status) {
    case 'critical':
      return [
        'Abrir el mapa y corregir secciones sin ruta a salida.',
        'Revisar bottlenecks y ampliar capacidad de pasillos o puertas.',
        'Re-analizar egress tras guardar el layout y exportar evidencia CSV/PDF.',
      ];
    case 'warn':
      return [
        'Validar rutas largas y tiempo de vaciado en el editor de mapa.',
        'Priorizar secciones con asientos sin path o clearance elevado.',
        'Documentar mitigaciones operativas si el layout no puede cambiar antes del evento.',
      ];
    case 'no-network':
      return [
        'Conectar secciones y salidas en una red de circulación continua.',
        'Verificar que puertas/exits estén marcadas como nodos de egress.',
        'Volver a ejecutar el análisis cuando la topología esté completa.',
      ];
    case 'empty':
      return [
        'Cargar o dibujar un layout de asientos para el venue.',
        'Publicar el layout guardado antes de exigir el reporte de cumplimiento.',
      ];
    case 'ok':
      return [
        'Mantener el layout versionado y re-validar tras cambios de aforo.',
        'Exportar el overview CSV como evidencia de cumplimiento periódico.',
      ];
  }
}

export function buildNarrative(venue: EgressOverviewVenue): string {
  const parts = [venue.statusReason.trim(), clearanceNarrative(venue.clearanceMinutes), bottleneckNarrative(venue)];
  if (venue.unreachable > 0) {
    parts.push(`${venue.unreachable} sección(es) sin acceso a salida.`);
  }
  if (venue.seatsWithoutPath > 0) {
    parts.push(`${venue.seatsWithoutPath} asiento(s) sin path calculado.`);
  }
  return parts.filter(Boolean).join(' ');
}

export function buildRiskCard(venue: EgressOverviewVenue): EgressRiskCard {
  const severity = severityRank(venue.status);
  return {
    venueId: venue.venueId,
    venueName: venue.venueName,
    status: venue.status,
    severity,
    headline: `${STATUS_LABEL[venue.status]} · ${severityLabel(severity)}`,
    narrative: buildNarrative(venue),
    actions: buildActions(venue),
    statusReason: venue.statusReason,
  };
}

export function prioritizeRisks(venues: readonly EgressOverviewVenue[]): EgressRiskCard[] {
  return venues
    .filter((v) => v.status !== 'ok')
    .map(buildRiskCard)
    .sort((a, b) => b.severity - a.severity || a.venueName.localeCompare(b.venueName, 'es'));
}

export function fmtNum(n: number | null | undefined, digits = 1): string {
  if (n == null || !Number.isFinite(n)) return '—';
  return n.toLocaleString('es-MX', {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
}
