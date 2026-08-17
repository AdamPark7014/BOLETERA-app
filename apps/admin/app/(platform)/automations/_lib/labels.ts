import type { BadgeTone } from '@boletera/ui';
import type {
  AutomationActionKind,
  AutomationRuleStatus,
  AutomationRunStatus,
  AutomationTriggerKind,
} from './types';

const TRIGGER_KIND_LABELS = {
  event: 'Evento',
  schedule: 'Programado',
  manual: 'Manual',
} as const satisfies Record<AutomationTriggerKind, string>;

const ACTION_KIND_LABELS = {
  notify: 'Notificación',
  email: 'Correo',
  offer: 'Oferta',
  channel: 'Canal',
  incident: 'Incidente',
  report: 'Reporte',
  payment: 'Pagos',
} as const satisfies Record<AutomationActionKind, string>;

const RULE_STATUS_LABELS = {
  enabled: 'Activa',
  disabled: 'Pausada',
  draft: 'Borrador',
} as const satisfies Record<AutomationRuleStatus, string>;

const RULE_STATUS_TONES = {
  enabled: 'success',
  disabled: 'neutral',
  draft: 'warning',
} as const satisfies Record<AutomationRuleStatus, BadgeTone>;

const RUN_STATUS_LABELS = {
  succeeded: 'Éxito',
  failed: 'Fallo',
  skipped: 'Omitida',
  simulated: 'Simulación',
  toggled: 'Cambio de estado',
} as const satisfies Record<AutomationRunStatus, string>;

const RUN_STATUS_TONES = {
  succeeded: 'success',
  failed: 'danger',
  skipped: 'neutral',
  simulated: 'info',
  toggled: 'accent',
} as const satisfies Record<AutomationRunStatus, BadgeTone>;

export function triggerKindLabel(kind: AutomationTriggerKind): string {
  return TRIGGER_KIND_LABELS[kind];
}

export function actionKindLabel(kind: AutomationActionKind): string {
  return ACTION_KIND_LABELS[kind];
}

export function ruleStatusLabel(status: AutomationRuleStatus): string {
  return RULE_STATUS_LABELS[status];
}

export function ruleStatusTone(status: AutomationRuleStatus): BadgeTone {
  return RULE_STATUS_TONES[status];
}

export function runStatusLabel(status: AutomationRunStatus): string {
  return RUN_STATUS_LABELS[status];
}

export function runStatusTone(status: AutomationRunStatus): BadgeTone {
  return RUN_STATUS_TONES[status];
}
