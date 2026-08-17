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
