'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { Field, ParameterCard, TicketButton } from '@boletera/ui';
import { ApiError, adminApi } from '@/lib/api';
import { ApiErrorView } from '../_shared/api-state';
import { Param, Stepper } from './controls';
import styles from './frame.module.scss';
import { formatCount, formatWhen } from './read';
import {
  categoryLabel,
  channelLabel,
  durationLabel,
  minutesFromSeconds,
  readBlocks,
  readHoldPolicy,
  readLayoutId,
  type BlockRow,
  type HoldPolicy,
  type HoldRow,
} from './holds';

export function ApartadosSection({
  eventId,
  event,
  token,
  canOperate,
}: {
  eventId: string;
  event: unknown;
  token: string;
  canOperate: boolean;
}) {
  const [policy, setPolicy] = useState<HoldPolicy | null>(null);
  const [blocks, setBlocks] = useState<BlockRow[]>([]);
  const [blocksNote, setBlocksNote] = useState<string | null>(null);
  const [error, setError] = useState<unknown>(null);
  const [loading, setLoading] = useState(true);
  const [nonce, setNonce] = useState(0);
  const layoutId = readLayoutId(event);

  useEffect(() => {
    let alive = true;
    setError(null);
    async function load() {
      const rawHolds = await adminApi<unknown>(`/layouts/events/${eventId}/holds`, token);
      const parsed = readHoldPolicy(rawHolds);
      if (!parsed) throw new Error('No se leyeron los apartados.');
      const rawBlocks = await adminApi<unknown>(`/layouts/events/${eventId}/blocks`, token, {
        silent: true,
      }).catch(() => null);
      if (!alive) return;
      setPolicy(parsed);
      if (rawBlocks) {
        setBlocks(readBlocks(rawBlocks));
        setBlocksNote(null);
      } else {
        setBlocks([]);
        setBlocksNote('No se leyeron los bloqueos. Los apartados sí están.');
      }
    }
    void load()
      .catch((cause: unknown) => {
        if (!alive) return;
        setError(cause);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [eventId, token, nonce]);

  if (error) {
    return (
      <ApiErrorView
        error={error}
        context="abrir apartados"
        onRetry={() => setNonce((current) => current + 1)}
      />
    );
  }
  if (loading || !policy) return <p className={styles.quiet}>Cargando apartados.</p>;

  const empty = policy.holds.length === 0 && blocks.length === 0;

  return (
    <DurationEditor
      eventId={eventId}
      token={token}
      policy={policy}
      canOperate={canOperate}
      onSaved={(announcedSeconds) => {
        setPolicy((current) => (current ? { ...current, announcedSeconds } : current));
      }}
    >
      {blocksNote ? <p className={styles.tertiary}>{blocksNote}</p> : null}
      {empty ? <p className={styles.quiet}>No hay apartados.</p> : null}
      {policy.holds.map((hold) => (
        <HoldCards key={hold.id} hold={hold} />
      ))}
      {blocks.map((block) => (
        <BlockCards
          key={block.id}
          block={block}
          eventId={eventId}
          layoutId={layoutId}
          token={token}
          canOperate={canOperate}
          onReleased={() => setNonce((current) => current + 1)}
        />
      ))}
    </DurationEditor>
  );
}

function DurationEditor({
  eventId,
  token,
  policy,
  canOperate,
  onSaved,
  children,
}: {
  eventId: string;
  token: string;
  policy: HoldPolicy;
  canOperate: boolean;
  onSaved: (announcedSeconds: number) => void;
  children: ReactNode;
}) {
  const stored = minutesFromSeconds(policy.announcedSeconds);
  const [minutes, setMinutes] = useState(stored);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setMinutes(minutesFromSeconds(policy.announcedSeconds));
  }, [policy.announcedSeconds]);

  const dirty = minutes !== stored;
  const effective = `Web ${durationLabel(policy.webSeconds)} · Taquilla ${durationLabel(policy.taquillaSeconds)}`;
  const operator = `${policy.operatorMinMinutes.toLocaleString('es-MX')}–${policy.operatorMaxMinutes.toLocaleString('es-MX')} min`;

  async function save() {
    if (!dirty || saving || !canOperate) return;
    setSaving(true);
    setError(null);
    try {
      const updated = await adminApi<{ holdExpiration: number }>(
        `/events/manage/${eventId}/hold-expiration`,
        token,
        { method: 'PATCH', body: JSON.stringify({ minutes }) }
      );
      setNotice(
        `Duración anunciada: ${stored.toLocaleString('es-MX')} min → ${minutes.toLocaleString('es-MX')} min`
      );
      onSaved(updated.holdExpiration);
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.userMessage : 'No se guardó. Revisa la conexión.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <header className={styles.sectionHead}>
        <h1 className={styles.sectionTitle}>Apartados</h1>
      </header>
      <div className={styles.stack}>
        <Param name="Duración del apartado">
          <ParameterCard
            name="Duración del apartado"
            value={effective}
            valueStyle="tabular"
            effect="Cambia lo que anuncia la ficha. La caducidad real sigue en el plazo del canal."
            closedNote={`Anunciado · ${minutes.toLocaleString('es-MX')} min · Operador · ${operator}`}
          >
            {canOperate ? (
              <Stepper
                label="Duración del apartado"
                value={minutes}
                min={policy.operatorMinMinutes}
                max={policy.operatorMaxMinutes}
                unit=" min"
                onChange={(next) => {
                  setMinutes(next);
                  setNotice(null);
                }}
              />
            ) : null}
          </ParameterCard>
        </Param>
        <Param name="Duración del operador">
          <ParameterCard
            name="Duración del operador"
            value={operator}
            valueStyle="tabular"
            effect="Solo aplica cuando alguien la manda al apartar en el plano. Si no, queda el plazo del canal."
          />
        </Param>
        {children}
        {error ? (
          <p className={styles.danger} role="alert">
            {error}
          </p>
        ) : null}
      </div>
      {canOperate ? (
        <div className={styles.saveBar}>
          <p className={styles.quiet} aria-live="polite">
            {dirty ? 'Sin guardar' : (notice ?? '')}
          </p>
          <TicketButton disabled={!dirty || saving} onClick={() => void save()}>
            Guardar sección
          </TicketButton>
        </div>
      ) : null}
    </section>
  );
}

function HoldCards({ hold }: { hold: HoldRow }) {
  return (
    <div className={styles.stack}>
      <p className={styles.rowTitle}>{hold.seatLabel ?? 'Admisión general'}</p>
      <Param name="Canal del apartado">
        <ParameterCard
          name="Canal del apartado"
          value={channelLabel(hold.channel)}
          effect="Canal con el que se apartó."
        />
      </Param>
      <Param name="Cantidad apartada">
        <ParameterCard
          name="Cantidad apartada"
          value={formatCount(hold.quantity)}
          valueStyle="tabular"
          effect="Boletos que retiene este apartado."
        />
      </Param>
      <Param name="Vence">
        <ParameterCard
          name="Vence"
          value={formatWhen(hold.expiresAt)}
          valueStyle="tabular"
          effect="Momento en que el apartado deja de retener."
        />
      </Param>
      <Param name="Cajero">
        <ParameterCard
          name="Cajero"
          value={hold.cashierId ?? '—'}
          valueStyle="mono"
          effect="Quién apartó, si fue en taquilla o en el plano."
        />
      </Param>
      <Param name="Sesión">
        <ParameterCard
          name="Sesión"
          value={hold.sessionId ?? '—'}
          valueStyle="mono"
          effect="Sesión que sostiene el apartado."
        />
      </Param>
    </div>
  );
}

function BlockCards({
  block,
  eventId,
  layoutId,
  token,
  canOperate,
  onReleased,
}: {
  block: BlockRow;
  eventId: string;
  layoutId: string | null;
  token: string;
  canOperate: boolean;
  onReleased: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ready = reason.trim().length >= 8;
  // La ruta exige un id de plano; soltar no lo consulta.
  const layout = layoutId ?? 'plano';

  async function release() {
    if (!ready || busy || !canOperate) return;
    setBusy(true);
    setError(null);
    try {
      await adminApi(`/layouts/${layout}/seats/unblock`, token, {
        method: 'POST',
        body: JSON.stringify({ eventId, blockIds: [block.id], reason: reason.trim() }),
      });
      onReleased();
    } catch (cause) {
      setError(cause instanceof ApiError ? cause.userMessage : 'No se soltó. Revisa la conexión.');
      setBusy(false);
    }
  }

  return (
    <div className={styles.stack}>
      <p className={styles.rowTitle}>{block.seatLabel ?? 'Admisión general'}</p>
      <Param name="Motivo del bloqueo">
        <ParameterCard
          name="Motivo del bloqueo"
          value={block.reason}
          effect="Por qué esta butaca no está a la venta. El bloqueo se hace en el plano."
        />
      </Param>
      <Param name="Categoría del bloqueo">
        <ParameterCard
          name="Categoría del bloqueo"
          value={categoryLabel(block.category)}
          effect="Cortesía, producción, incidencia, fraude, técnico u otro."
        />
      </Param>
      <Param name="Etiqueta del bloqueo">
        <ParameterCard
          name="Etiqueta del bloqueo"
          value={block.label ?? '—'}
          effect="Nombre operativo, por ejemplo prensa o producción."
        />
      </Param>
      {canOperate ? (
        open ? (
          <>
            <Field
              label="Motivo de liberación"
              value={reason}
              hint="Mínimo 8 caracteres."
              onChange={(input) => setReason(input.target.value)}
            />
            {error ? (
              <p className={styles.danger} role="alert">
                {error}
              </p>
            ) : null}
            <TicketButton variant="danger" disabled={!ready || busy} onClick={() => void release()}>
              Soltar
            </TicketButton>
          </>
        ) : (
          <TicketButton variant="secondary" onClick={() => setOpen(true)}>
            Soltar
          </TicketButton>
        )
      ) : null}
    </div>
  );
}
