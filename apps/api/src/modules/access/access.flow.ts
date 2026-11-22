import {
  SCAN_REASON_EXIT,
  SCAN_REASON_REENTRY,
  findCorrectGateLabel,
  readAccessConfig,
  ticketMatchesGate,
  type AccessEventConfig,
  type TicketGateFields,
} from './access.ops';

export type TicketLike = TicketGateFields & {
  id: string;
  code: string;
  status: string;
  row?: string | null;
  seatNumber?: string | null;
  buyerName?: string | null;
  eventId: string;
  event: { title: string; metadata?: unknown };
};

type ScanLookup = {
  ticketScan: {
    findFirst: (args: unknown) => Promise<{ reason: string | null } | null>;
    count: (args: unknown) => Promise<number>;
  };
};

/** Si la puerta tiene reglas, el boleto debe encajar; si no, indica la puerta correcta. */
export function assertGateAllows(
  zoneId: string | undefined,
  ticket: TicketGateFields,
  config: AccessEventConfig,
  zoneNames?: Map<string, string>
): { ok: true } | { ok: false; label: string } {
  if (!zoneId) return { ok: true };
  const rule = config.gates[zoneId];
  if (!rule) return { ok: true };
  if (ticketMatchesGate(rule, ticket)) return { ok: true };
  return {
    ok: false,
    label: findCorrectGateLabel(config.gates, ticket, zoneNames),
  };
}

export function accessConfigFromTicket(ticket: {
  event: { metadata?: unknown };
}): AccessEventConfig {
  return readAccessConfig(ticket.event.metadata);
}

export async function lastSuccessReason(
  prisma: ScanLookup,
  ticketId: string
): Promise<string | null> {
  const row = await prisma.ticketScan.findFirst({
    where: { ticketId, success: true },
    orderBy: { scannedAt: 'desc' },
    select: { reason: true },
  });
  return row?.reason ?? null;
}

export async function reentryCount(prisma: ScanLookup, ticketId: string): Promise<number> {
  return prisma.ticketScan.count({
    where: { ticketId, success: true, reason: SCAN_REASON_REENTRY },
  });
}

/** Dentro = USED y el último éxito no fue una salida. */
export async function ticketIsInside(
  prisma: ScanLookup,
  ticketId: string,
  status: string
): Promise<boolean> {
  if (status !== 'USED') return false;
  const last = await lastSuccessReason(prisma, ticketId);
  return last !== SCAN_REASON_EXIT;
}

export function buildTicketPayload(ticket: TicketLike) {
  return {
    code: ticket.code,
    section: ticket.section ?? null,
    row: ticket.row ?? null,
    seatNumber: ticket.seatNumber ?? null,
    eventTitle: ticket.event.title,
    holderName: ticket.buyerName?.trim() || null,
    ticketType: ticket.offer?.name || ticket.offer?.zone || null,
  };
}

export { SCAN_REASON_ENTRY, SCAN_REASON_EXIT, SCAN_REASON_REENTRY } from './access.ops';
export { summarizeGateTraffic, isEntryReason } from './access.ops';
