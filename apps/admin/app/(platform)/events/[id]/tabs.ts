export const HUB_TABS = [
  'overview',
  'inventory',
  'pricing',
  'schedule',
  'channels',
  'marketing',
  'access',
  'activity',
] as const;

export type HubTab = (typeof HUB_TABS)[number];

export const HUB_TAB_LABELS: Record<HubTab, string> = {
  overview: 'Resumen',
  inventory: 'Inventario',
  pricing: 'Precios',
  schedule: 'Calendario',
  channels: 'Canales',
  marketing: 'Marketing',
  access: 'Accesos',
  activity: 'Actividad',
};

export function isHubTab(value: string | null | undefined): value is HubTab {
  return Boolean(value && (HUB_TABS as readonly string[]).includes(value));
}

export function parseHubTab(value: string | null | undefined): HubTab {
  return isHubTab(value) ? value : 'overview';
}
