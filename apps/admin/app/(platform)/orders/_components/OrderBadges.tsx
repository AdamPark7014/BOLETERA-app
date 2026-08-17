'use client';

import { Badge } from '@boletera/ui';
import { channelLabel, statusMeta } from '../_lib/format';

export function OrderStatusBadge({ status }: { status: string }) {
  const meta = statusMeta(status);
  return (
    <Badge tone={meta.tone} variant="soft" size="sm" dot>
      {meta.label}
    </Badge>
  );
}

export function ChannelBadge({ channel }: { channel: string }) {
  return (
    <Badge tone="neutral" variant="outline" size="sm">
      {channelLabel(channel)}
    </Badge>
  );
}
