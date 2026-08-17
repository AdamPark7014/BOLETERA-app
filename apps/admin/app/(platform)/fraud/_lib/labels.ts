import type { BadgeTone } from '@boletera/ui';

const SEVERITY_RANK: Record<string, number> = {
  CRITICAL: 0,
  HIGH: 1,
  MEDIUM: 2,
  LOW: 3,
};

export function severityRank(severity: string): number {
  return SEVERITY_RANK[severity.toUpperCase()] ?? 9;
}

export function severityTone(severity: string): BadgeTone {
  switch (severity.toUpperCase()) {
    case 'CRITICAL':
      return 'danger';
    case 'HIGH':
      return 'warning';
    case 'MEDIUM':
      return 'info';
    default:
      return 'neutral';
  }
}

export function statusTone(status: string): BadgeTone {
  switch (status.toUpperCase()) {
    case 'RESOLVED':
    case 'CONVERTED':
    case 'SOLD':
    case 'ACTIVE':
    case 'NOTIFIED':
      return 'success';
    case 'FLAGGED':
    case 'INVESTIGATING':
    case 'PENDING':
      return 'warning';
    case 'FALSE_POSITIVE':
    case 'CANCELLED':
    case 'EXPIRED':
    case 'DELISTED':
      return 'neutral';
    default:
      return 'neutral';
  }
}

export function fraudTypeLabel(type: string): string {
  const map: Record<string, string> = {
    SUSPICIOUS_ACTIVITY: 'Actividad sospechosa',
    VELOCITY: 'Velocidad anormal',
    CARD_TESTING: 'Prueba de tarjetas',
    DUPLICATE_PURCHASE: 'Compra duplicada',
    BOT: 'Bot / automatización',
    CHARGEBACK_RISK: 'Riesgo de chargeback',
    ACCOUNT_TAKEOVER: 'Toma de cuenta',
    SCALPING: 'Escalamiento',
  };
  return map[type] ?? type.replaceAll('_', ' ');
}

export function waitlistStatusLabel(status: string): string {
  const map: Record<string, string> = {
    PENDING: 'En espera',
    NOTIFIED: 'Notificado',
    CONVERTED: 'Convertido',
    EXPIRED: 'Expirado',
    CANCELLED: 'Cancelado',
  };
  return map[status] ?? status;
}

export function resaleStatusLabel(status: string): string {
  const map: Record<string, string> = {
    ACTIVE: 'Activo',
    SOLD: 'Vendido',
    CANCELLED: 'Cancelado',
    DELISTED: 'Retirado',
  };
  return map[status] ?? status;
}
