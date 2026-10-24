'use client';

import { useEffect, useMemo, useState } from 'react';
import { ParameterCard, TicketButton } from '@boletera/ui';
import {
  configureChannels,
  type ChannelConfiguration,
  type ChannelEntryConfiguration,
} from '@/lib/platform-api';
import { Param, Stepper, Switch } from './controls';
import styles from './frame.module.scss';
import {
  activeAllocation,
  channelNotes,
  channelValue,
  readChannels,
  type ChannelSlot,
} from './read';

type DraftSlot = ChannelSlot & { touched: boolean };

function snapshot(slots: ChannelSlot[]): DraftSlot[] {
  return slots.map((slot) => ({ ...slot, touched: false }));
}

export function ChannelsSection({
  eventId,
  metadata,
  health,
  healthNote,
  token,
  canWrite,
  onSaved,
}: {
  eventId: string;
  metadata: unknown;
  health: unknown;
  healthNote: string | null;
  token: string;
  canWrite: boolean;
  onSaved: () => void;
}) {
  const loaded = useMemo(() => readChannels(metadata, health), [metadata, health]);
  const [slots, setSlots] = useState<DraftSlot[]>(() => snapshot(loaded));
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSlots(snapshot(loaded));
  }, [loaded]);

  const sent = slots.filter((slot) => slot.defined || slot.touched);
  const total = activeAllocation(sent);
  const dirty = slots.some((slot) => {
    const initial = loaded.find((item) => item.key === slot.key);
    if (!initial) return false;
    return slot.enabled !== initial.enabled || slot.allocation !== initial.allocation;
  });
  const ready = dirty && sent.some((slot) => slot.enabled === true) && total === 100;

  function patch(key: string, partial: Partial<Pick<DraftSlot, 'enabled' | 'allocation'>>) {
    setSlots((current) =>
      current.map((slot) => (slot.key === key ? { ...slot, ...partial, touched: true } : slot)),
    );
    setNotice(null);
  }

  async function save() {
    if (!ready || saving) return;
    setSaving(true);
    setError(null);
    const before = new Map(loaded.map((slot) => [slot.key, channelValue(slot)]));
    try {
      const config: ChannelConfiguration = {};
      for (const slot of sent) {
        const entry = {
          ...slot.raw,
          enabled: slot.enabled === true,
          allocation: slot.allocation ?? 0,
        } as ChannelEntryConfiguration;
        (config as Record<string, ChannelEntryConfiguration>)[slot.key] = entry;
      }
      await configureChannels(token, eventId, config);
      const lines = sent
        .filter((slot) => before.get(slot.key) !== channelValue(slot))
        .map((slot) => `${slot.label}: ${before.get(slot.key) ?? 'Sin reparto'} → ${channelValue(slot)}`);
      setNotice(lines.join(' · ') || 'Canales guardados.');
      onSaved();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'No se guardó. Revisa la conexión.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <header className={styles.sectionHead}>
        <h1 className={styles.sectionTitle}>Canales</h1>
        {loaded.length === 0 ? <p className={styles.quiet}>Sin reparto.</p> : null}
        {healthNote ? <p className={styles.tertiary}>{healthNote}</p> : null}
        {loaded.length > 0 ? (
          <p className={total === 100 ? styles.quiet : styles.out}>Reparto de activos: {total}%</p>
        ) : null}
      </header>
      <div className={styles.stack}>
        {slots.map((slot) => {
          const notes = channelNotes(slot.raw);
          return (
            <Param key={slot.key} name={slot.label}>
              <ParameterCard
                name={slot.label}
                value={channelValue(slot)}
                valueStyle="tabular"
                effect="Parte del reparto. Los activos suman 100."
                closedNote={notes.length > 0 ? notes.join(' · ') : undefined}
              >
                {canWrite ? (
                  <div className={styles.stack}>
                    <Switch
                      label={`${slot.label} activo`}
                      on={slot.enabled === true}
                      onChange={(enabled) => patch(slot.key, { enabled })}
                    />
                    <Stepper
                      label={`Cupo ${slot.label}`}
                      value={slot.allocation}
                      min={0}
                      max={100}
                      unit="%"
                      onChange={(allocation) =>
                        patch(slot.key, {
                          allocation,
                          ...(slot.enabled == null ? { enabled: true } : {}),
                        })
                      }
                    />
                  </div>
                ) : null}
              </ParameterCard>
            </Param>
          );
        })}
      </div>
      {error ? (
        <p className={styles.danger} role="alert">
          {error}
        </p>
      ) : null}
      {canWrite && loaded.length > 0 ? (
        <div className={styles.saveBar}>
          <p className={styles.quiet} aria-live="polite">
            {dirty ? 'Sin guardar' : (notice ?? '')}
          </p>
          <TicketButton disabled={!ready || saving} onClick={() => void save()}>
            Guardar sección
          </TicketButton>
        </div>
      ) : null}
    </section>
  );
}
