import type { BadgeTone, TimelineTone } from '@boletera/ui';

/** Acciones consideradas sensibles para compliance / forensics. */
export const SENSITIVE_ACTIONS = new Set([
  'AUTH_LOGIN_FAILED',
  'AUTH_REFRESH_REUSE_DETECTED',
  'AUTH_PASSWORD_RESET',
  'AUTH_ALL_SESSIONS_REVOKED',
  'REFUND_MANUAL_COMPLETED',
  'TEAM_MEMBER_INVITED',
  'TEAM_MEMBER_UPDATED',
  'ORG_UPDATED',
  'EVENT_CANCELLED',
  'EVENT_RESCHEDULED',
  'EVENT_SALE_WINDOWS_UPDATED',
  'CFDI_STAMPED',
  'pricing.recommendations.applied',
  'pricing.recommendation.approved',
  'pricing.recommendation.rejected',
]);

const ACTION_LABELS: Record<string, string> = {
  AUTH_LOGIN_FAILED: 'Login fallido',
  AUTH_LOGIN_SUCCEEDED: 'Login exitoso',
  AUTH_OAUTH_LOGIN_SUCCEEDED: 'Login OAuth',
  AUTH_PASSWORD_RESET: 'Reset de contraseña',
  AUTH_REFRESH_REUSE_DETECTED: 'Reuso de refresh token',
  AUTH_LOGOUT: 'Cierre de sesión',
  AUTH_ALL_SESSIONS_REVOKED: 'Revocación de sesiones',
  REFUND_MANUAL_COMPLETED: 'Reembolso manual',
  TEAM_MEMBER_INVITED: 'Invitación a equipo',
  TEAM_MEMBER_UPDATED: 'Actualización de miembro',
  ORG_UPDATED: 'Organización actualizada',
  EVENT_SERIES_CREATED: 'Serie creada',
  EVENT_SCHEDULED: 'Evento programado',
  EVENT_SERIES_EXTENDED: 'Serie extendida',
  EVENT_RESCHEDULED: 'Evento reprogramado',
  EVENT_CANCELLED: 'Evento cancelado',
  EVENT_SALE_WINDOWS_UPDATED: 'Ventanas de venta',
  SEASON_PASS_CREATED: 'Pase de temporada',
  WAITLIST_JOIN: 'Alta en waitlist',
  WAITLIST_NOTIFY_BATCH: 'Notificación waitlist',
  CFDI_STAMPED: 'CFDI timbrado',
  'order.completed': 'Orden completada',
  'ticket.scan': 'Escaneo de boleto',
  'pricing.recommendations.generated': 'Pricing generado',
  'pricing.recommendations.applied': 'Pricing aplicado',
  'pricing.recommendation.approved': 'Pricing aprobado',
  'pricing.recommendation.rejected': 'Pricing rechazado',
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action.replace(/[._]/g, ' ');
}

export function isSensitiveAction(action: string): boolean {
  if (SENSITIVE_ACTIONS.has(action)) return true;
  const upper = action.toUpperCase();
  return (
    upper.includes('REFUND') ||
    upper.includes('REVOKE') ||
    upper.includes('PASSWORD') ||
    upper.includes('FAILED') ||
    upper.includes('CANCEL') ||
    upper.includes('DELETE') ||
    upper.includes('REUSE')
  );
}

export function actionTone(action: string): BadgeTone {
  if (/FAILED|REUSE|CANCEL|REJECT/i.test(action)) return 'danger';
  if (/REFUND|REVOKE|PASSWORD|DELETE/i.test(action)) return 'warning';
  if (/LOGIN_SUCCEEDED|COMPLETED|STAMPED|APPROVED|CREATED|SCHEDULED/i.test(action)) {
    return 'success';
  }
  return 'neutral';
}

export function timelineTone(action: string): TimelineTone {
  const tone = actionTone(action);
  if (tone === 'accent') return 'accent';
  return tone;
}

export function entityLabel(entityType: string): string {
  const map: Record<string, string> = {
    User: 'Usuario',
    Organization: 'Organización',
    Event: 'Evento',
    EventSeries: 'Serie',
    Order: 'Orden',
    Ticket: 'Boleto',
    Payment: 'Pago',
    Campaign: 'Campaña',
    Venue: 'Venue',
    SeasonPass: 'Pase',
    Waitlist: 'Waitlist',
  };
  return map[entityType] ?? entityType;
}
