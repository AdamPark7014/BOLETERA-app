import type { BadgeTone } from '@boletera/ui';

export type RangeKey = '30' | '90' | '365';

export type ReservationKind = 'checkout' | 'zone_hold' | 'blocked' | 'released' | 'expired';

export type ReservationStatus =
  | 'active'
  | 'converting'
  | 'expired_risk'
  | 'completed'
  | 'released'
  | 'expired';

export type ReservationRow = {
  id: string;
  kind: ReservationKind;
  status: ReservationStatus;
  title: string;
  meta: string;
  eventTitle: string;
  channel: string;
  quantity: number;
  amount: number;
  currency: string;
  createdAt: string | null;
  expiresAt: string | null;
  buyer: string;
  holdId: string | null;
  orderId: string | null;
  [key: string]: string | number | boolean | null;
};

export const KIND_LABEL: Record<ReservationKind, string> = {
  checkout: 'Hold checkout',
  zone_hold: 'Hold de zona',
  blocked: 'Bloqueo operativo',
  released: 'Liberación',
  expired: 'Expiración',
};

export const KIND_TONE: Record<ReservationKind, BadgeTone> = {
  checkout: 'info',
  zone_hold: 'warning',
  blocked: 'neutral',
  released: 'success',
  expired: 'danger',
};

export const STATUS_LABEL: Record<ReservationStatus, string> = {
  active: 'Activa',
  converting: 'En conversión',
  expired_risk: 'Riesgo TTL',
  completed: 'Convertida',
  released: 'Liberada',
  expired: 'Expirada',
};

export const STATUS_TONE: Record<ReservationStatus, BadgeTone> = {
  active: 'info',
  converting: 'warning',
  expired_risk: 'danger',
  completed: 'success',
  released: 'success',
  expired: 'danger',
};

export const RANGE_OPTIONS: ReadonlyArray<{ value: RangeKey; label: string }> = [
  { value: '30', label: '30 días' },
  { value: '90', label: '90 días' },
  { value: '365', label: '12 meses' },
];

export const KIND_VALUES: readonly ReservationKind[] = [
  'checkout',
  'zone_hold',
  'blocked',
  'released',
  'expired',
];

export const STATUS_VALUES: readonly ReservationStatus[] = [
  'active',
  'converting',
  'expired_risk',
  'completed',
  'released',
  'expired',
];

export const POLICY_TEMPLATES = [
  {
    id: 'web-15',
    title: 'TTL checkout web · 15 min',
    detail: 'Libera asientos al expirar el hold de compra en línea.',
  },
  {
    id: 'pos-5',
    title: 'TTL taquilla · 5 min',
    detail: 'Bloqueo corto para ventanilla y evitar aforo atrapado.',
  },
  {
    id: 'vip',
    title: 'Bloqueo VIP / cortesía',
    detail: 'Retención operativa sin TTL de checkout; liberación manual.',
  },
] as const;
