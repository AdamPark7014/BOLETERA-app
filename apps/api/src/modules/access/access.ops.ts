/** Helpers de puerta (salida, reingreso, reglas) sin decoradores Nest. */

export const SCAN_REASON_ENTRY = 'ENTRY';
export const SCAN_REASON_EXIT = 'EXIT';
export const SCAN_REASON_REENTRY = 'REENTRY';

export type AccessGateRule = {
  allowedZones?: string[];
  allowedTicketTypes?: string[];
  allowedSections?: string[];
  label?: string;
};

export type AccessEventConfig = {
  reentryAllowed: boolean;
  maxReentries: number;
  gates: Record<string, AccessGateRule>;
};

export type TicketGateFields = {
  section?: string | null;
  offer?: { name?: string | null; zone?: string | null } | null;
};

function asObject(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function asStringList(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const list = value.filter((v): v is string => typeof v === 'string' && v.trim().length > 0);
  return list.length ? list : undefined;
}

/** Lee `event.metadata.access`. Sin config: no reingreso y sin reglas de puerta. */
export function readAccessConfig(metadata: unknown): AccessEventConfig {
  const root = asObject(metadata);
  const raw = asObject(root.access);
  const gatesRaw = asObject(raw.gates);
  const gates: Record<string, AccessGateRule> = {};
  for (const [id, ruleVal] of Object.entries(gatesRaw)) {
    const rule = asObject(ruleVal);
    gates[id] = {
      allowedZones: asStringList(rule.allowedZones),
      allowedTicketTypes: asStringList(rule.allowedTicketTypes),
      allowedSections: asStringList(rule.allowedSections),
      label: typeof rule.label === 'string' ? rule.label : undefined,
    };
  }
  const maxRaw = raw.maxReentries ?? raw.reentryLimit;
  return {
    reentryAllowed: raw.reentryAllowed === true || raw.allowReentry === true,
    maxReentries: Math.max(0, Number(maxRaw) || 0),
    gates,
  };
}

export function isEntryReason(reason?: string | null): boolean {
  return !reason || reason === SCAN_REASON_ENTRY || reason === SCAN_REASON_REENTRY;
}

export function isExitReason(reason?: string | null): boolean {
  return reason === SCAN_REASON_EXIT;
}

function listHas(list: string[] | undefined, value: string | null | undefined): boolean {
  if (!list?.length) return true;
  if (!value?.trim()) return false;
  const needle = value.trim().toLowerCase();
  return list.some((v) => v.trim().toLowerCase() === needle);
}

/** Si ninguna lista tiene valores, la puerta no restringe. Listas con valores se cumplen todas (AND). */
export function ticketMatchesGate(rule: AccessGateRule, ticket: TicketGateFields): boolean {
  const hasZones = !!rule.allowedZones?.length;
  const hasTypes = !!rule.allowedTicketTypes?.length;
  const hasSections = !!rule.allowedSections?.length;
  if (!hasZones && !hasTypes && !hasSections) return true;
  return (
    listHas(rule.allowedZones, ticket.offer?.zone) &&
    listHas(rule.allowedTicketTypes, ticket.offer?.name) &&
    listHas(rule.allowedSections, ticket.section)
  );
}

export function findCorrectGateLabel(
  gates: Record<string, AccessGateRule>,
  ticket: TicketGateFields,
  zoneNames?: Map<string, string>
): string {
  for (const [id, rule] of Object.entries(gates)) {
    if (ticketMatchesGate(rule, ticket)) {
      return rule.label || zoneNames?.get(id) || id;
    }
  }
  return 'correcta';
}

/** Aforo dentro = entradas − salidas (éxitos). Una persona puede salir por otra puerta. */
export function summarizeGateTraffic(
  scans: Array<{ zoneId: string | null; reason: string | null }>
): {
  insideNow: number;
  exited: number;
  entries: number;
  byZone: Map<string | null, { entries: number; exited: number; inside: number }>;
} {
  const byZone = new Map<string | null, { entries: number; exited: number; inside: number }>();
  let entries = 0;
  let exited = 0;

  for (const scan of scans) {
    let row = byZone.get(scan.zoneId);
    if (!row) {
      row = { entries: 0, exited: 0, inside: 0 };
      byZone.set(scan.zoneId, row);
    }
    if (isExitReason(scan.reason)) {
      exited += 1;
      row.exited += 1;
    } else if (isEntryReason(scan.reason)) {
      entries += 1;
      row.entries += 1;
    }
  }

  for (const row of byZone.values()) {
    row.inside = Math.max(0, row.entries - row.exited);
  }

  return {
    entries,
    exited,
    insideNow: Math.max(0, entries - exited),
    byZone,
  };
}
