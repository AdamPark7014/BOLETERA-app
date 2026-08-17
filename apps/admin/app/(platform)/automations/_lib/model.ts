import type {
  AutomationHistoryEntry,
  AutomationRule,
  AutomationRuleStatus,
  AutomationTrigger,
  AutomationsPersistedState,
} from './types';
import { STORAGE_KEY } from './types';

export const AUTOMATION_TRIGGERS: readonly AutomationTrigger[] = [
  {
    id: 'schedule.event-reminder-24h',
    kind: 'schedule',
    name: 'Recordatorio 24 h',
    description: 'Evalúa asistentes con boleto válido 24 horas antes del inicio.',
    scheduleHint: 'Diario / por evento · T−24h',
  },
  {
    id: 'event.checkout.expired',
    kind: 'event',
    name: 'Checkout expirado',
    description: 'Se dispara cuando una sesión de compra vence sin pago.',
    eventKey: 'checkout.expirado',
  },
  {
    id: 'event.inventory.released',
    kind: 'event',
    name: 'Inventario liberado',
    description: 'Lugares liberados por cancelación o expiración de hold.',
    eventKey: 'inventario.liberado',
  },
  {
    id: 'event.payment.rejected',
    kind: 'event',
    name: 'Pago rechazado',
    description: 'Cargo recuperable rechazado por el proveedor de pagos.',
    eventKey: 'pago.rechazado',
  },
  {
    id: 'schedule.sales-pace-daily',
    kind: 'schedule',
    name: 'Ritmo de venta diario',
    description: 'Compara avance de venta vs. umbral para días restantes.',
    scheduleHint: '1× al día por evento publicado',
  },
  {
    id: 'event.scan.rejected-burst',
    kind: 'event',
    name: 'Ráfaga de escaneos rechazados',
    description: 'Umbral de rechazos consecutivos en un punto de acceso.',
    eventKey: 'escaneo.rechazado',
  },
  {
    id: 'event.inventory.sold-out',
    kind: 'event',
    name: 'Inventario agotado',
    description: 'Disponibilidad de una localidad llega a cero.',
    eventKey: 'inventario.agotado',
  },
  {
    id: 'schedule.post-event-summary',
    kind: 'schedule',
    name: 'Cierre post-evento',
    description: 'Tras conciliar accesos y órdenes del operativo.',
    scheduleHint: 'Tras cierre operativo',
  },
] as const;

const RULE_SEED: readonly Omit<AutomationRule, 'status' | 'updatedAt'>[] = [
  {
    id: 'rule.reminder-24h',
    name: 'Recordatorio 24 h antes del evento',
    description:
      'Correo + push a asistentes con boleto válido no escaneado ni cancelado. Reintentos con backoff; fallo → revisión manual.',
    triggerId: 'schedule.event-reminder-24h',
    actionKind: 'email',
    actionLabel: 'Enviar correo y push',
  },
  {
    id: 'rule.cart-recovery',
    name: 'Recuperación de carrito abandonado',
    description:
      'Correo con enlace de retorno si el inventario sigue disponible y hay consentimiento de marketing.',
    triggerId: 'event.checkout.expired',
    actionKind: 'email',
    actionLabel: 'Enviar correo con enlace',
  },
  {
    id: 'rule.waitlist-offer',
    name: 'Oferta automática a lista de espera',
    description:
      'Crea oferta con vigencia y notifica por correo/SMS al liberarse lugares.',
    triggerId: 'event.inventory.released',
    actionKind: 'offer',
    actionLabel: 'Crear oferta con vigencia',
  },
  {
    id: 'rule.payment-retry',
    name: 'Reintento de pago fallido',
    description:
      'Reintento escalonado y aviso al comprador. Rechazos definitivos liberan inventario.',
    triggerId: 'event.payment.rejected',
    actionKind: 'payment',
    actionLabel: 'Reintentar cobro y avisar',
    requiresConnector: 'Pagos',
  },
  {
    id: 'rule.sales-pace-alert',
    name: 'Alerta de baja velocidad de venta',
    description:
      'Notifica al equipo comercial y sugiere ajuste. No cambia precios sin aprobación.',
    triggerId: 'schedule.sales-pace-daily',
    actionKind: 'notify',
    actionLabel: 'Notificar y sugerir ajuste',
    requiresConnector: 'Métricas de ventas',
  },
  {
    id: 'rule.access-incident',
    name: 'Escalamiento de incidentes de acceso',
    description:
      'Abre incidente con contexto del punto de acceso y avisa a control.',
    triggerId: 'event.scan.rejected-burst',
    actionKind: 'incident',
    actionLabel: 'Abrir incidente y avisar',
  },
  {
    id: 'rule.channel-sold-out',
    name: 'Cierre de canal al agotarse inventario',
    description:
      'Pausa canales configurados y publica aviso de agotado hasta confirmación.',
    triggerId: 'event.inventory.sold-out',
    actionKind: 'channel',
    actionLabel: 'Pausar canal y publicar aviso',
  },
  {
    id: 'rule.post-event-report',
    name: 'Resumen post-evento para organizadores',
    description:
      'Genera reporte de asistencia e ingresos y lo envía a destinatarios configurados.',
    triggerId: 'schedule.post-event-summary',
    actionKind: 'report',
    actionLabel: 'Generar reporte y enviarlo',
    requiresConnector: 'Servicio de reportes',
  },
];

export function defaultRuleStatus(ruleId: string): AutomationRuleStatus {
  if (ruleId === 'rule.payment-retry' || ruleId === 'rule.post-event-report') {
    return 'draft';
  }
  if (ruleId === 'rule.sales-pace-alert') return 'disabled';
  return 'disabled';
}

export function buildRules(
  statusMap: Record<string, AutomationRuleStatus>,
): AutomationRule[] {
  const now = new Date().toISOString();
  return RULE_SEED.map((seed) => ({
    ...seed,
    status: statusMap[seed.id] ?? defaultRuleStatus(seed.id),
    updatedAt: now,
  }));
}

export function emptyPersistedState(): AutomationsPersistedState {
  return { ruleStatus: {}, history: [] };
}

export function readPersistedState(): AutomationsPersistedState {
  if (typeof window === 'undefined') return emptyPersistedState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyPersistedState();
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== 'object') return emptyPersistedState();
    const record = parsed as {
      ruleStatus?: unknown;
      history?: unknown;
    };
    const ruleStatus: Record<string, AutomationRuleStatus> = {};
    if (record.ruleStatus && typeof record.ruleStatus === 'object') {
      for (const [key, value] of Object.entries(
        record.ruleStatus as Record<string, unknown>,
      )) {
        if (value === 'enabled' || value === 'disabled' || value === 'draft') {
          ruleStatus[key] = value;
        }
      }
    }
    const history: AutomationHistoryEntry[] = [];
    if (Array.isArray(record.history)) {
      for (const item of record.history) {
        if (!item || typeof item !== 'object') continue;
        const row = item as Partial<AutomationHistoryEntry>;
        if (
          typeof row.id === 'string' &&
          typeof row.ruleId === 'string' &&
          typeof row.ruleName === 'string' &&
          typeof row.summary === 'string' &&
          typeof row.at === 'string' &&
          (row.status === 'succeeded' ||
            row.status === 'failed' ||
            row.status === 'skipped' ||
            row.status === 'simulated' ||
            row.status === 'toggled')
        ) {
          history.push({
            id: row.id,
            ruleId: row.ruleId,
            ruleName: row.ruleName,
            status: row.status,
            summary: row.summary,
            at: row.at,
          });
        }
      }
    }
    return { ruleStatus, history };
  } catch {
    return emptyPersistedState();
  }
}

export function writePersistedState(state: AutomationsPersistedState): void {
  if (typeof window === 'undefined') return;
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function createHistoryEntry(
  input: Omit<AutomationHistoryEntry, 'id' | 'at'> & { at?: string },
): AutomationHistoryEntry {
  return {
    id: `run-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
    at: input.at ?? new Date().toISOString(),
    ruleId: input.ruleId,
    ruleName: input.ruleName,
    status: input.status,
    summary: input.summary,
  };
}

export function triggerById(
  triggers: readonly AutomationTrigger[],
  id: string,
): AutomationTrigger | undefined {
  return triggers.find((row) => row.id === id);
}
