import type { BadgeTone } from '@boletera/ui';
import type { SaasCapabilities } from '@/lib/platform-api';

type RoadmapEntry = SaasCapabilities['roadmap'][number];

export type DeliveryStatus = 'done' | 'partial' | 'planned' | 'unknown';
export type DeliveryPriority = 'high' | 'medium' | 'low' | 'unknown';

export interface Delivery {
  id: string;
  label: string;
  status: DeliveryStatus;
  statusLabel: string;
  statusTone: BadgeTone;
  priority: DeliveryPriority;
  priorityLabel: string;
  priorityTone: BadgeTone;
  /** Detalle que la API adjunta a algunos entregables. */
  note: string | null;
  done: boolean;
}

const STATUS_LABEL: Readonly<Record<DeliveryStatus, string>> = {
  done: 'Entregado',
  partial: 'En curso',
  planned: 'Planeado',
  unknown: 'Sin clasificar',
};

const STATUS_TONE: Readonly<Record<DeliveryStatus, BadgeTone>> = {
  done: 'success',
  partial: 'warning',
  planned: 'neutral',
  unknown: 'neutral',
};

const PRIORITY_LABEL: Readonly<Record<DeliveryPriority, string>> = {
  high: 'Prioridad alta',
  medium: 'Prioridad media',
  low: 'Prioridad baja',
  unknown: 'Sin prioridad',
};

const PRIORITY_TONE: Readonly<Record<DeliveryPriority, BadgeTone>> = {
  high: 'danger',
  medium: 'warning',
  low: 'neutral',
  unknown: 'neutral',
};

const PRIORITY_ORDER: Readonly<Record<DeliveryPriority, number>> = {
  high: 0,
  medium: 1,
  low: 2,
  unknown: 3,
};

function parseStatus(raw: string): DeliveryStatus {
  const value = raw.trim().toLowerCase();
  if (value === 'done') return 'done';
  if (value === 'partial') return 'partial';
  if (value === 'planned') return 'planned';
  return 'unknown';
}

function parsePriority(raw: string): DeliveryPriority {
  const value = raw.trim().toLowerCase();
  if (value === 'high') return 'high';
  if (value === 'medium') return 'medium';
  if (value === 'low') return 'low';
  return 'unknown';
}

/** La API a veces adjunta `note`; el tipo publicado aún no lo declara. */
type RoadmapEntryWithNote = RoadmapEntry & { note?: string };

/**
 * `note` es opcional en la respuesta y no forma parte del tipo publicado, por
 * eso se lee de forma defensiva en lugar de asumir que siempre viene.
 */
function readNote(entry: RoadmapEntry): string | null {
  const withNote: RoadmapEntryWithNote = entry;
  const raw = withNote.note;
  if (typeof raw !== 'string') return null;
  const trimmed = raw.trim();
  return trimmed.length > 0 ? trimmed : null;
}

/** Normaliza el roadmap del tenant: pendientes primero y por prioridad. */
export function buildDeliveries(roadmap: SaasCapabilities['roadmap']): Delivery[] {
  return roadmap
    .map<Delivery>((entry) => {
      const status = parseStatus(entry.status);
      const priority = parsePriority(entry.priority);
      return {
        id: entry.id,
        label: entry.label,
        status,
        statusLabel: STATUS_LABEL[status],
        statusTone: STATUS_TONE[status],
        priority,
        priorityLabel: PRIORITY_LABEL[priority],
        priorityTone: PRIORITY_TONE[priority],
        note: readNote(entry),
        done: status === 'done',
      };
    })
    .sort((a, b) => {
      if (a.done !== b.done) return a.done ? 1 : -1;
      const byPriority = PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority];
      if (byPriority !== 0) return byPriority;
      return a.label.localeCompare(b.label, 'es-MX');
    });
}

export interface DeliverySummary {
  total: number;
  done: number;
  pending: number;
  highPending: number;
}

export function summarizeDeliveries(items: readonly Delivery[]): DeliverySummary {
  const done = items.filter((item) => item.done).length;
  return {
    total: items.length,
    done,
    pending: items.length - done,
    highPending: items.filter((item) => !item.done && item.priority === 'high').length,
  };
}
