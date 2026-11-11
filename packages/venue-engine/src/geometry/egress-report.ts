import type { SeatMapData, SeatMapEgressPolicy } from '@boletera/shared';
import { analyzeCirculation, EGRESS_DEFAULTS, type CirculationAnalysis } from './circulation';
import { migrateToV3 } from './migrate';
import { resolveGeometry } from './resolve';

export const DEFAULT_EGRESS_POLICY: Required<SeatMapEgressPolicy> = {
  longPathUnits: 900,
  slowClearanceMinutes: EGRESS_DEFAULTS.slowClearanceMinutes,
  bottleneckUtilization: 0.85,
  bottleneckSeatLoad: 120,
};

export function resolveEgressPolicy(
  policy?: SeatMapEgressPolicy | null
): Required<SeatMapEgressPolicy> {
  return {
    longPathUnits: policy?.longPathUnits ?? DEFAULT_EGRESS_POLICY.longPathUnits,
    slowClearanceMinutes:
      policy?.slowClearanceMinutes ?? DEFAULT_EGRESS_POLICY.slowClearanceMinutes,
    bottleneckUtilization:
      policy?.bottleneckUtilization ?? DEFAULT_EGRESS_POLICY.bottleneckUtilization,
    bottleneckSeatLoad: policy?.bottleneckSeatLoad ?? DEFAULT_EGRESS_POLICY.bottleneckSeatLoad,
  };
}

function csvEscape(value: string | number | null | undefined): string {
  if (value == null) return '';
  const s = String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function fmt(n: number | null | undefined, digits = 2): string {
  if (n == null || !Number.isFinite(n)) return '';
  return n.toFixed(digits);
}

export type EgressReport = {
  generatedAt: string;
  venueName: string;
  policy: Required<SeatMapEgressPolicy>;
  analysis: CirculationAnalysis;
  summary: {
    hasNetwork: boolean;
    sections: number;
    unreachable: number;
    seatsWithPath: number;
    seatsWithoutPath: number;
    maxPathLength: number | null;
    avgPathLength: number | null;
    clearanceMinutes: number | null;
    maxWalkMinutes: number | null;
    seedMode: CirculationAnalysis['seedMode'];
    exitCount: number;
  };
};

/**
 * Build a structured egress report from SeatMapData (resolve + analyze).
 */
export function buildEgressReport(
  input: SeatMapData | null | undefined,
  opts?: { venueName?: string }
): EgressReport {
  const map = migrateToV3(input ?? { sections: [], version: 3 });
  const scene = resolveGeometry(map);
  const policy = resolveEgressPolicy(map.venue?.egressPolicy);
  const analysis = analyzeCirculation(scene, {
    longPathThreshold: policy.longPathUnits,
    slowClearanceMinutes: policy.slowClearanceMinutes,
    bottleneckSeatThreshold: policy.bottleneckSeatLoad,
  });

  const sectionCount = scene.sections.length;
  // When there is no aisle/stair network, egress.sections stays empty — still report map size.
  const unreachable = analysis.hasNetwork ? analysis.unreachableSections.length : sectionCount;

  return {
    generatedAt: new Date().toISOString(),
    venueName: opts?.venueName ?? map.sections[0]?.name ?? 'venue',
    policy,
    analysis,
    summary: {
      hasNetwork: analysis.hasNetwork,
      sections: sectionCount,
      unreachable,
      seatsWithPath: analysis.egress.totalSeatsWithPath,
      seatsWithoutPath: analysis.egress.totalSeatsWithoutPath,
      maxPathLength: analysis.egress.maxPathLength,
      avgPathLength: analysis.egress.avgPathLength,
      clearanceMinutes: analysis.egress.clearanceMinutes,
      maxWalkMinutes: analysis.egress.maxWalkMinutes,
      seedMode: analysis.seedMode,
      exitCount: analysis.exitCount,
    },
  };
}

/**
 * CSV report with summary + per-section + bottleneck rows.
 * Sections use sheet-like blocks separated by blank lines / type column.
 */
export function exportEgressReportToCsv(report: EgressReport): string {
  const lines: string[] = [];
  lines.push('type,key,value');
  lines.push(`meta,generatedAt,${csvEscape(report.generatedAt)}`);
  lines.push(`meta,venueName,${csvEscape(report.venueName)}`);
  lines.push(`meta,hasNetwork,${report.summary.hasNetwork ? 1 : 0}`);
  lines.push(`meta,sections,${report.summary.sections}`);
  lines.push(`meta,unreachable,${report.summary.unreachable}`);
  lines.push(`meta,seatsWithPath,${report.summary.seatsWithPath}`);
  lines.push(`meta,seatsWithoutPath,${report.summary.seatsWithoutPath}`);
  lines.push(`meta,maxPathLength,${fmt(report.summary.maxPathLength, 1)}`);
  lines.push(`meta,avgPathLength,${fmt(report.summary.avgPathLength, 1)}`);
  lines.push(`meta,clearanceMinutes,${fmt(report.summary.clearanceMinutes)}`);
  lines.push(`meta,maxWalkMinutes,${fmt(report.summary.maxWalkMinutes)}`);
  lines.push(`meta,seedMode,${report.summary.seedMode}`);
  lines.push(`meta,exitCount,${report.summary.exitCount}`);
  lines.push(`policy,longPathUnits,${report.policy.longPathUnits}`);
  lines.push(`policy,slowClearanceMinutes,${report.policy.slowClearanceMinutes}`);
  lines.push(`policy,bottleneckUtilization,${report.policy.bottleneckUtilization}`);
  lines.push(`policy,bottleneckSeatLoad,${report.policy.bottleneckSeatLoad}`);

  lines.push('');
  lines.push(
    'type,sectionId,sectionName,seatCount,pathLength,walkMinutes,queueMinutes,clearanceMinutes,reachable'
  );
  for (const s of report.analysis.egress.sections) {
    const reachable = !report.analysis.unreachableSections.includes(s.sectionId);
    lines.push(
      [
        'section',
        csvEscape(s.sectionId),
        csvEscape(s.sectionName ?? ''),
        s.seatCount,
        fmt(s.pathLength, 1),
        fmt(s.walkMinutes),
        fmt(s.queueMinutes),
        fmt(s.clearanceMinutes),
        reachable ? 1 : 0,
      ].join(',')
    );
  }

  lines.push('');
  lines.push(
    'type,edgeId,kind,width,capacity,seatLoad,sectionCount,utilization,flowPerMinute,clearanceMinutes,overCapacity'
  );
  for (const b of report.analysis.egress.bottlenecks) {
    lines.push(
      [
        'bottleneck',
        csvEscape(b.edgeId),
        b.kind,
        b.width,
        b.capacity,
        b.seatLoad,
        b.sectionCount,
        fmt(b.utilization),
        fmt(b.flowPerMinute, 1),
        fmt(b.clearanceMinutes),
        b.overCapacity ? 1 : 0,
      ].join(',')
    );
  }

  return lines.join('\n') + '\n';
}

export function egressReportFilename(venueName = 'venue'): string {
  const safe = venueName.replace(/[^a-z0-9_-]+/gi, '_').slice(0, 40) || 'venue';
  const day = new Date().toISOString().slice(0, 10);
  return `egress-${safe}-${day}.csv`;
}

/** Convenience: map → CSV string */
export function exportSeatMapEgressCsv(
  input: SeatMapData | null | undefined,
  opts?: { venueName?: string }
): string {
  return exportEgressReportToCsv(buildEgressReport(input, opts));
}

export type EgressHealthStatus = 'ok' | 'warn' | 'critical' | 'no-network' | 'empty';

export type EgressReportSummaryRow = {
  venueName: string;
  hasNetwork: boolean;
  sections: number;
  unreachable: number;
  seatsWithPath: number;
  seatsWithoutPath: number;
  clearanceMinutes: number | null;
  maxPathLength: number | null;
  avgPathLength: number | null;
  topBottleneckUtilization: number | null;
  topBottleneckKind: string | null;
  status: EgressHealthStatus;
  statusReason: string;
};

/**
 * Compact health summary for dashboards (one row per map/report).
 */
export function summarizeEgressReport(report: EgressReport): EgressReportSummaryRow {
  const { summary, policy, analysis } = report;
  const top = analysis.egress.bottlenecks[0];
  const topUtil = top?.utilization ?? null;

  let status: EgressHealthStatus = 'ok';
  let statusReason = 'Sin alertas';

  if (!summary.sections) {
    status = 'empty';
    statusReason = 'Sin secciones';
  } else if (!summary.hasNetwork) {
    status = 'no-network';
    statusReason = 'Sin pasillos/escaleras';
  } else if (
    summary.unreachable > 0 ||
    (summary.clearanceMinutes != null && summary.clearanceMinutes > policy.slowClearanceMinutes) ||
    (top?.overCapacity && (top.sectionCount ?? 0) >= 2)
  ) {
    status = 'critical';
    if (summary.unreachable > 0) statusReason = `${summary.unreachable} sección(es) sin acceso`;
    else if (
      summary.clearanceMinutes != null &&
      summary.clearanceMinutes > policy.slowClearanceMinutes
    ) {
      statusReason = `Vaciado ${summary.clearanceMinutes.toFixed(1)} min > ${policy.slowClearanceMinutes}`;
    } else statusReason = 'Bottleneck sobrecargado';
  } else if (
    (topUtil != null && topUtil >= policy.bottleneckUtilization) ||
    (summary.maxPathLength != null && summary.maxPathLength > policy.longPathUnits)
  ) {
    status = 'warn';
    if (topUtil != null && topUtil >= policy.bottleneckUtilization) {
      statusReason = `Utilización ${(topUtil * 100).toFixed(0)}%`;
    } else statusReason = 'Ruta larga';
  }

  return {
    venueName: report.venueName,
    hasNetwork: summary.hasNetwork,
    sections: summary.sections,
    unreachable: summary.unreachable,
    seatsWithPath: summary.seatsWithPath,
    seatsWithoutPath: summary.seatsWithoutPath,
    clearanceMinutes: summary.clearanceMinutes,
    maxPathLength: summary.maxPathLength,
    avgPathLength: summary.avgPathLength,
    topBottleneckUtilization: topUtil,
    topBottleneckKind: top?.kind ?? null,
    status,
    statusReason,
  };
}

export function exportEgressOverviewCsv(
  rows: Array<EgressReportSummaryRow & { venueId: string }>
): string {
  const header = [
    'venueId',
    'venueName',
    'status',
    'statusReason',
    'hasNetwork',
    'sections',
    'unreachable',
    'seatsWithPath',
    'seatsWithoutPath',
    'clearanceMinutes',
    'maxPathLength',
    'topBottleneckUtilization',
    'topBottleneckKind',
  ].join(',');
  const body = rows.map((r) =>
    [
      csvEscape(r.venueId),
      csvEscape(r.venueName),
      r.status,
      csvEscape(r.statusReason),
      r.hasNetwork ? 1 : 0,
      r.sections,
      r.unreachable,
      r.seatsWithPath,
      r.seatsWithoutPath,
      fmt(r.clearanceMinutes),
      fmt(r.maxPathLength, 1),
      fmt(r.topBottleneckUtilization),
      csvEscape(r.topBottleneckKind ?? ''),
    ].join(',')
  );
  return [header, ...body].join('\n') + '\n';
}
