import type { BadgeTone } from '@boletera/ui';

export type RangeKey = '30' | '90' | '365';

export type CustomerSegment = 'vip' | 'recurrent' | 'new' | 'at_risk' | 'inactive';

export type CrmCustomerRow = {
  id: string;
  name: string;
  email: string;
  ordersCount: number;
  completedOrders: number;
  totalSpend: number;
  currency: string;
  lastOrderAt: string | null;
  firstOrderAt: string | null;
  channels: string;
  topEvent: string;
  segment: CustomerSegment;
  [key: string]: string | number | boolean | null;
};

export type CrmSegmentCard = {
  id: CustomerSegment;
  label: string;
  description: string;
  count: number;
  spend: number;
  tone: BadgeTone;
};

export const SEGMENT_LABEL: Record<CustomerSegment, string> = {
  vip: 'VIP',
  recurrent: 'Recurrente',
  new: 'Nuevo',
  at_risk: 'En riesgo',
  inactive: 'Inactivo',
};

export const SEGMENT_TONE: Record<CustomerSegment, BadgeTone> = {
  vip: 'accent',
  recurrent: 'success',
  new: 'info',
  at_risk: 'warning',
  inactive: 'neutral',
};
