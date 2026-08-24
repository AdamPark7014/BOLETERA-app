export type ChannelSlotConfig = {
  enabled: boolean;
  allocation: number;
};

export type ChannelConfigDto = {
  web?: ChannelSlotConfig & { discount?: number; activeHours?: string };
  taquilla?: ChannelSlotConfig & { locations: string[] };
  api?: ChannelSlotConfig & { partners: string[] };
  phone?: ChannelSlotConfig & { hours?: string };
  admin?: ChannelSlotConfig;
  promoter?: ChannelSlotConfig & { commissionRate?: number };
  courtesy?: ChannelSlotConfig;
  corporate?: ChannelSlotConfig & { contactEmail?: string };
  mobile?: ChannelSlotConfig;
  invitation?: ChannelSlotConfig;
  affiliate?: ChannelSlotConfig & { partners?: string[] };
  vip?: ChannelSlotConfig;
  resale?: ChannelSlotConfig & { feePercent?: number };
};

/** Keys persisted under `event.metadata.channels`. */
export const CHANNEL_CONFIG_KEYS = [
  'web',
  'taquilla',
  'api',
  'phone',
  'admin',
  'promoter',
  'courtesy',
  'corporate',
  'mobile',
  'invitation',
  'affiliate',
  'vip',
  'resale',
] as const;

export type ChannelConfigKey = (typeof CHANNEL_CONFIG_KEYS)[number];

export type ApiPartnerDto = {
  name: string;
  apiKey: string;
  allocation?: number;
  commissionRate?: number;
  rateLimit?: number;
};

export type TaquillaLocationDto = {
  name: string;
  address: string;
  city: string;
  terminals: number;
  staff: string[];
  activeHours?: string;
};
