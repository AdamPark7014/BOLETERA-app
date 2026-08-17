export enum SalesChannel {
  WEB = 'WEB',
  TAQUILLA = 'TAQUILLA',
  API = 'API',
  ADMIN = 'ADMIN',
}

export type SalesChannelValue = `${SalesChannel}`;

export enum UserRole {
  CUSTOMER = 'CUSTOMER',
  PROMOTER = 'PROMOTER',
  VENUE_MANAGER = 'VENUE_MANAGER',
  ADMIN = 'ADMIN',
  SUPER_ADMIN = 'SUPER_ADMIN',
  TAQUILLA = 'TAQUILLA',
  SCANNER = 'SCANNER',
}

export type UserRoleValue = `${UserRole}`;

export enum TicketStatus {
  AVAILABLE = 'AVAILABLE',
  HELD = 'HELD',
  SOLD = 'SOLD',
  USED = 'USED',
  CANCELLED = 'CANCELLED',
  REFUNDED = 'REFUNDED',
  TRANSFERRED = 'TRANSFERRED',
}

export type TicketStatusValue = `${TicketStatus}`;

export enum OrderStatus {
  PENDING = 'PENDING',
  AWAITING_PAYMENT = 'AWAITING_PAYMENT',
  COMPLETED = 'COMPLETED',
  CANCELLED = 'CANCELLED',
  REFUNDED = 'REFUNDED',
  PARTIALLY_REFUNDED = 'PARTIALLY_REFUNDED',
  EXPIRED = 'EXPIRED',
}

export type OrderStatusValue = `${OrderStatus}`;

export enum PaymentStatus {
  PENDING = 'PENDING',
  REQUIRES_ACTION = 'REQUIRES_ACTION',
  AUTHORIZED = 'AUTHORIZED',
  CAPTURED = 'CAPTURED',
  FAILED = 'FAILED',
  CANCELLED = 'CANCELLED',
  REFUNDED = 'REFUNDED',
  PARTIALLY_REFUNDED = 'PARTIALLY_REFUNDED',
}

export type PaymentStatusValue = `${PaymentStatus}`;

export enum PaymentMethod {
  CARD = 'CARD',
  CASH = 'CASH',
  OXXO = 'OXXO',
  SPEI = 'SPEI',
  CLIP = 'CLIP',
  BANK_TRANSFER = 'BANK_TRANSFER',
}

export type PaymentMethodValue = `${PaymentMethod}`;

export const SALES_CHANNEL_VALUES = Object.freeze(
  Object.values(SalesChannel) as SalesChannelValue[],
);
export const USER_ROLE_VALUES = Object.freeze(Object.values(UserRole) as UserRoleValue[]);
export const TICKET_STATUS_VALUES = Object.freeze(
  Object.values(TicketStatus) as TicketStatusValue[],
);
export const ORDER_STATUS_VALUES = Object.freeze(Object.values(OrderStatus) as OrderStatusValue[]);
export const PAYMENT_STATUS_VALUES = Object.freeze(
  Object.values(PaymentStatus) as PaymentStatusValue[],
);
export const PAYMENT_METHOD_VALUES = Object.freeze(
  Object.values(PaymentMethod) as PaymentMethodValue[],
);
