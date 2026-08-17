import type { SaasCapabilities } from '@/lib/platform-api';
import type { CapabilityMetricKey } from './catalog';

/**
 * Naturaleza del contador que devuelve la API:
 * - `current`: fotografía del estado actual (activas, pendientes).
 * - `total`: acumulado histórico del tenant.
 */
export type ConsumptionScope = 'current' | 'total';

export interface ConsumptionRow {
  key: CapabilityMetricKey;
  label: string;
  value: number;
  scope: ConsumptionScope;
  scopeLabel: string;
  description: string;
  cta: { label: string; href: string };
}

interface ConsumptionDefinition {
  label: string;
  scope: ConsumptionScope;
  description: string;
  cta: { label: string; href: string };
}

const SCOPE_LABEL: Readonly<Record<ConsumptionScope, string>> = {
  current: 'Vigente',
  total: 'Acumulado',
};

/**
 * Cada fila refleja exactamente un contador de `metrics`. El orden es el de
 * lectura: primero lo que crece con la operación, después lo que hay vigente.
 */
const CONSUMPTION: Readonly<Record<CapabilityMetricKey, ConsumptionDefinition>> = {
  events: {
    label: 'Eventos',
    scope: 'total',
    description: 'Eventos creados por la organización, en cualquier estado.',
    cta: { label: 'Ver eventos', href: '/events' },
  },
  terminals: {
    label: 'Terminales POS',
    scope: 'total',
    description: 'Terminales de taquilla dadas de alta para venta presencial.',
    cta: { label: 'Ver cobro presencial', href: '/settings/payments' },
  },
  transfers: {
    label: 'Transferencias de boleto',
    scope: 'total',
    description: 'Cesiones de boleto entre asistentes sobre eventos del tenant.',
    cta: { label: 'Ver órdenes', href: '/orders' },
  },
  payouts: {
    label: 'Liquidaciones',
    scope: 'total',
    description: 'Dispersiones registradas hacia el promotor.',
    cta: { label: 'Ver liquidaciones', href: '/payouts' },
  },
  apiKeys: {
    label: 'Credenciales de API',
    scope: 'current',
    description: 'Llaves de partner activas en este momento.',
    cta: { label: 'Ver partners', href: '/partners' },
  },
  waitlistPending: {
    label: 'Lista de espera',
    scope: 'current',
    description: 'Solicitudes en espera que siguen sin atenderse.',
    cta: { label: 'Ver lista de espera', href: '/waitlist' },
  },
};

const ORDER: readonly CapabilityMetricKey[] = [
  'events',
  'terminals',
  'transfers',
  'payouts',
  'apiKeys',
  'waitlistPending',
];

/** Traduce `metrics` a filas legibles. No inventa cupos: la API no reporta topes. */
export function buildConsumptionRows(
  metrics: SaasCapabilities['metrics'],
): ConsumptionRow[] {
  return ORDER.map((key) => {
    const definition = CONSUMPTION[key];
    return {
      key,
      label: definition.label,
      value: metrics[key],
      scope: definition.scope,
      scopeLabel: SCOPE_LABEL[definition.scope],
      description: definition.description,
      cta: definition.cta,
    };
  });
}
