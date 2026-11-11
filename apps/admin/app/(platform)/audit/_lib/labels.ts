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
  WAITLIST_JOIN: 'Alta en lista de espera',
  WAITLIST_NOTIFY_BATCH: 'Aviso de lista de espera',
  CFDI_STAMPED: 'CFDI timbrado',
  'order.completed': 'Orden completada',
  'ticket.scan': 'Escaneo de boleto',
  'pricing.recommendations.generated': 'Precios generados',
  'pricing.recommendations.applied': 'Precios aplicados',
  'pricing.recommendation.approved': 'Precio aprobado',
  'pricing.recommendation.rejected': 'Precio rechazado',
};

export function actionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action.replace(/[._]/g, ' ');
}

const ENTITY_LABELS: Record<string, string> = {
  User: 'Usuario',
  Organization: 'Organización',
  Event: 'Evento',
  EventSeries: 'Serie',
  Order: 'Orden',
  Ticket: 'Boleto',
  Payment: 'Pago',
  Campaign: 'Campaña',
  Venue: 'Recinto',
  SeasonPass: 'Pase',
  Waitlist: 'Lista de espera',
};

export function entityLabel(entityType: string): string {
  return ENTITY_LABELS[entityType] ?? entityType;
}
