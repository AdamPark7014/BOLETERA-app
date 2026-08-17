/**
 * Money primitives for the platform.
 *
 * Single source of truth: every package and app must express amounts either as
 * integer minor units (centavos) or as a `MoneyAmount`. Floating point majors
 * are only allowed at the edges (provider payloads, legacy DB columns) and must
 * be converted with `toMinorUnits` before any arithmetic happens.
 */

export type CurrencyCode = 'MXN' | 'USD';

export const DEFAULT_CURRENCY: CurrencyCode = 'MXN';
export const DEFAULT_LOCALE = 'es-MX';

/** Decimal digits of the currency's minor unit. */
export const CURRENCY_MINOR_DIGITS: Record<CurrencyCode, number> = {
  MXN: 2,
  USD: 2,
};

/** ISO 4217 numeric codes, required by Mexican bank gateways (Payworks). */
export const CURRENCY_NUMERIC_CODES: Record<CurrencyCode, string> = {
  MXN: '484',
  USD: '840',
};

/** IVA general vigente en México. */
export const MEXICO_VAT_RATE = 0.16;

export interface MoneyAmount {
  /** Integer amount in minor units (centavos for MXN). Never fractional. */
  amountMinor: number;
  currency: CurrencyCode;
}

export function isCurrencyCode(value: string): value is CurrencyCode {
  return value === 'MXN' || value === 'USD';
}

/**
 * Narrow an arbitrary currency string, falling back to MXN.
 * Callers that must reject unknown currencies should use `isCurrencyCode`.
 */
export function toCurrencyCode(value: string | null | undefined): CurrencyCode {
  if (typeof value !== 'string') return DEFAULT_CURRENCY;
  const upper = value.trim().toUpperCase();
  return isCurrencyCode(upper) ? upper : DEFAULT_CURRENCY;
}

function minorFactor(currency: CurrencyCode): number {
  return 10 ** CURRENCY_MINOR_DIGITS[currency];
}

/** Round half away from zero, the convention used for Mexican invoicing. */
export function roundHalfAwayFromZero(value: number): number {
  return value < 0 ? -Math.round(-value) : Math.round(value);
}

export function isValidMinorAmount(value: number): boolean {
  return Number.isSafeInteger(value);
}

/**
 * Convert a major-unit amount (pesos) to integer minor units.
 * Uses an epsilon nudge so 19.99 * 100 = 1998.9999… still lands on 1999.
 */
export function toMinorUnits(amount: number, currency: CurrencyCode = DEFAULT_CURRENCY): number {
  if (!Number.isFinite(amount)) {
    throw new RangeError(`Importe no numérico: ${String(amount)}`);
  }
  const scaled = amount * minorFactor(currency);
  const nudged = scaled + (scaled < 0 ? -1e-6 : 1e-6);
  const minor = roundHalfAwayFromZero(nudged);
  if (!isValidMinorAmount(minor)) {
    throw new RangeError(`Importe fuera de rango seguro: ${String(amount)}`);
  }
  return minor;
}

export function fromMinorUnits(
  amountMinor: number,
  currency: CurrencyCode = DEFAULT_CURRENCY,
): number {
  return amountMinor / minorFactor(currency);
}

export function money(amount: number, currency: CurrencyCode = DEFAULT_CURRENCY): MoneyAmount {
  return { amountMinor: toMinorUnits(amount, currency), currency };
}

export function moneyFromMinor(
  amountMinor: number,
  currency: CurrencyCode = DEFAULT_CURRENCY,
): MoneyAmount {
  if (!isValidMinorAmount(amountMinor)) {
    throw new RangeError(`Centavos inválidos: ${String(amountMinor)}`);
  }
  return { amountMinor, currency };
}

function assertSameCurrency(a: MoneyAmount, b: MoneyAmount): void {
  if (a.currency !== b.currency) {
    throw new TypeError(`No se pueden operar importes en ${a.currency} y ${b.currency}`);
  }
}

export function addMoney(a: MoneyAmount, b: MoneyAmount): MoneyAmount {
  assertSameCurrency(a, b);
  return moneyFromMinor(a.amountMinor + b.amountMinor, a.currency);
}

export function subtractMoney(a: MoneyAmount, b: MoneyAmount): MoneyAmount {
  assertSameCurrency(a, b);
  return moneyFromMinor(a.amountMinor - b.amountMinor, a.currency);
}

export function sumMoney(
  amounts: readonly MoneyAmount[],
  currency: CurrencyCode = DEFAULT_CURRENCY,
): MoneyAmount {
  return amounts.reduce<MoneyAmount>(
    (acc, item) => addMoney(acc, item),
    moneyFromMinor(0, currency),
  );
}

/** Multiply by a unit count. Only integer factors keep money exact. */
export function multiplyMoney(amount: MoneyAmount, quantity: number): MoneyAmount {
  if (!Number.isSafeInteger(quantity)) {
    throw new RangeError(`Cantidad no entera: ${String(quantity)}`);
  }
  return moneyFromMinor(amount.amountMinor * quantity, amount.currency);
}

/** Apply a rate (fee, discount, tax) rounding to the nearest centavo. */
export function applyRate(amount: MoneyAmount, rate: number): MoneyAmount {
  if (!Number.isFinite(rate)) {
    throw new RangeError(`Tasa no numérica: ${String(rate)}`);
  }
  return moneyFromMinor(roundHalfAwayFromZero(amount.amountMinor * rate), amount.currency);
}

/** Net + IVA. */
export function addVat(net: MoneyAmount, rate: number = MEXICO_VAT_RATE): MoneyAmount {
  return addMoney(net, applyRate(net, rate));
}

/** Split a VAT-inclusive amount into net and tax without losing a centavo. */
export function splitVatInclusive(
  gross: MoneyAmount,
  rate: number = MEXICO_VAT_RATE,
): { net: MoneyAmount; tax: MoneyAmount } {
  const net = moneyFromMinor(
    roundHalfAwayFromZero(gross.amountMinor / (1 + rate)),
    gross.currency,
  );
  return { net, tax: subtractMoney(gross, net) };
}

/**
 * Distribute `total` across `weights` using the largest-remainder method.
 * The returned parts always add back up to `total` exactly — use this for
 * splitting fees, discounts or payouts across order lines.
 */
export function allocateMinor(totalMinor: number, weights: readonly number[]): number[] {
  if (!isValidMinorAmount(totalMinor)) {
    throw new RangeError(`Centavos inválidos: ${String(totalMinor)}`);
  }
  if (weights.length === 0) return [];
  if (weights.some((w) => !Number.isFinite(w) || w < 0)) {
    throw new RangeError('Los pesos de reparto deben ser finitos y no negativos');
  }

  const totalWeight = weights.reduce((acc, w) => acc + w, 0);
  if (totalWeight === 0) {
    // No signal to weight by: spread evenly, remainder to the first buckets.
    const base = Math.trunc(totalMinor / weights.length);
    const parts = weights.map(() => base);
    let rest = totalMinor - base * weights.length;
    const step = rest < 0 ? -1 : 1;
    for (let i = 0; rest !== 0; i = (i + 1) % weights.length) {
      parts[i] += step;
      rest -= step;
    }
    return parts;
  }

  const exact = weights.map((w) => (totalMinor * w) / totalWeight);
  const floors = exact.map((value) => Math.floor(value));
  let remainder = totalMinor - floors.reduce((acc, value) => acc + value, 0);
  const order = exact
    .map((value, index) => ({ index, frac: value - Math.floor(value) }))
    .sort((a, b) => b.frac - a.frac || a.index - b.index);

  for (const entry of order) {
    if (remainder === 0) break;
    floors[entry.index] += 1;
    remainder -= 1;
  }
  return floors;
}

export function compareMoney(a: MoneyAmount, b: MoneyAmount): number {
  assertSameCurrency(a, b);
  return a.amountMinor - b.amountMinor;
}

export function isZeroMoney(amount: MoneyAmount): boolean {
  return amount.amountMinor === 0;
}

export function isNegativeMoney(amount: MoneyAmount): boolean {
  return amount.amountMinor < 0;
}

const currencyFormatters = new Map<string, Intl.NumberFormat>();

function currencyFormatter(
  currency: CurrencyCode,
  locale: string,
  fractionDigits: number,
): Intl.NumberFormat {
  const key = `${locale}|${currency}|${fractionDigits}`;
  let formatter = currencyFormatters.get(key);
  if (!formatter) {
    formatter = new Intl.NumberFormat(locale, {
      style: 'currency',
      currency,
      minimumFractionDigits: fractionDigits,
      maximumFractionDigits: fractionDigits,
    });
    currencyFormatters.set(key, formatter);
  }
  return formatter;
}

export interface FormatMoneyOptions {
  locale?: string;
  /** Drop centavos (dashboard/KPI style). */
  compact?: boolean;
}

/** `1234567` → `"$12,345.67"` in es-MX. */
export function formatMoney(amount: MoneyAmount, options: FormatMoneyOptions = {}): string {
  const digits = options.compact ? 0 : CURRENCY_MINOR_DIGITS[amount.currency];
  return currencyFormatter(amount.currency, options.locale ?? DEFAULT_LOCALE, digits).format(
    fromMinorUnits(amount.amountMinor, amount.currency),
  );
}

/** Format a major-unit number coming from a legacy column or API payload. */
export function formatMoneyMajor(
  amount: number,
  currency: CurrencyCode = DEFAULT_CURRENCY,
  options: FormatMoneyOptions = {},
): string {
  return formatMoney(money(amount, currency), options);
}

/** Fixed-decimal string a gateway expects (`"1234.50"`). Never localized. */
export function toGatewayAmountString(amount: MoneyAmount): string {
  return fromMinorUnits(amount.amountMinor, amount.currency).toFixed(
    CURRENCY_MINOR_DIGITS[amount.currency],
  );
}
