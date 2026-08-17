import type { SeasonPass } from '@/lib/queries/season';
import type { BadgeTone, ProgressRingTone } from '@boletera/ui';
import { safeRatio, toCents, type Cents } from './money';

/** Estados operativos derivados del inventario y la bandera `active`. */
export type PassStatus = 'active' | 'soldout' | 'inactive';

export type StatusFilter = 'all' | PassStatus;
export type SortKey = 'adoption' | 'inventory' | 'revenue' | 'name';

export type PassStatusMeta = {
  id: PassStatus;
  label: string;
  tone: BadgeTone;
  ringTone: ProgressRingTone;
};

const STATUS_META: Record<PassStatus, PassStatusMeta> = {
  active: {
    id: 'active',
    label: 'En venta',
    tone: 'success',
    ringTone: 'success',
  },
  soldout: {
    id: 'soldout',
    label: 'Agotado',
    tone: 'danger',
    ringTone: 'danger',
  },
  inactive: {
    id: 'inactive',
    label: 'Inactivo',
    tone: 'neutral',
    ringTone: 'accent',
  },
};

export function passStatusMeta(status: PassStatus): PassStatusMeta {
  return STATUS_META[status];
}

export function passPriceCents(pass: SeasonPass): Cents {
  return toCents(pass.price);
}

export function remaining(pass: SeasonPass): number {
  return Math.max(pass.maxQuantity - pass.soldQuantity, 0);
}

export function isSoldOut(pass: SeasonPass): boolean {
  return remaining(pass) <= 0;
}

export function adoptionRate(pass: SeasonPass): number {
  return safeRatio(pass.soldQuantity, pass.maxQuantity) ?? 0;
}

export function revenueCents(pass: SeasonPass): Cents {
  return pass.soldQuantity * passPriceCents(pass);
}

export function statusOf(pass: SeasonPass): PassStatus {
  if (!pass.active) return 'inactive';
  if (isSoldOut(pass)) return 'soldout';
  return 'active';
}

export type SeasonKpis = {
  active: number;
  sold: number;
  capacity: number;
  revenueCents: Cents;
  inventory: number;
  adoption: number;
  renewable: number;
};

export function computeSeasonKpis(passes: readonly SeasonPass[]): SeasonKpis {
  const active = passes.filter((pass) => pass.active).length;
  const sold = passes.reduce((sum, pass) => sum + pass.soldQuantity, 0);
  const capacity = passes.reduce((sum, pass) => sum + pass.maxQuantity, 0);
  const revenue = passes.reduce((sum, pass) => sum + revenueCents(pass), 0);
  const inventory = Math.max(capacity - sold, 0);
  const adoption = safeRatio(sold, capacity) ?? 0;
  const renewable = passes.filter(
    (pass) => pass.active && adoptionRate(pass) >= 0.7 && !isSoldOut(pass),
  ).length;

  return {
    active,
    sold,
    capacity,
    revenueCents: revenue,
    inventory,
    adoption,
    renewable,
  };
}

export type SeasonAlert = {
  id: string;
  tone: BadgeTone;
  text: string;
};

export function buildSeasonAlerts(passes: readonly SeasonPass[]): SeasonAlert[] {
  const items: SeasonAlert[] = [];
  const low = passes.filter(
    (pass) =>
      pass.active &&
      remaining(pass) > 0 &&
      remaining(pass) / pass.maxQuantity <= 0.15,
  );
  const soldOut = passes.filter((pass) => pass.active && isSoldOut(pass));
  const inactive = passes.filter((pass) => !pass.active);

  if (soldOut.length > 0) {
    items.push({
      id: 'soldout',
      tone: 'danger',
      text: `${soldOut.length} abono${soldOut.length === 1 ? '' : 's'} agotado${soldOut.length === 1 ? '' : 's'}. Revisa inventario o abre cupo.`,
    });
  }
  if (low.length > 0) {
    items.push({
      id: 'low',
      tone: 'warning',
      text: `${low.length} abono${low.length === 1 ? '' : 's'} con menos del 15% de inventario.`,
    });
  }
  if (inactive.length > 0) {
    items.push({
      id: 'inactive',
      tone: 'info',
      text: `${inactive.length} abono${inactive.length === 1 ? '' : 's'} inactivo${inactive.length === 1 ? '' : 's'} fuera de venta.`,
    });
  }
  return items;
}

export type SeasonBucket = {
  label: string;
  sold: number;
  capacity: number;
  count: number;
  rate: number;
  revenueCents: Cents;
};

export function adoptionBySeason(passes: readonly SeasonPass[]): SeasonBucket[] {
  const map = new Map<
    string,
    { sold: number; capacity: number; count: number; revenueCents: Cents }
  >();

  for (const pass of passes) {
    const current = map.get(pass.seasonLabel) ?? {
      sold: 0,
      capacity: 0,
      count: 0,
      revenueCents: 0,
    };
    current.sold += pass.soldQuantity;
    current.capacity += pass.maxQuantity;
    current.count += 1;
    current.revenueCents += revenueCents(pass);
    map.set(pass.seasonLabel, current);
  }

  return Array.from(map.entries())
    .map(([label, value]) => ({
      label,
      ...value,
      rate: safeRatio(value.sold, value.capacity) ?? 0,
    }))
    .sort((a, b) => b.rate - a.rate);
}

export type InventoryPressure = 'agotado' | 'critico' | 'estable';

export type InventoryRow = {
  id: string;
  name: string;
  left: number;
  pressure: number;
  level: InventoryPressure;
  tone: BadgeTone;
};

export function inventoryHealth(passes: readonly SeasonPass[], limit = 5): InventoryRow[] {
  return [...passes]
    .filter((pass) => pass.active)
    .sort((a, b) => {
      const ra = a.maxQuantity > 0 ? remaining(a) / a.maxQuantity : 0;
      const rb = b.maxQuantity > 0 ? remaining(b) / b.maxQuantity : 0;
      return ra - rb;
    })
    .slice(0, limit)
    .map((pass) => {
      const left = remaining(pass);
      const pressure = pass.maxQuantity > 0 ? 1 - left / pass.maxQuantity : 0;
      const level: InventoryPressure =
        left === 0 ? 'agotado' : pressure >= 0.85 ? 'critico' : 'estable';
      const tone: BadgeTone =
        level === 'agotado' ? 'danger' : level === 'critico' ? 'warning' : 'info';
      return { id: pass.id, name: pass.name, left, pressure, level, tone };
    });
}

export function seasonLabelsOf(passes: readonly SeasonPass[]): string[] {
  return Array.from(new Set(passes.map((pass) => pass.seasonLabel))).sort();
}

export function matchesPassQuery(pass: SeasonPass, query: string): boolean {
  const term = query.trim().toLowerCase();
  if (!term) return true;
  return (
    pass.name.toLowerCase().includes(term) ||
    pass.slug.toLowerCase().includes(term) ||
    pass.seasonLabel.toLowerCase().includes(term)
  );
}

export function filterAndSortPasses(
  passes: readonly SeasonPass[],
  options: {
    query: string;
    season: string;
    status: StatusFilter;
    sort: SortKey;
  },
): SeasonPass[] {
  const rows = passes.filter((pass) => {
    const matchesSearch = matchesPassQuery(pass, options.query);
    const matchesSeason = options.season === 'all' || pass.seasonLabel === options.season;
    const matchesStatus = options.status === 'all' || statusOf(pass) === options.status;
    return matchesSearch && matchesSeason && matchesStatus;
  });

  return rows.sort((a, b) => {
    if (options.sort === 'name') return a.name.localeCompare(b.name, 'es');
    if (options.sort === 'inventory') return remaining(a) - remaining(b);
    if (options.sort === 'revenue') return revenueCents(b) - revenueCents(a);
    return adoptionRate(b) - adoptionRate(a);
  });
}

export function slugify(value: string): string {
  return value
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/(^-|-$)/g, '');
}

export const STATUS_FILTER_OPTIONS: readonly { value: StatusFilter; label: string }[] = [
  { value: 'all', label: 'Todos' },
  { value: 'active', label: 'En venta' },
  { value: 'soldout', label: 'Agotados' },
  { value: 'inactive', label: 'Inactivos' },
];

export const SORT_OPTIONS: readonly { value: SortKey; label: string }[] = [
  { value: 'adoption', label: 'Mayor adopción' },
  { value: 'inventory', label: 'Menor inventario' },
  { value: 'revenue', label: 'Mayor ingreso' },
  { value: 'name', label: 'Nombre A–Z' },
];
