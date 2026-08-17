import type { AuditRecord } from './anomalies';
import { actionLabel, entityLabel } from './labels';

function csvCell(value: string | number | null | undefined): string {
  const raw = value == null ? '' : String(value);
  if (/[",\n\r]/.test(raw)) return `"${raw.replace(/"/g, '""')}"`;
  return raw;
}

/** Exportación CSV client-side (la API de audit no expone endpoint de export). */
export function auditEntriesToCsv(entries: readonly AuditRecord[]): string {
  const headers = [
    'Fecha',
    'Acción',
    'Acción (label)',
    'Entidad',
    'Entidad (label)',
    'Entity ID',
    'User ID',
    'IP',
    'Metadata',
  ];
  const lines = entries.map((entry) =>
    [
      entry.createdAt,
      entry.action,
      actionLabel(entry.action),
      entry.entityType,
      entityLabel(entry.entityType),
      entry.entityId ?? '',
      entry.userId ?? '',
      entry.ipAddress ?? '',
      entry.metadata ? JSON.stringify(entry.metadata) : '',
    ]
      .map(csvCell)
      .join(','),
  );
  return `\uFEFF${[headers.map(csvCell).join(','), ...lines].join('\n')}`;
}

export function downloadAuditCsv(entries: readonly AuditRecord[], organizationId: string) {
  const csv = auditEntriesToCsv(entries);
  const blob = new Blob([csv], { type: 'text/csv;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  const stamp = new Date().toISOString().slice(0, 10);
  anchor.href = url;
  anchor.download = `audit-${organizationId}-${stamp}.csv`;
  anchor.rel = 'noopener';
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(url);
}
