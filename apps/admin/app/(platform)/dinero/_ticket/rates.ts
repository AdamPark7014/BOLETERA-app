import { asRecord, readNumber } from '../../events/_ticket/read';

export type OrgMoney = {
  commissionRate: number;
  resaleCommission: number;
  allowResale: boolean;
  feesInclusive: boolean;
};

export type PriceExample = {
  base: number;
  fees: number;
  taxes: number;
  total: number;
};

export type PricingRates = {
  serviceFeeRate: number;
  taxRate: number;
  serviceFeeSaved: boolean;
  taxSaved: boolean;
  example: PriceExample;
};

/** Misma fórmula que el API: base + cargo + IVA, redondeada a centavos. */
export function exampleFromRates(base: number, serviceFeeRate: number, taxRate: number): PriceExample {
  const safeBase = Number.isFinite(base) && base > 0 ? base : 0;
  const round2 = (value: number) => Math.round((value + Number.EPSILON) * 100) / 100;
  const fees = round2(safeBase * serviceFeeRate);
  const taxes = round2(safeBase * taxRate);
  return { base: round2(safeBase), fees, taxes, total: round2(safeBase + fees + taxes) };
}

export type ResaleLimits = {
  minPercent: number;
  maxPercent: number;
  feePercent: number;
};

export function percentLabel(rate: number | null | undefined): string {
  if (rate == null || !Number.isFinite(rate)) return '—';
  const points = Math.round(rate * 1000) / 10;
  const text = Number.isInteger(points)
    ? points.toLocaleString('es-MX')
    : points.toLocaleString('es-MX', { minimumFractionDigits: 1, maximumFractionDigits: 1 });
  return `${text}%`;
}

/** Puntos enteros 0–100 para el paso. */
export function percentPoints(rate: number | null | undefined): number {
  if (rate == null || !Number.isFinite(rate)) return 0;
  return Math.min(100, Math.max(0, Math.round(rate * 100)));
}

export function rateFromPoints(points: number): number {
  return Number((points / 100).toFixed(4));
}

export function readOrgMoney(raw: unknown): OrgMoney | null {
  const row = asRecord(raw);
  if (typeof row.id !== 'string') return null;
  return {
    commissionRate: readNumber(row.commissionRate) ?? 0.15,
    resaleCommission: readNumber(row.resaleCommission) ?? 0.08,
    allowResale: typeof row.allowResale === 'boolean' ? row.allowResale : true,
    feesInclusive: row.feesInclusive === true,
  };
}

export function readPricingRates(raw: unknown): PricingRates | null {
  const row = asRecord(raw);
  const example = asRecord(row.example);
  const serviceFeeRate = readNumber(row.serviceFeeRate);
  const taxRate = readNumber(row.taxRate);
  const base = readNumber(example.base);
  const fees = readNumber(example.fees);
  const taxes = readNumber(example.taxes);
  const total = readNumber(example.total);
  if (
    serviceFeeRate == null ||
    taxRate == null ||
    base == null ||
    fees == null ||
    taxes == null ||
    total == null
  ) {
    return null;
  }
  return {
    serviceFeeRate,
    taxRate,
    serviceFeeSaved: row.serviceFeeSaved === true,
    taxSaved: row.taxSaved === true,
    example: { base, fees, taxes, total },
  };
}

export function readResaleLimits(raw: unknown): ResaleLimits | null {
  const row = asRecord(raw);
  const minPercent = readNumber(row.minPercent);
  const maxPercent = readNumber(row.maxPercent);
  const feePercent = readNumber(row.feePercent);
  if (minPercent == null || maxPercent == null || feePercent == null) return null;
  return { minPercent, maxPercent, feePercent };
}
