import type { BadgeTone } from '@boletera/ui';

export type RangeKey = '30' | '90' | '365';

export type PressureLevel = 'low' | 'medium' | 'high' | 'critical';

export type InventoryZoneTableRow = {
  id: string;
  eventId: string;
  eventTitle: string;
  offerId: string;
  zone: string;
  tierName: string;
  totalQuantity: number;
  remainingQuantity: number;
  soldQuantity: number;
  holdQuantity: number;
  availabilityPercent: number;
  sellThroughVelocity: number;
  daysToSellOut: number | null;
  pressure: PressureLevel;
  [key: string]: string | number | boolean | null;
};

export type InventoryEventOption = {
  id: string;
  title: string;
  zones: number;
  held: number;
  available: number;
  sold: number;
  venueName: string | null;
};

export type SelloutRiskRow = {
  id: string;
  eventId: string;
  eventTitle: string;
  zone: string;
  tierName: string;
  daysToSellOut: number;
  remainingQuantity: number;
  sellThroughVelocity: number;
};

export const PRESSURE_LABEL: Record<PressureLevel, string> = {
  low: 'Baja',
  medium: 'Media',
  high: 'Alta',
  critical: 'Crítica',
};

export const PRESSURE_TONE: Record<PressureLevel, BadgeTone> = {
  low: 'success',
  medium: 'info',
  high: 'warning',
  critical: 'danger',
};

export const RANGE_OPTIONS: ReadonlyArray<{ value: RangeKey; label: string }> = [
  { value: '30', label: '30 días' },
  { value: '90', label: '90 días' },
  { value: '365', label: '12 meses' },
];

export const PRESSURE_VALUES: readonly PressureLevel[] = [
  'low',
  'medium',
  'high',
  'critical',
];
