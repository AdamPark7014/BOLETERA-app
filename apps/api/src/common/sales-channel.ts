import { SalesChannel } from '@prisma/client';

/** Metadata bucket keys under `event.metadata.channels`. */
export const SALES_CHANNEL_METADATA_KEYS: Record<SalesChannel, string> = {
  [SalesChannel.WEB]: 'web',
  [SalesChannel.TAQUILLA]: 'taquilla',
  [SalesChannel.API]: 'api',
  [SalesChannel.ADMIN]: 'admin',
  [SalesChannel.PROMOTER]: 'promoter',
  [SalesChannel.COURTESY]: 'courtesy',
  [SalesChannel.CORPORATE]: 'corporate',
  [SalesChannel.MOBILE]: 'mobile',
  [SalesChannel.PHONE]: 'phone',
  [SalesChannel.INVITATION]: 'invitation',
  [SalesChannel.AFFILIATE]: 'affiliate',
  [SalesChannel.VIP]: 'vip',
  [SalesChannel.RESALE]: 'resale',
};

export const ALL_SALES_CHANNELS = Object.values(SalesChannel) as SalesChannel[];

/** Channels that share web hold TTL and per-session limits. */
export const WEB_LIKE_CHANNELS: ReadonlySet<SalesChannel> = new Set([
  SalesChannel.WEB,
  SalesChannel.MOBILE,
  SalesChannel.API,
  SalesChannel.AFFILIATE,
  SalesChannel.RESALE,
]);

export function isWebLikeChannel(channel: SalesChannel): boolean {
  return WEB_LIKE_CHANNELS.has(channel);
}

/** Inventory quota bucket for a Prisma channel (ADMIN draws from web pool). */
export function channelInventoryKey(channel: SalesChannel): string {
  if (channel === SalesChannel.ADMIN) return 'web';
  return SALES_CHANNEL_METADATA_KEYS[channel];
}

/** Parse `x-channel` / query param into a Prisma enum value. */
export function parseSalesChannel(raw?: string | null): SalesChannel | undefined {
  if (!raw?.trim()) return undefined;
  const normalized = raw.trim().toUpperCase();
  return (Object.values(SalesChannel) as string[]).includes(normalized)
    ? (normalized as SalesChannel)
    : undefined;
}

/** Sum allocation percentages from channel config metadata. */
export function sumChannelAllocations(
  channels: Record<string, { allocation?: number } | undefined>,
): number {
  return Object.values(channels).reduce((sum, slot) => sum + (slot?.allocation ?? 0), 0);
}
