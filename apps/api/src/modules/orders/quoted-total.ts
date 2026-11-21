/** Tope PROFECO: el total de la orden no puede superar lo cotizado al apartar. */
export function applyQuotedCap(live: number, quoted: number | null | undefined): number {
  if (quoted == null || !Number.isFinite(quoted)) return live;
  if (!Number.isFinite(live)) return quoted;
  return Math.min(live, quoted);
}

export function sumQuotedTotals(holds: Array<{ quotedTotal?: unknown }>): number | null {
  let sum = 0;
  for (const h of holds) {
    const n = h.quotedTotal == null ? null : Number(h.quotedTotal);
    if (n == null || !Number.isFinite(n)) return null;
    sum += n;
  }
  return Math.round((sum + Number.EPSILON) * 100) / 100;
}
