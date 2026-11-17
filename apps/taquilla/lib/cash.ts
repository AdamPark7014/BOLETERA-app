/**
 * Cálculo de cambio.
 *
 * Es donde más se equivoca el operador con fila: el sistema dice cuánto devolver
 * y con qué piezas, y ofrece los billetes con los que realmente paga la gente.
 */

import { formatTicketAmount, formatNumber } from '@boletera/ui';

/** Denominaciones MXN en circulación, de mayor a menor. */
export const MXN_DENOMINATIONS = [1000, 500, 200, 100, 50, 20, 10, 5, 2, 1, 0.5] as const;

/** Billetes con los que se paga en ventanilla (los de $1000 casi nunca). */
const COMMON_BILLS = [50, 100, 200, 500, 1000];

export function money(n: number): string {
  return formatTicketAmount(Number(n || 0));
}

/** Etiqueta corta para los botones de billete: $500, $1,000. */
export function billLabel(n: number): string {
  // La moneda de 50 centavos: sin esto se redondeaba a «$1».
  if (n > 0 && n < 1) return `${Math.round(n * 100)}¢`;
  return `$${formatNumber(n, 0)}`;
}

/** Redondeo a centavos: 0.1 + 0.2 no puede acabar en un faltante de caja. */
export function round2(n: number): number {
  return Math.round((Number(n) + Number.EPSILON) * 100) / 100;
}

/**
 * Accesos rápidos de efectivo: importe exacto, redondeos "de bolsillo"
 * (siguiente múltiplo de 50 y de 100) y los billetes comunes que alcanzan.
 * Máximo 6 para que quepan en una fila de botones grandes.
 */
export function quickCashOptions(total: number): number[] {
  const amount = round2(total);
  if (!(amount > 0)) return [];
  const candidates = new Set<number>([amount]);
  const next50 = Math.ceil(amount / 50) * 50;
  const next100 = Math.ceil(amount / 100) * 100;
  if (next50 > amount) candidates.add(next50);
  if (next100 > amount) candidates.add(next100);
  for (const bill of COMMON_BILLS) if (bill >= amount) candidates.add(bill);
  return [...candidates].sort((a, b) => a - b).slice(0, 6);
}

export type ChangePiece = { value: number; count: number };

/** Desglose del cambio en piezas, de mayor a menor. */
export function changeBreakdown(change: number): ChangePiece[] {
  let left = round2(change);
  if (!(left > 0)) return [];
  const pieces: ChangePiece[] = [];
  for (const value of MXN_DENOMINATIONS) {
    const count = Math.floor(round2(left) / value);
    if (count > 0) {
      pieces.push({ value, count });
      left = round2(left - count * value);
    }
  }
  return pieces;
}

/** "1 × $100 · 1 × $20 · 1 × $10" para leerlo de un vistazo mientras se cuenta. */
export function changeBreakdownLabel(change: number): string {
  return changeBreakdown(change)
    .map((p) => `${p.count} × ${billLabel(p.value)}`)
    .join(' · ');
}

export type CashState = {
  total: number;
  received: number;
  change: number;
  /** `true` cuando lo recibido cubre el total (o el total es cero). */
  sufficient: boolean;
  /** Lo que falta cuando no cubre; 0 si cubre. */
  missing: number;
};

export function computeCash(total: number, receivedRaw: string | number): CashState {
  const totalR = round2(total);
  const received = round2(typeof receivedRaw === 'number' ? receivedRaw : Number(receivedRaw));
  const valid = Number.isFinite(received) && received >= 0;
  // Un campo vacío significa "importe exacto": pedir que teclee el total otra vez
  // es un error de diseño que cuesta segundos en cada venta.
  const effective = valid && String(receivedRaw).trim() !== '' ? received : totalR;
  return {
    total: totalR,
    received: effective,
    change: round2(Math.max(0, effective - totalR)),
    sufficient: effective >= totalR,
    missing: round2(Math.max(0, totalR - effective)),
  };
}

// ---------------------------------------------------------------------------
// Arqueo por denominación (corte de caja)
// ---------------------------------------------------------------------------

export type DenominationCount = Record<string, number>;

export function countedTotal(counts: DenominationCount): number {
  return round2(
    MXN_DENOMINATIONS.reduce((sum, value) => sum + value * (Number(counts[String(value)]) || 0), 0)
  );
}

// ---------------------------------------------------------------------------
// Pago mixto (efectivo + tarjeta). La cortesía sigue siendo un método aparte.
// ---------------------------------------------------------------------------

export type PosPayMethod = 'CASH' | 'CARD' | 'COMP';
export type PaymentPart = { method: PosPayMethod; amount: number };

/**
 * Parte en efectivo + resto con tarjeta. `cashPartRaw` es cuánto se cobra en
 * efectivo (no lo recibido del cliente): el cambio se calcula aparte.
 */
export function splitMixedPayment(
  total: number,
  cashPartRaw: string | number
): {
  cashPart: number;
  cardPart: number;
  parts: PaymentPart[];
  valid: boolean;
  error?: string;
} {
  const totalR = round2(total);
  const parsed = round2(typeof cashPartRaw === 'number' ? cashPartRaw : Number(cashPartRaw));
  if (!Number.isFinite(parsed) || parsed < 0) {
    return {
      cashPart: 0,
      cardPart: totalR,
      parts: totalR > 0 ? [{ method: 'CARD', amount: totalR }] : [],
      valid: false,
      error: 'El importe en efectivo no es válido.',
    };
  }
  if (parsed > totalR) {
    return {
      cashPart: totalR,
      cardPart: 0,
      parts: totalR > 0 ? [{ method: 'CASH', amount: totalR }] : [],
      valid: false,
      error: 'El efectivo no puede ser mayor que el total.',
    };
  }
  const cashPart = parsed;
  const cardPart = round2(totalR - cashPart);
  const parts: PaymentPart[] = [];
  if (cashPart > 0) parts.push({ method: 'CASH', amount: cashPart });
  if (cardPart > 0) parts.push({ method: 'CARD', amount: cardPart });
  return { cashPart, cardPart, parts, valid: true };
}

/** Cambio solo sobre la parte en efectivo del mixto. */
export function mixedCashState(cashPart: number, receivedRaw: string | number): CashState {
  return computeCash(cashPart, receivedRaw);
}

export function labelPaymentParts(parts: PaymentPart[]): string {
  const labels: Record<PosPayMethod, string> = {
    CASH: 'Efectivo',
    CARD: 'Tarjeta',
    COMP: 'Cortesía',
  };
  return parts
    .filter((p) => p.amount > 0)
    .map((p) => `${labels[p.method]} ${money(p.amount)}`)
    .join(' · ');
}
