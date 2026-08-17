import type {
  Sponsor,
  SponsorshipAsset,
  SponsorshipComplianceSummary,
  SponsorshipPackage,
} from '@/lib/queries/sponsorships';
import type { BadgeTone } from '@boletera/ui';
import { normalizeRate, safeRatio, toCents, type Cents } from './money';

export type PackageStatusFilter =
  | 'all'
  | 'PROSPECT'
  | 'PROPOSAL'
  | 'NEGOTIATION'
  | 'ACTIVE'
  | 'FULFILLED'
  | 'CHURNED';

export type SortKey = 'value' | 'deliverables' | 'roi' | 'name' | 'status';

export const STATUS_FILTER_OPTIONS: ReadonlyArray<{
  value: PackageStatusFilter;
  label: string;
}> = [
  { value: 'all', label: 'Todos' },
  { value: 'PROSPECT', label: 'Prospecto' },
  { value: 'PROPOSAL', label: 'Propuesta' },
  { value: 'NEGOTIATION', label: 'Negociación' },
  { value: 'ACTIVE', label: 'Activo' },
  { value: 'FULFILLED', label: 'Cumplido' },
  { value: 'CHURNED', label: 'Perdido' },
];

export const SORT_OPTIONS: ReadonlyArray<{ value: SortKey; label: string }> = [
  { value: 'value', label: 'Mayor valor' },
  { value: 'deliverables', label: 'Entregables' },
  { value: 'roi', label: 'Mayor ROI' },
  { value: 'status', label: 'Estado' },
  { value: 'name', label: 'Nombre A–Z' },
];

const PIPELINE_ORDER: readonly string[] = [
  'PROSPECT',
  'PROPOSAL',
  'NEGOTIATION',
  'ACTIVE',
  'FULFILLED',
  'CHURNED',
];

export function packageStatusMeta(status: string): { label: string; tone: BadgeTone } {
  switch (status.toUpperCase()) {
    case 'PROSPECT':
      return { label: 'Prospecto', tone: 'neutral' };
    case 'PROPOSAL':
      return { label: 'Propuesta', tone: 'info' };
    case 'NEGOTIATION':
      return { label: 'Negociación', tone: 'warning' };
    case 'ACTIVE':
      return { label: 'Activo', tone: 'success' };
    case 'FULFILLED':
      return { label: 'Cumplido', tone: 'accent' };
    case 'CHURNED':
      return { label: 'Perdido', tone: 'danger' };
    default:
      return { label: status, tone: 'neutral' };
  }
}

export function packageValueCents(pkg: SponsorshipPackage): Cents {
  return toCents(pkg.value);
}

export function deliverableRate(pkg: SponsorshipPackage): number | null {
  return safeRatio(pkg.deliverablesDone, pkg.deliverablesTotal);
}

export function packageRoi(pkg: SponsorshipPackage): number | null {
  return normalizeRate(pkg.actualRoi ?? pkg.estimatedRoi ?? null);
}

export function hasRoiData(packages: readonly SponsorshipPackage[]): boolean {
  return packages.some(
    (pkg) =>
      (pkg.actualRoi != null && Number.isFinite(pkg.actualRoi)) ||
      (pkg.estimatedRoi != null && Number.isFinite(pkg.estimatedRoi)),
  );
}

export type SponsorshipKpis = {
  sponsors: number;
  assets: number;
  activePackages: number;
  pipelineValueCents: Cents;
  deliverableRate: number | null;
  complianceRate: number | null;
  avgRoi: number | null;
};

export function computeSponsorshipKpis(
  sponsors: readonly Sponsor[],
  assets: readonly SponsorshipAsset[],
  packages: readonly SponsorshipPackage[],
  compliance: SponsorshipComplianceSummary | undefined,
): SponsorshipKpis {
  const activePackages = packages.filter(
    (pkg) => pkg.status.toUpperCase() === 'ACTIVE',
  ).length;
  const pipelineValue = packages
    .filter((pkg) => {
      const status = pkg.status.toUpperCase();
      return status !== 'CHURNED' && status !== 'FULFILLED';
    })
    .reduce((sum, pkg) => sum + packageValueCents(pkg), 0);

  const done = packages.reduce((sum, pkg) => sum + pkg.deliverablesDone, 0);
  const total = packages.reduce((sum, pkg) => sum + pkg.deliverablesTotal, 0);

  const rois = packages
    .map((pkg) => packageRoi(pkg))
    .filter((roi): roi is number => roi !== null);
  const avgRoi =
    rois.length > 0 ? rois.reduce((a, b) => a + b, 0) / rois.length : null;

  return {
    sponsors: sponsors.length,
    assets: assets.length,
    activePackages,
    pipelineValueCents: pipelineValue,
    deliverableRate: safeRatio(done, total),
    complianceRate: normalizeRate(compliance?.onTrackRate ?? null),
    avgRoi,
  };
}

export type SponsorshipAlert = {
  id: string;
  tone: BadgeTone;
  text: string;
};

export function buildSponsorshipAlerts(
  packages: readonly SponsorshipPackage[],
  assets: readonly SponsorshipAsset[],
  compliance: SponsorshipComplianceSummary | undefined,
): SponsorshipAlert[] {
  const items: SponsorshipAlert[] = [];
  const negotiation = packages.filter(
    (pkg) => pkg.status.toUpperCase() === 'NEGOTIATION',
  );
  const overdue = packages.filter((pkg) => {
    if (!pkg.endsAt) return false;
    const end = new Date(pkg.endsAt).getTime();
    if (Number.isNaN(end)) return false;
    const rate = deliverableRate(pkg);
    return end < Date.now() && (rate == null || rate < 1) && pkg.status.toUpperCase() === 'ACTIVE';
  });
  const overAllocated = assets.filter((asset) => asset.allocated > asset.inventory);

  if (compliance && compliance.overdueDeliverables > 0) {
    items.push({
      id: 'overdue-deliverables',
      tone: 'danger',
      text: `${compliance.overdueDeliverables} entregable${compliance.overdueDeliverables === 1 ? '' : 's'} vencido${compliance.overdueDeliverables === 1 ? '' : 's'}.`,
    });
  }
  if (overdue.length > 0) {
    items.push({
      id: 'overdue-packages',
      tone: 'danger',
      text: `${overdue.length} paquete${overdue.length === 1 ? '' : 's'} activo${overdue.length === 1 ? '' : 's'} con fecha vencida y entregables pendientes.`,
    });
  }
  if (overAllocated.length > 0) {
    items.push({
      id: 'over-allocated',
      tone: 'warning',
      text: `${overAllocated.length} activo${overAllocated.length === 1 ? '' : 's'} sobreasignado${overAllocated.length === 1 ? '' : 's'}.`,
    });
  }
  if (negotiation.length > 0) {
    items.push({
      id: 'negotiation',
      tone: 'info',
      text: `${negotiation.length} paquete${negotiation.length === 1 ? '' : 's'} en negociación.`,
    });
  }
  return items;
}

export type PipelineStage = {
  status: string;
  label: string;
  count: number;
  valueCents: Cents;
  tone: BadgeTone;
};

export function buildPipeline(packages: readonly SponsorshipPackage[]): PipelineStage[] {
  const map = new Map<string, PipelineStage>();
  for (const status of PIPELINE_ORDER) {
    const meta = packageStatusMeta(status);
    map.set(status, {
      status,
      label: meta.label,
      count: 0,
      valueCents: 0,
      tone: meta.tone,
    });
  }
  for (const pkg of packages) {
    const key = pkg.status.toUpperCase();
    const meta = packageStatusMeta(key);
    const current = map.get(key) ?? {
      status: key,
      label: meta.label,
      count: 0,
      valueCents: 0,
      tone: meta.tone,
    };
    map.set(key, {
      ...current,
      count: current.count + 1,
      valueCents: current.valueCents + packageValueCents(pkg),
    });
  }
  return [...map.values()].filter((stage) => stage.count > 0 || PIPELINE_ORDER.includes(stage.status));
}

export type AssetHealth = {
  id: string;
  name: string;
  type: string;
  utilization: number;
  remaining: number;
  exclusiveCategory: string | null;
};

export function assetHealth(assets: readonly SponsorshipAsset[]): AssetHealth[] {
  return assets.map((asset) => ({
    id: asset.id,
    name: asset.name,
    type: asset.type,
    utilization: safeRatio(asset.allocated, asset.inventory) ?? 0,
    remaining: Math.max(asset.inventory - asset.allocated, 0),
    exclusiveCategory: asset.exclusiveCategory ?? null,
  }));
}

export function assetTypeLabel(type: string): string {
  switch (type.toUpperCase()) {
    case 'VENUE':
      return 'Venue';
    case 'DIGITAL':
      return 'Digital';
    case 'HOSPITALITY':
      return 'Hospitality';
    case 'CONTENT':
      return 'Contenido';
    case 'ON_SITE':
      return 'En sitio';
    default:
      return type;
  }
}

export function filterAndSortPackages(
  packages: readonly SponsorshipPackage[],
  opts: { query: string; status: PackageStatusFilter; sort: SortKey },
): SponsorshipPackage[] {
  const needle = opts.query.trim().toLocaleLowerCase('es-MX');
  const filtered = packages.filter((pkg) => {
    if (opts.status !== 'all' && pkg.status.toUpperCase() !== opts.status) return false;
    if (!needle) return true;
    return `${pkg.name} ${pkg.sponsorName ?? ''} ${pkg.category ?? ''} ${pkg.status}`
      .toLocaleLowerCase('es-MX')
      .includes(needle);
  });

  const sorted = [...filtered];
  sorted.sort((a, b) => {
    switch (opts.sort) {
      case 'deliverables':
        return (deliverableRate(b) ?? -1) - (deliverableRate(a) ?? -1);
      case 'roi':
        return (packageRoi(b) ?? -1) - (packageRoi(a) ?? -1);
      case 'status':
        return (
          PIPELINE_ORDER.indexOf(a.status.toUpperCase()) -
          PIPELINE_ORDER.indexOf(b.status.toUpperCase())
        );
      case 'name':
        return a.name.localeCompare(b.name, 'es-MX');
      case 'value':
      default:
        return packageValueCents(b) - packageValueCents(a);
    }
  });
  return sorted;
}
