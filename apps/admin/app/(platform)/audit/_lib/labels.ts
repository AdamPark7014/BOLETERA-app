const ACTION_LABELS: Record<string, string> = {
  AUTH_LOGIN_FAILED: 'Acceso fallido',
  AUTH_LOGIN_SUCCEEDED: 'Inicio de sesión',
  AUTH_OAUTH_LOGIN_SUCCEEDED: 'Inicio de sesión con Google o Microsoft',
  AUTH_PASSWORD_RESET: 'Contraseña restablecida',
  AUTH_REFRESH_REUSE_DETECTED: 'Sesión reutilizada (bloqueada)',
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
  REFUND_MANUAL_RECORDED: 'Reembolso registrado',
  REFUND_COMPLETED: 'Reembolso completado',
  REFUND_REQUESTED: 'Reembolso solicitado',
  MEMBERSHIP_PURCHASED: 'Membresía comprada',
  MEMBERSHIP_CHECKOUT_STARTED: 'Compra de membresía iniciada',
  MEMBERSHIP_PLAN_CREATED: 'Plan de membresía creado',
  MEMBERSHIP_PLAN_UPDATED: 'Plan de membresía actualizado',
  MEMBERSHIP_BENEFIT_CREATED: 'Beneficio creado',
  TICKET_TRANSFER_INITIATED: 'Transferencia de boleto iniciada',
  TICKET_TRANSFER_ACCEPTED: 'Transferencia de boleto aceptada',
  PRICING_RECOMMENDATION_APPROVED: 'Precio aprobado',
  PRICING_RECOMMENDATION_REJECTED: 'Precio rechazado',
  EVENT_PUBLISHED: 'Evento publicado',
  EVENT_CREATED: 'Evento creado',
  EVENT_UPDATED: 'Evento actualizado',
  ORDER_CANCELLED: 'Orden cancelada',
  ORDER_COMP_ISSUED: 'Cortesía emitida',
  RESALE_LISTED: 'Boleto en reventa',
  API_KEY_CREATED: 'Llave de API creada',
  API_KEY_ROTATED: 'Llave de API rotada',
  API_KEY_REVOKED: 'Llave de API revocada',
};

/** Clave normalizada: «event cancelled», «EVENT_CANCELLED» y «event.cancelled» son la misma. */
function normalizeAction(action: string): string {
  return action.replace(/[._\s-]+/g, '_').toUpperCase();
}

const ACTION_LABELS_NORMALIZED = new Map(
  Object.entries(ACTION_LABELS).map(([key, label]) => [normalizeAction(key), label])
);

/** Acción en español; si no se conoce, una frase neutra (nunca la clave técnica en inglés). */
export function actionLabel(action: string): string {
  return (
    ACTION_LABELS[action] ??
    ACTION_LABELS_NORMALIZED.get(normalizeAction(action)) ??
    'Cambio registrado'
  );
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
  Refund: 'Reembolso',
  ResaleListing: 'Reventa',
  Offer: 'Precio',
  ApiKey: 'Llave de API',
  Membership: 'Membresía',
};

const ENTITY_LABELS_LOWER = new Map(
  Object.entries(ENTITY_LABELS).map(([key, label]) => [key.toLowerCase(), label])
);

/** Tipo de registro en español; si no se conoce, «Registro» (nunca el nombre del modelo en inglés). */
export function entityLabel(entityType: string): string {
  const key = entityType.replace(/[_\s-]/g, '').toLowerCase();
  return ENTITY_LABELS[entityType] ?? ENTITY_LABELS_LOWER.get(key) ?? 'Registro';
}
