import type { BadgeTone } from '@boletera/ui';
import type { Cents } from './money';

/** Periodos soportados por `/reports/settlement/:org/:period`. */
export type SettlementPeriod = 'DAILY' | 'WEEKLY' | 'MONTHLY';

/** Estados de `PromoterPayout` en la base de datos. */
export type PayoutStatus =
  | 'PENDING'
  | 'PROCESSING'
  | 'COMPLETED'
  | 'FAILED'
  | 'CANCELLED';

export type PayoutStatusMeta = {
  label: string;
  tone: BadgeTone;
  /** El importe sigue pendiente de salir del banco. */
  open: boolean;
};

/** Liquidación normalizada: importes en centavos, fechas ISO o `null`. */
export type PayoutRow = {
  id: string;
  periodStart: string | null;
  periodEnd: string | null;
  grossCents: Cents;
  commissionCents: Cents;
  netCents: Cents;
  status: PayoutStatus;
  referenceId: string | null;
  processedAt: string | null;
  createdAt: string | null;
  method: string | null;
};

/** Ventas agregadas por canal (fuente: `GET /admin/payouts`). */
export type ChannelRow = {
  id: string;
  channel: string;
  currency: string;
  orders: number;
  grossCents: Cents;
  commissionCents: Cents;
  netCents: Cents;
};

/** Tramo de antigüedad de los saldos abiertos. */
export type AgingBucket = {
  id: string;
  label: string;
  /** Días transcurridos desde el cierre del periodo, inclusivo. */
  fromDays: number;
  /** `null` cuando el tramo no tiene límite superior. */
  toDays: number | null;
  count: number;
  amountCents: Cents;
  tone: BadgeTone;
};

/** Día del calendario de liquidaciones. */
export type CalendarDay = {
  /** Clave local `YYYY-MM-DD`. */
  key: string;
  date: Date;
  dayOfMonth: number;
  inCurrentMonth: boolean;
  isToday: boolean;
  payouts: readonly PayoutRow[];
  amountCents: Cents;
};

export type CalendarMonth = {
  cursor: Date;
  label: string;
  weeks: readonly (readonly CalendarDay[])[];
};

export type ReconciliationSeverity = 'ok' | 'warning' | 'error' | 'unknown';

/** Comparación entre dos fuentes de verdad del mismo importe. */
export type ReconciliationCheck = {
  id: string;
  label: string;
  description: string;
  expectedLabel: string;
  actualLabel: string;
  expectedCents: Cents | null;
  actualCents: Cents | null;
  deltaCents: Cents | null;
  severity: ReconciliationSeverity;
};
