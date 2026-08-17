import type { SaasCapabilities } from '@/lib/platform-api';

/** Claves de consumo que expone `/organization/capabilities`. */
export type CapabilityMetricKey = keyof SaasCapabilities['metrics'];

/**
 * Cómo se enciende una capacidad en el backend:
 * - `included`: viene contratada y siempre reporta `true`.
 * - `usage`: el backend la deriva del consumo real del tenant.
 * - `setting`: depende de un ajuste de la organización.
 */
export type ActivationSource = 'included' | 'usage' | 'setting';

/** Estado que se comunica al usuario para cada capacidad. */
export type CapabilityState = 'active' | 'idle' | 'off';

export type CapabilityGroupId =
  | 'nucleo'
  | 'venta'
  | 'ingresos'
  | 'cobros'
  | 'riesgo'
  | 'integraciones'
  | 'otras';

export interface CapabilityGroupMeta {
  id: CapabilityGroupId;
  label: string;
  description: string;
}

export const CAPABILITY_GROUPS: readonly CapabilityGroupMeta[] = [
  {
    id: 'nucleo',
    label: 'Núcleo de la plataforma',
    description: 'Aislamiento por organización, control de accesos y trazabilidad administrativa.',
  },
  {
    id: 'venta',
    label: 'Venta y acceso',
    description: 'Cómo se arma el aforo, se vende en sitio y se mueven los boletos ya emitidos.',
  },
  {
    id: 'ingresos',
    label: 'Ingresos y demanda',
    description: 'Palancas comerciales: precio, promociones, canales y mercado secundario.',
  },
  {
    id: 'cobros',
    label: 'Cobros y liquidación',
    description: 'Rieles de pago, dispersión al promotor y facturación fiscal.',
  },
  {
    id: 'riesgo',
    label: 'Riesgo y análisis',
    description: 'Señales antifraude y reportería operativa del tenant.',
  },
  {
    id: 'integraciones',
    label: 'Integraciones',
    description: 'Superficie B2B: partners conectados y credenciales de API.',
  },
  {
    id: 'otras',
    label: 'Otras capacidades',
    description: 'Capacidades que la API reporta y todavía no tienen ficha en esta vista.',
  },
];

interface CapabilityUsage {
  metric: CapabilityMetricKey;
  /** Sustantivo en plural para la línea de consumo ("terminales registradas"). */
  noun: string;
}

interface CapabilityDefinition {
  group: CapabilityGroupId;
  label: string;
  /** Qué hace la capacidad, en una frase. */
  summary: string;
  activation: ActivationSource;
  /** Métrica de consumo que el backend asocia a esta capacidad. */
  usage?: CapabilityUsage;
  /** Qué hace falta para encenderla cuando el backend la reporta apagada. */
  activationHint?: string;
  cta: { label: string; href: string };
  /** La acción del CTA modifica configuración de la organización. */
  requiresManage?: boolean;
}

/**
 * Ficha por módulo. Las claves y la forma de activación replican lo que
 * `OrganizationService.getSaasCapabilities` devuelve para el tenant.
 */
const CATALOG: Readonly<Record<string, CapabilityDefinition>> = {
  multiTenant: {
    group: 'nucleo',
    label: 'Multi-organización',
    summary: 'Cada organización opera con datos, catálogos y permisos aislados.',
    activation: 'included',
    cta: { label: 'Ver organización', href: '/settings/organization' },
    requiresManage: true,
  },
  teamManagement: {
    group: 'nucleo',
    label: 'Equipo y roles',
    summary: 'Altas de usuarios y control de qué puede hacer cada rol dentro del panel.',
    activation: 'included',
    cta: { label: 'Gestionar equipo', href: '/settings/organization' },
    requiresManage: true,
  },
  auditLog: {
    group: 'nucleo',
    label: 'Bitácora de auditoría',
    summary: 'Registro inmutable de acciones sensibles: quién, qué y cuándo.',
    activation: 'included',
    cta: { label: 'Abrir auditoría', href: '/audit' },
  },
  seatMaps: {
    group: 'venta',
    label: 'Mapas de asientos',
    summary: 'Diseño de recintos numerados y venta asiento por asiento.',
    activation: 'included',
    cta: { label: 'Abrir mapas', href: '/maps' },
  },
  posTaquilla: {
    group: 'venta',
    label: 'POS / Taquilla',
    summary: 'Venta presencial desde terminales físicas en el recinto.',
    activation: 'usage',
    usage: { metric: 'terminals', noun: 'terminales registradas' },
    activationHint: 'Se enciende sola en cuanto registras la primera terminal de taquilla.',
    cta: { label: 'Configurar cobro presencial', href: '/settings/payments' },
    requiresManage: true,
  },
  ticketTransfer: {
    group: 'venta',
    label: 'Transferencia de boletos',
    summary: 'Cesión de boletos entre asistentes sin pasar por soporte.',
    activation: 'included',
    usage: { metric: 'transfers', noun: 'transferencias acumuladas' },
    cta: { label: 'Ver órdenes', href: '/orders' },
  },
  waitlist: {
    group: 'venta',
    label: 'Lista de espera',
    summary: 'Captura de demanda insatisfecha y liberación por lotes cuando hay cupo.',
    activation: 'included',
    usage: { metric: 'waitlistPending', noun: 'personas en espera' },
    cta: { label: 'Abrir lista de espera', href: '/waitlist' },
  },
  dynamicPricing: {
    group: 'ingresos',
    label: 'Precio dinámico',
    summary: 'Reglas de tarifa que reaccionan a demanda, tiempo y ocupación.',
    activation: 'included',
    cta: { label: 'Revisar eventos', href: '/events' },
  },
  campaigns: {
    group: 'ingresos',
    label: 'Campañas y promociones',
    summary: 'Códigos de descuento, preventas y campañas segmentadas.',
    activation: 'included',
    cta: { label: 'Abrir campañas', href: '/campaigns' },
  },
  channels: {
    group: 'ingresos',
    label: 'Canales de venta',
    summary: 'Cuotas por canal y control de inventario asignado a terceros.',
    activation: 'included',
    cta: { label: 'Abrir canales', href: '/channels' },
  },
  resale: {
    group: 'ingresos',
    label: 'Reventa oficial',
    summary: 'Mercado secundario controlado, con tope de precio y trazabilidad.',
    activation: 'setting',
    activationHint:
      'Depende del ajuste "Permitir reventa" de la organización; al activarlo aquí queda encendida.',
    cta: { label: 'Ajustar reventa', href: '/settings/organization' },
    requiresManage: true,
  },
  banortePayments: {
    group: 'cobros',
    label: 'Cobros Banorte',
    summary: 'Payworks, SPEI y OXXO como rieles de cobro en línea y presencial.',
    activation: 'included',
    cta: { label: 'Configurar pagos', href: '/settings/payments' },
    requiresManage: true,
  },
  settlements: {
    group: 'cobros',
    label: 'Liquidaciones a promotor',
    summary: 'Cálculo y seguimiento de dispersiones sobre la venta del periodo.',
    activation: 'usage',
    usage: { metric: 'payouts', noun: 'liquidaciones generadas' },
    activationHint: 'Se enciende con la primera liquidación generada para la organización.',
    cta: { label: 'Abrir liquidaciones', href: '/payouts' },
  },
  cfdiSandbox: {
    group: 'cobros',
    label: 'Facturación CFDI',
    summary: 'Timbrado de comprobantes fiscales para las ventas del tenant.',
    activation: 'included',
    cta: { label: 'Abrir facturación', href: '/billing/cfdi' },
  },
  fraud: {
    group: 'riesgo',
    label: 'Antifraude',
    summary: 'Señales de riesgo, bloqueos y revisión manual de órdenes sospechosas.',
    activation: 'included',
    cta: { label: 'Abrir antifraude', href: '/fraud' },
  },
  reporting: {
    group: 'riesgo',
    label: 'Reportería',
    summary: 'Cortes operativos, egresos y exportables para finanzas.',
    activation: 'included',
    cta: { label: 'Abrir reportes', href: '/reports' },
  },
  apiPartners: {
    group: 'integraciones',
    label: 'API de partners',
    summary: 'Integración B2B para que terceros consulten inventario y vendan.',
    activation: 'included',
    usage: { metric: 'apiKeys', noun: 'claves activas' },
    cta: { label: 'Abrir partners', href: '/partners' },
  },
  partnerApiKeys: {
    group: 'integraciones',
    label: 'Credenciales de API',
    summary: 'Emisión y revocación de llaves por partner conectado.',
    activation: 'included',
    usage: { metric: 'apiKeys', noun: 'claves activas' },
    cta: { label: 'Administrar credenciales', href: '/partners' },
    requiresManage: true,
  },
};

/** Convierte `partnerApiKeys` en "Partner api keys" para claves sin ficha. */
export function humanizeCapabilityKey(key: string): string {
  const spaced = key.replace(/([A-Z])/g, ' $1').trim();
  return spaced.charAt(0).toUpperCase() + spaced.slice(1).toLowerCase();
}

function definitionFor(key: string): CapabilityDefinition {
  const known = CATALOG[key];
  if (known) return known;
  return {
    group: 'otras',
    label: humanizeCapabilityKey(key),
    summary: 'La API reporta esta capacidad para tu organización.',
    activation: 'included',
    cta: { label: 'Ver organización', href: '/settings/organization' },
  };
}

export interface CapabilityUsageReading {
  label: string;
  value: number;
}

export interface CapabilityItem {
  key: string;
  label: string;
  summary: string;
  group: CapabilityGroupId;
  enabled: boolean;
  state: CapabilityState;
  stateLabel: string;
  /** Por qué está en ese estado y qué depende de ti. */
  explanation: string;
  activation: ActivationSource;
  activationLabel: string;
  usage: CapabilityUsageReading | null;
  cta: { label: string; href: string };
  requiresManage: boolean;
}

export interface CapabilityGroup extends CapabilityGroupMeta {
  items: readonly CapabilityItem[];
  activeCount: number;
}

const STATE_LABEL: Readonly<Record<CapabilityState, string>> = {
  active: 'Activa',
  idle: 'Contratada sin uso',
  off: 'Desactivada',
};

const ACTIVATION_LABEL: Readonly<Record<ActivationSource, string>> = {
  included: 'Incluida en el plan',
  usage: 'Se activa con el uso',
  setting: 'Depende de un ajuste',
};

function resolveState(enabled: boolean, activation: ActivationSource): CapabilityState {
  if (enabled) return 'active';
  return activation === 'usage' ? 'idle' : 'off';
}

function resolveExplanation(
  state: CapabilityState,
  definition: CapabilityDefinition,
  usage: CapabilityUsageReading | null,
): string {
  if (state === 'active') {
    if (usage) return `En operación con ${usage.value} ${usage.label}.`;
    if (definition.activation === 'setting') {
      return 'Habilitada en la configuración de la organización.';
    }
    return 'Incluida en el plan y lista para usarse.';
  }
  if (definition.activationHint) return definition.activationHint;
  return 'La API la reporta apagada para esta organización.';
}

/** Agrupa los módulos del tenant y les adjunta el consumo real que reporta la API. */
export function buildCapabilityGroups(data: SaasCapabilities): CapabilityGroup[] {
  const byGroup = new Map<CapabilityGroupId, CapabilityItem[]>();

  for (const [key, enabled] of Object.entries(data.modules)) {
    const definition = definitionFor(key);
    const usage: CapabilityUsageReading | null = definition.usage
      ? { label: definition.usage.noun, value: data.metrics[definition.usage.metric] }
      : null;
    const state = resolveState(enabled, definition.activation);

    const item: CapabilityItem = {
      key,
      label: definition.label,
      summary: definition.summary,
      group: definition.group,
      enabled,
      state,
      stateLabel: STATE_LABEL[state],
      explanation: resolveExplanation(state, definition, usage),
      activation: definition.activation,
      activationLabel: ACTIVATION_LABEL[definition.activation],
      usage,
      cta: definition.cta,
      requiresManage: definition.requiresManage ?? false,
    };

    const bucket = byGroup.get(definition.group);
    if (bucket) bucket.push(item);
    else byGroup.set(definition.group, [item]);
  }

  return CAPABILITY_GROUPS.flatMap((meta) => {
    const items = byGroup.get(meta.id);
    if (!items || items.length === 0) return [];
    const sorted = [...items].sort((a, b) => a.label.localeCompare(b.label, 'es-MX'));
    return [
      {
        ...meta,
        items: sorted,
        activeCount: sorted.filter((item) => item.enabled).length,
      },
    ];
  });
}

export interface CapabilitySummary {
  total: number;
  active: number;
  idle: number;
  off: number;
}

export function summarizeCapabilities(groups: readonly CapabilityGroup[]): CapabilitySummary {
  const items = groups.flatMap((group) => group.items);
  return {
    total: items.length,
    active: items.filter((item) => item.state === 'active').length,
    idle: items.filter((item) => item.state === 'idle').length,
    off: items.filter((item) => item.state === 'off').length,
  };
}
