import type { MetricsAlert, MetricsAlertDomain, MetricsAlertSeverity } from '@boletera/shared';

export function alertHref(entityType?: string, entityId?: string): string | null {
  switch (entityType) {
    case 'event':
      return entityId ? `/events/${entityId}` : '/events';
    case 'offer':
      return '/events';
    case 'promotion':
      return '/campaigns';
    case 'fraud':
      return '/fraud';
    case 'order':
      return entityId ? `/orders/${entityId}` : '/orders';
    default:
      return null;
  }
}

export function domainHref(domain: MetricsAlertDomain | string): string {
  switch (domain) {
    case 'fraud':
      return '/fraud';
    case 'campaigns':
      return '/campaigns';
    case 'orders':
      return '/orders';
    case 'settlements':
      return '/payouts';
    case 'waitlist':
      return '/waitlist';
    case 'resale':
      return '/resale';
    case 'inventory':
    case 'events':
    case 'access':
      return '/events';
    default:
      return '/analytics';
  }
}

export function resolveAlertHref(alert: MetricsAlert): string {
  return alertHref(alert.entityType, alert.entityId) ?? domainHref(alert.domain);
}

export function severityLabel(severity: MetricsAlertSeverity): string {
  switch (severity) {
    case 'critical':
      return 'Crítica';
    case 'warning':
      return 'Atención';
    case 'info':
      return 'Info';
    default:
      return severity;
  }
}

export function domainLabel(domain: MetricsAlertDomain | string): string {
  switch (domain) {
    case 'executive':
      return 'Ejecutivo';
    case 'events':
      return 'Eventos';
    case 'inventory':
      return 'Inventario';
    case 'orders':
      return 'Órdenes';
    case 'access':
      return 'Acceso';
    case 'resale':
      return 'Reventa';
    case 'waitlist':
      return 'Lista de espera';
    case 'campaigns':
      return 'Campañas';
    case 'fraud':
      return 'Antifraude';
    case 'settlements':
      return 'Liquidaciones';
    default:
      return domain;
  }
}

const SEVERITY_ORDER: Record<MetricsAlertSeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

export function sortAlerts(alerts: readonly MetricsAlert[]): MetricsAlert[] {
  return [...alerts].sort((a, b) => {
    const bySev = SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity];
    if (bySev !== 0) return bySev;
    return b.detectedAt.localeCompare(a.detectedAt);
  });
}
