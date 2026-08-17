import type { BadgeTone } from '@boletera/ui';

export type RangeKey = '30' | '90' | '365';

export type ReservationKind = 'checkout' | 'zone_hold' | 'blocked';

export type ReservationStatus = 'active' | 'converting' | 'expired_risk' | 'completed';

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
  buyer: string;
  [key: string]: string | number | boolean | null;
};

export const KIND_LABEL: Record<ReservationKind, string> = {
  checkout: 'Hold checkout',
  zone_hold: 'Hold de zona',
  blocked: 'Bloqueo operativo',
};

export const KIND_TONE: Record<ReservationKind, BadgeTone> = {
  checkout: 'info',
  zone_hold: 'warning',
  blocked: 'neutral',
};

export const STATUS_LABEL: Record<ReservationStatus, string> = {
  active: 'Activa',
  converting: 'En conversión',
  expired_risk: 'Riesgo TTL',
  completed: 'Convertida',
};

export const STATUS_TONE: Record<ReservationStatus, BadgeTone> = {
  active: 'info',
  converting: 'warning',
  expired_risk: 'danger',
  completed: 'success',
};
