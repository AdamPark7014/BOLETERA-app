/**
 * Lightweight write validation for channel/campaign metadata JSON.
 * Prefer these over casting `any` at controller boundaries.
 */
import { BadRequestException } from '@nestjs/common';
import type { ChannelConfigDto } from './channel.dto';
import { CHANNEL_CONFIG_KEYS } from './channel.dto';

/** Sum allocation % for enabled channel slots only. */
export function enabledChannelAllocationTotal(config: ChannelConfigDto): number {
  let total = 0;
  for (const key of CHANNEL_CONFIG_KEYS) {
    const slot = config[key];
    if (!slot || slot.enabled === false) continue;
    total += slot.allocation ?? 0;
  }
  return total;
}

export function assertChannelConfig(config: ChannelConfigDto): ChannelConfigDto {
  const total = enabledChannelAllocationTotal(config);
  if (total !== 100) {
    throw new BadRequestException(`Channel allocation must equal 100%, got ${total}%`);
  }
  return config;
}
