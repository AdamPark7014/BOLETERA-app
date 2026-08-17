import type {
  MetricsAlert,
  MetricsAlertSeverity,
  MetricsDimensionRow,
  MetricsGranularity,
  MetricsTimePoint,
} from '@boletera/shared';
import type { TeamMember } from '@/lib/queries/organization';
import type { BadgeTone, ChartSeries, DonutSlice } from '@boletera/ui';
import { ACCESS_ROLES, accessRoleLabel, type AccessRole } from './roles';

export type AccessTab = 'doors' | 'policies' | 'devices' | 'throughput' | 'incidents';

export type EffectivePolicy = {
  id: string;
  name: string;
  description: string;
  status: 'activa' | 'parcial' | 'sin cobertura';
  tone: BadgeTone;
  assigned: number;
  permissions: readonly string[];
  role: AccessRole;
};

export function buildEffectivePolicies(team: readonly TeamMember[]): EffectivePolicy[] {
  return ACCESS_ROLES.map((role) => {
    const assigned = team.filter((member) => member.active && member.role === role.value).length;
    const status: EffectivePolicy['status'] =
      assigned === 0 ? 'sin cobertura' : assigned === 1 ? 'parcial' : 'activa';
    const tone: BadgeTone =
      status === 'activa' ? 'success' : status === 'parcial' ? 'warning' : 'neutral';
    return {
      id: `policy-${role.value}`,
      name: `Política · ${role.label}`,
      description: role.summary,
      status,
      tone,
      assigned,
      permissions: role.permissions,
      role: role.value,
    };
  });
}

export type DeviceRow = {
  id: string;
  label: string;
  checkIns: number;
  share: number;
  tone: BadgeTone;
  statusLabel: string;
};

function deviceTone(share: number): BadgeTone {
  if (share >= 40) return 'success';
  if (share >= 15) return 'accent';
  if (share >= 5) return 'warning';
  return 'neutral';
}

function deviceStatus(share: number): string {
  if (share >= 15) return 'Activo';
  if (share >= 5) return 'Bajo tráfico';
  return 'Residual';
}

export function buildDevices(
  rows: readonly MetricsDimensionRow[],
  total: number,
): DeviceRow[] {
  return rows.map((row) => {
    const share =
      row.percentOfTotal ?? (total > 0 ? Math.round((row.value / total) * 1000) / 10 : 0);
    return {
      id: row.key,
      label: row.label || row.key,
      checkIns: row.value,
      share,
      tone: deviceTone(share),
      statusLabel: deviceStatus(share),
    };
  });
}

export function privilegeSlices(team: readonly TeamMember[]): DonutSlice[] {
  return ACCESS_ROLES.map((role) => ({
    id: role.value,
    label: accessRoleLabel(role.value),
    value: team.filter((member) => member.active && member.role === role.value).length,
  })).filter((slice) => slice.value > 0);
}

export function checkInSeries(
  points: readonly MetricsTimePoint[],
  granularity: MetricsGranularity,
): ChartSeries[] {
  if (points.length === 0) return [];
  return [
    {
      id: 'checkins',
      name: 'Check-ins',
      data: points.map((point) => ({
        label: point.label ?? formatBucketLabel(point.bucket, granularity),
        value: point.value,
      })),
    },
  ];
}

function formatBucketLabel(iso: string, granularity: MetricsGranularity): string {
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return iso;
  if (granularity === 'hour') {
    return new Intl.DateTimeFormat('es-MX', {
      hour: '2-digit',
      minute: '2-digit',
    }).format(date);
  }
  return new Intl.DateTimeFormat('es-MX', {
    month: 'short',
    day: '2-digit',
  }).format(date);
}

export function alertTone(severity: MetricsAlertSeverity): BadgeTone {
  if (severity === 'critical') return 'danger';
  if (severity === 'warning') return 'warning';
  return 'info';
}

export function accessIncidents(alerts: readonly MetricsAlert[]): MetricsAlert[] {
  return alerts.filter((alert) => alert.domain === 'access');
}

export type DoorRow = {
  id: string;
  label: string;
  checkIns: number;
  share: number;
  zoneHint: string;
};

export function buildDoors(
  rows: readonly MetricsDimensionRow[],
  total: number,
): DoorRow[] {
  return rows.map((row) => {
    const share =
      row.percentOfTotal ?? (total > 0 ? Math.round((row.value / total) * 1000) / 10 : 0);
    const zone =
      typeof row.metadata?.zone === 'string'
        ? row.metadata.zone
        : typeof row.metadata?.area === 'string'
          ? row.metadata.area
          : 'Zona operativa';
    return {
      id: row.key,
      label: row.label || row.key,
      checkIns: row.value,
      share,
      zoneHint: zone,
    };
  });
}
