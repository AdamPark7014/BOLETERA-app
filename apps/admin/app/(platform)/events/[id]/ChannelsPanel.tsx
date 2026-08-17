'use client';

import { useEffect, useState } from 'react';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
} from '@boletera/ui';
import type { ChannelHealthMap } from '@/lib/platform-api';
import {
  channelLabel,
  formatCount,
  formatMxn,
  healthTone,
} from './format';
import styles from './event-hub.module.scss';

export type ChannelPct = { web: number; taquilla: number; api: number };

type Props = {
  initialChannels: ChannelPct;
  health: ChannelHealthMap | undefined;
  healthLoading: boolean;
  healthError: string | null;
  canWrite: boolean;
  saving: boolean;
  onSave: (channels: ChannelPct) => Promise<void>;
};

export function ChannelsPanel({
  initialChannels,
  health,
  healthLoading,
  healthError,
  canWrite,
  saving,
  onSave,
}: Props) {
  const [channels, setChannels] = useState<ChannelPct>(initialChannels);

  useEffect(() => {
    setChannels(initialChannels);
  }, [initialChannels]);

  const total = channels.web + channels.taquilla + channels.api;
  const healthEntries = health ? Object.entries(health) : [];

  return (
    <div
      className={styles.tabPanel}
      role="tabpanel"
      id="hub-panel-channels"
      aria-labelledby="hub-tab-channels"
    >
      <Card variant="outline" padding="md">
        <CardHeader
          title="Asignación multi-canal"
          description="La suma de asignaciones debe ser 100 %"
        />
        {!canWrite ? (
          <EmptyState
            title="Sin permiso de edición"
            description="Necesitas event:write para configurar canales."
            illustration="error"
            tone="neutral"
            size="sm"
          />
        ) : (
          <div className={styles.cardBody}>
            {(
              [
                ['web', 'Web'],
                ['taquilla', 'Taquilla'],
                ['api', 'API'],
              ] as const
            ).map(([key, label]) => (
              <label key={key} className={styles.rangeField}>
                <span>{label}</span>
                <input
                  type="range"
                  min={0}
                  max={100}
                  value={channels[key]}
                  onChange={(event) =>
                    setChannels((prev) => ({
                      ...prev,
                      [key]: Number(event.target.value),
                    }))
                  }
                  aria-valuetext={`${channels[key]} por ciento`}
                />
                <strong>{channels[key]}%</strong>
              </label>
            ))}
            <p className={total === 100 ? styles.hint : styles.hintDanger}>
              Total: {total}%{total !== 100 ? ' — ajusta hasta 100 %' : ''}
            </p>
            <div className={styles.actionsRow}>
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={saving || total !== 100}
                onClick={() => void onSave(channels)}
              >
                {saving ? 'Guardando…' : 'Guardar canales'}
              </Button>
            </div>
          </div>
        )}
      </Card>

      <Card variant="outline" padding="md">
        <CardHeader
          title="Salud en tiempo real"
          description="Estado reportado por el servicio de canales"
        />
        {healthError ? (
          <EmptyState
            title="No se pudo cargar la salud de canales"
            description={healthError}
            illustration="error"
            tone="danger"
            size="sm"
          />
        ) : healthLoading && healthEntries.length === 0 ? (
          <EmptyState
            title="Cargando salud…"
            description="Consultando el endpoint de canales."
            illustration="inbox"
            size="sm"
          />
        ) : healthEntries.length === 0 ? (
          <EmptyState
            title="Sin datos de salud"
            description="El endpoint no devolvió estado por canal para este evento."
            illustration="inbox"
            size="sm"
          />
        ) : (
          <div className={styles.statGrid}>
            {healthEntries.map(([key, value]) => (
              <article key={key} className={styles.statCard}>
                <span>{channelLabel(key)}</span>
                <strong>
                  <Badge tone={healthTone(value.status)} variant="soft" size="sm" dot>
                    {value.status ?? 'sin estado'}
                  </Badge>
                </strong>
                <small>
                  {formatCount(value.orders ?? 0)} órdenes · {formatMxn(value.revenue ?? 0)}
                </small>
              </article>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
