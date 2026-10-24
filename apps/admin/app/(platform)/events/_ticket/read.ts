export function asRecord(value: unknown): Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export function readNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value);
    if (Number.isFinite(parsed)) return parsed;
  }
  return null;
}

export function readString(value: unknown): string | null {
  return typeof value === 'string' && value.trim() !== '' ? value : null;
}

export function formatWhen(value: unknown, timeZone = 'America/Mexico_City'): string {
  const raw = value instanceof Date ? value.toISOString() : readString(value);
  if (!raw) return '—';
  const date = new Date(raw);
  if (Number.isNaN(date.getTime())) return '—';
  return date.toLocaleString('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone,
  });
}

export function formatCount(value: number | null): string {
  if (value == null) return '—';
  return value.toLocaleString('es-MX');
}

const STATUS_LABEL: Record<string, string> = {
  DRAFT: 'Borrador',
  SCHEDULED: 'Programado',
  LIVE: 'En vivo',
  COMPLETED: 'Terminado',
  CANCELLED: 'Cancelado',
  RESCHEDULED: 'Reprogramado',
};

const CATEGORY_LABEL: Record<string, string> = {
  MUSIC: 'Música',
  SPORTS: 'Deportes',
  THEATER: 'Teatro',
  COMEDY: 'Comedia',
  CONFERENCE: 'Conferencia',
  WORKSHOP: 'Taller',
  FESTIVAL: 'Festival',
  FAMILY: 'Familiar',
  STANDUP: 'Stand up',
  CINEMA: 'Cine',
  OTHER: 'Otra',
};

export function statusLabel(status: unknown): string {
  const raw = readString(status);
  if (!raw) return '—';
  return STATUS_LABEL[raw] ?? raw;
}

export function categoryLabel(category: unknown): string {
  const raw = readString(category);
  if (!raw) return '—';
  return CATEGORY_LABEL[raw] ?? raw;
}

export function yesNo(value: unknown, empty = '—'): string {
  if (value === true) return 'Sí';
  if (value === false) return 'No';
  return empty;
}

export type OfferView = {
  id: string;
  name: string;
  zone: string;
  description: string | null;
  basePrice: number;
  currency: string;
  totalQuantity: number | null;
  remainingQuantity: number | null;
  soldQuantity: number | null;
  holdQuantity: number | null;
  minPerOrder: number | null;
  maxPerOrder: number | null;
  minAge: number | null;
  cards: string;
  startDate: string | null;
  endDate: string | null;
  isAvailable: boolean;
};

export function readOffers(event: unknown): OfferView[] {
  const offers = asRecord(event).offers;
  if (!Array.isArray(offers)) return [];
  const rows: OfferView[] = [];
  for (const item of offers) {
    const row = asRecord(item);
    const id = readString(row.id);
    if (!id) continue;
    const cards = Array.isArray(row.restrictedCards)
      ? row.restrictedCards.filter((card): card is string => typeof card === 'string')
      : [];
    rows.push({
      id,
      name: readString(row.name) ?? 'Oferta',
      zone: readString(row.zone) ?? '—',
      description: readString(row.description),
      basePrice: readNumber(row.basePrice) ?? 0,
      currency: readString(row.currency) ?? 'MXN',
      totalQuantity: readNumber(row.totalQuantity),
      remainingQuantity: readNumber(row.remainingQuantity),
      soldQuantity: readNumber(row.soldQuantity),
      holdQuantity: readNumber(row.holdQuantity),
      minPerOrder: readNumber(row.minPerOrder),
      maxPerOrder: readNumber(row.maxPerOrder),
      minAge: readNumber(row.minAge),
      cards: cards.length > 0 ? cards.join(', ') : 'Ninguna',
      startDate: readString(row.startDate),
      endDate: readString(row.endDate),
      isAvailable: row.isAvailable !== false,
    });
  }
  return rows;
}

/** Orden del DTO. Solo se pintan las llaves que el API devolvió. */
const CHANNEL_ORDER = [
  'web',
  'taquilla',
  'api',
  'phone',
  'admin',
  'promoter',
  'courtesy',
  'corporate',
  'mobile',
  'invitation',
  'affiliate',
  'vip',
  'resale',
] as const;

const CHANNEL_LABEL: Record<string, string> = {
  web: 'Web',
  taquilla: 'Taquilla',
  api: 'API',
  phone: 'Teléfono',
  admin: 'Admin',
  promoter: 'Promotor',
  courtesy: 'Cortesía',
  corporate: 'Corporativo',
  mobile: 'Móvil',
  invitation: 'Invitación',
  affiliate: 'Afiliado',
  vip: 'VIP',
  resale: 'Reventa',
};

export type ChannelSlot = {
  key: string;
  label: string;
  defined: boolean;
  enabled: boolean | null;
  allocation: number | null;
  raw: Record<string, unknown>;
};

export function readChannels(metadata: unknown, health: unknown): ChannelSlot[] {
  const stored = asRecord(asRecord(metadata).channels);
  const reported = asRecord(health);
  const returned = new Set<string>([...Object.keys(stored), ...Object.keys(reported)]);
  const known = new Set<string>(CHANNEL_ORDER);
  const ordered = [
    ...CHANNEL_ORDER.filter((key) => returned.has(key)),
    ...[...returned].filter((key) => !known.has(key)),
  ];
  return ordered.map((key) => {
    const defined = Object.prototype.hasOwnProperty.call(stored, key);
    const raw = defined ? asRecord(stored[key]) : {};
    return {
      key,
      label: CHANNEL_LABEL[key] ?? key,
      defined,
      enabled: defined && typeof raw.enabled === 'boolean' ? raw.enabled : null,
      allocation: defined ? readNumber(raw.allocation) : null,
      raw,
    };
  });
}

export function channelValue(slot: Pick<ChannelSlot, 'enabled' | 'allocation'>): string {
  if (slot.enabled === true && slot.allocation != null) return `Activo · ${slot.allocation}%`;
  if (slot.enabled === false) return 'Inactivo';
  return 'Sin reparto';
}

export function channelNotes(raw: Record<string, unknown>): string[] {
  const lines: string[] = [];
  const discount = readNumber(raw.discount);
  if (discount != null) lines.push(`Descuento ${discount}%`);
  const hours = readString(raw.activeHours) ?? readString(raw.hours);
  if (hours) lines.push(`Horario ${hours}`);
  const commission = readNumber(raw.commissionRate);
  if (commission != null) lines.push(`Comisión ${commission}%`);
  const fee = readNumber(raw.feePercent);
  if (fee != null) lines.push(`Cargo ${fee}%`);
  const email = readString(raw.contactEmail);
  if (email) lines.push(email);
  const locations = raw.locations;
  if (Array.isArray(locations) && locations.length > 0) {
    const names = locations.map((item) =>
      typeof item === 'string' ? item : (readString(asRecord(item).name) ?? 'Ubicación'),
    );
    lines.push(names.join(', '));
  }
  const partners = raw.partners;
  if (Array.isArray(partners) && partners.length > 0) {
    const names = partners.map((item) =>
      typeof item === 'string' ? item : (readString(asRecord(item).name) ?? 'Partner'),
    );
    lines.push(names.join(', '));
  }
  return lines;
}

export function activeAllocation(slots: Pick<ChannelSlot, 'enabled' | 'allocation'>[]): number {
  return slots.reduce((sum, slot) => {
    if (slot.enabled !== true) return sum;
    return sum + (slot.allocation ?? 0);
  }, 0);
}
