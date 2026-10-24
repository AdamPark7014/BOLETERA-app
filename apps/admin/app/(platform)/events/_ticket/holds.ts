import { asRecord, readNumber, readString } from './read';

export type HoldRow = {
  id: string;
  channel: string;
  quantity: number;
  expiresAt: string | null;
  cashierId: string | null;
  sessionId: string | null;
  seatLabel: string | null;
};

export type HoldPolicy = {
  announcedSeconds: number | null;
  webSeconds: number;
  taquillaSeconds: number;
  operatorMinMinutes: number;
  operatorMaxMinutes: number;
  holds: HoldRow[];
};

export type BlockRow = {
  id: string;
  reason: string;
  category: string;
  label: string | null;
  seatLabel: string | null;
};

const CHANNEL_LABEL: Record<string, string> = {
  WEB: 'Web',
  TAQUILLA: 'Taquilla',
  API: 'API',
  ADMIN: 'Admin',
  PROMOTER: 'Promotor',
  COURTESY: 'Cortesía',
  CORPORATE: 'Corporativo',
  MOBILE: 'Móvil',
  PHONE: 'Teléfono',
  INVITATION: 'Invitación',
  AFFILIATE: 'Afiliado',
  VIP: 'VIP',
  RESALE: 'Reventa',
};

const CATEGORY_LABEL: Record<string, string> = {
  CORTESIA: 'Cortesía',
  PRODUCCION: 'Producción',
  INCIDENCIA: 'Incidencia',
  FRAUDE: 'Fraude',
  TECNICO: 'Técnico',
  OTRO: 'Otro',
};

export function channelLabel(value: string): string {
  return CHANNEL_LABEL[value] ?? value;
}

export function categoryLabel(value: string): string {
  return CATEGORY_LABEL[value] ?? value;
}

export function minutesFromSeconds(seconds: number | null): number {
  if (seconds == null || !Number.isFinite(seconds) || seconds <= 0) return 15;
  return Math.max(1, Math.round(seconds / 60));
}

export function durationLabel(seconds: number): string {
  if (!Number.isFinite(seconds) || seconds < 0) return '—';
  if (seconds % 60 === 0) return `${(seconds / 60).toLocaleString('es-MX')} min`;
  return `${seconds.toLocaleString('es-MX')} s`;
}

export function readHoldPolicy(raw: unknown): HoldPolicy | null {
  const row = asRecord(raw);
  const announcedSeconds = readNumber(row.announcedSeconds);
  const webSeconds = readNumber(row.webSeconds);
  const taquillaSeconds = readNumber(row.taquillaSeconds);
  const operatorMinMinutes = readNumber(row.operatorMinMinutes);
  const operatorMaxMinutes = readNumber(row.operatorMaxMinutes);
  if (
    webSeconds == null ||
    taquillaSeconds == null ||
    operatorMinMinutes == null ||
    operatorMaxMinutes == null ||
    !Array.isArray(row.holds)
  ) {
    return null;
  }
  const holds: HoldRow[] = [];
  for (const item of row.holds) {
    const hold = asRecord(item);
    const id = readString(hold.id);
    const channel = readString(hold.channel);
    const quantity = readNumber(hold.quantity);
    if (!id || !channel || quantity == null) continue;
    const seat = asRecord(hold.seat);
    holds.push({
      id,
      channel,
      quantity,
      expiresAt: readString(hold.expiresAt),
      cashierId: readString(hold.cashierId),
      sessionId: readString(hold.sessionId),
      seatLabel: readString(seat.label),
    });
  }
  return {
    announcedSeconds,
    webSeconds,
    taquillaSeconds,
    operatorMinMinutes,
    operatorMaxMinutes,
    holds,
  };
}

export function readBlocks(raw: unknown): BlockRow[] {
  const blocks = asRecord(raw).blocks;
  if (!Array.isArray(blocks)) return [];
  const rows: BlockRow[] = [];
  for (const item of blocks) {
    const block = asRecord(item);
    const id = readString(block.id);
    const reason = readString(block.reason);
    if (!id || !reason) continue;
    const seat = asRecord(block.seat);
    rows.push({
      id,
      reason,
      category: readString(block.category) ?? 'OTRO',
      label: readString(block.label),
      seatLabel: readString(seat.label),
    });
  }
  return rows;
}

export function readLayoutId(event: unknown): string | null {
  return readString(asRecord(asRecord(event).seatMap).layoutId);
}
