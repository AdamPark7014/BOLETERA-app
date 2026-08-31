export type InitTerminalDto = {
  organizationId: string;
  locationName: string;
  terminalName: string;
  hardwareConfig?: Record<string, string>;
};

export type StartSessionDto = {
  terminalId: string;
  cashierId: string;
  openingCash?: number;
};

export type CheckoutDataDto = {
  eventId: string;
  offerId: string;
  quantity?: number;
  seatIds?: string[];
  paymentMethod: 'CASH' | 'CARD' | 'CHECK' | 'COMP';
  discountCode?: string;
  discountPercent?: number;
  cashierId?: string;
  buyerName?: string;
  buyerEmail?: string;
  buyerPhone?: string;
  isComp?: boolean;
  compReason?: string;
  managerPin?: string;
  clientSaleId?: string;
  holdIds?: string[];
};

export type QuickCheckoutDto = {
  terminalId: string;
  sessionId: string;
  checkoutData: CheckoutDataDto;
};

export type CreateHoldDto = {
  terminalId: string;
  sessionId: string;
  eventId: string;
  offerId?: string;
  seatIds?: string[];
  quantity?: number;
  cashierId?: string;
};

export type ReleaseHoldsDto = {
  holdIds: string[];
};

export type ProcessPaymentDto = {
  orderId: string;
  paymentData: {
    method: 'CASH' | 'CARD' | 'CHECK';
    amount: number;
    cardDetails?: { lastFour: string; brand: string };
  };
};

export type OfflineTransactionDto = {
  checkoutData: unknown;
  sessionId: string;
  clientSaleId?: string;
};

export type SyncOfflineDto = {
  transactions: OfflineTransactionDto[];
};

export type EndSessionDto = {
  sessionId: string;
  cashierId: string;
  closingCashCounted?: number;
  managerPin?: string;
};

export type VoidOrderDto = {
  orderId: string;
  sessionId?: string;
  cashierId?: string;
  reason?: string;
  managerPin?: string;
};

export type WillcallLookupDto = {
  q: string;
  organizationId?: string;
};

export type WillcallFulfillDto = {
  orderId: string;
  cashierId: string;
  terminalId?: string;
};

export type ExchangeDto = {
  orderId: string;
  sessionId: string;
  terminalId: string;
  cashierId: string;
  newOfferId?: string;
  newSeatIds?: string[];
  quantity?: number;
  paymentMethod: 'CASH' | 'CARD';
  managerPin?: string;
  cashReceived?: number;
};

export type CashDropDto = {
  sessionId: string;
  amount: number;
  note?: string;
  cashierId: string;
  managerPin: string;
};

export type ManagerPinDto = {
  organizationId: string;
  pin: string;
  currentPin?: string;
};

export type VerifyPinDto = {
  organizationId: string;
  pin: string;
};

export type HandoffDto = {
  sessionId: string;
  fromCashierId: string;
  toCashierId: string;
  openingCash?: number;
  closingCashCounted?: number;
  managerPin?: string;
};
