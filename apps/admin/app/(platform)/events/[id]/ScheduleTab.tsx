'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import Link from 'next/link';
import {
  Badge,
  Button,
  Card,
  CardHeader,
  EmptyState,
} from '@boletera/ui';
import {
  SALE_STATE_LABELS,
  formatLocalDateTime,
  parseLocalDateTime,
  zonedTimeToUtc,
} from '@boletera/shared';
import {
  cancelEvent,
  deleteSalePhase,
  getEventSchedule,
  rescheduleEvent,
  setSaleWindows,
  upsertSalePhase,
  type EventScheduleDetail,
  type SalePhaseKind,
} from '@/lib/scheduling-api';
import { useToast } from '@/components/Toast/ToastProvider';
import { statusTone } from './format';
import styles from './event-hub.module.scss';

const PHASE_KINDS: { value: SalePhaseKind; label: string }[] = [
  { value: 'PRESALE', label: 'Preventa con código' },
  { value: 'MEMBERS', label: 'Miembros' },
  { value: 'PUBLIC', label: 'Venta pública' },
  { value: 'LAST_MINUTE', label: 'Última hora' },
  { value: 'DOOR', label: 'Puerta' },
];

function toLocalInput(iso: string | null | undefined, timezone: string) {
  if (!iso) return '';
  return formatLocalDateTime(new Date(iso), timezone);
}

function fromLocalInput(value: string, timezone: string) {
  if (!value) return null;
  return zonedTimeToUtc(parseLocalDateTime(value), timezone).toISOString();
}

function formatWhen(iso: string | null | undefined, timezone: string) {
  if (!iso) return '—';
  return new Date(iso).toLocaleString('es-MX', {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: timezone,
  });
}

type WindowFields = {
  doorsAt: string;
  durationMinutes: string;
  announceAt: string;
  publishAt: string;
  salesStartAt: string;
  salesEndAt: string;
};

type Props = {
  eventId: string;
  onChanged?: () => void;
  canWrite?: boolean;
};

export function ScheduleTab({ eventId, onChanged, canWrite = true }: Props) {
  const toast = useToast();
  const [data, setData] = useState<EventScheduleDetail | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [savingWindows, setSavingWindows] = useState(false);
  const [windows, setWindows] = useState<WindowFields | null>(null);
  const [reschedule, setReschedule] = useState({ startLocal: '', reason: '', force: false });
  const [phaseDraft, setPhaseDraft] = useState<{
    id?: string;
    name: string;
    kind: SalePhaseKind;
    code: string;
    startLocal: string;
    endLocal: string;
    discountPercent: string;
    maxPerOrder: string;
  } | null>(null);
  const [busy, setBusy] = useState(false);

  const timezone = data?.event.timezone ?? 'America/Mexico_City';

  const load = useCallback(() => {
    setLoadError(null);
    getEventSchedule(eventId)
      .then((detail) => {
        setData(detail);
        setWindows({
          doorsAt: toLocalInput(detail.event.doorsAt, detail.event.timezone),
          durationMinutes: detail.event.durationMinutes
            ? String(detail.event.durationMinutes)
            : '',
          announceAt: toLocalInput(detail.event.announceAt, detail.event.timezone),
          publishAt: toLocalInput(detail.event.publishAt, detail.event.timezone),
          salesStartAt: toLocalInput(detail.event.salesStartAt, detail.event.timezone),
          salesEndAt: toLocalInput(detail.event.salesEndAt, detail.event.timezone),
        });
        setReschedule((prev) => ({
          ...prev,
          startLocal: toLocalInput(detail.event.startsAt, detail.event.timezone),
        }));
      })
      .catch((error: unknown) => {
        const message =
          error instanceof Error ? error.message : 'No se pudo cargar la programación';
        setLoadError(message);
        toast.error(message);
      });
  }, [eventId, toast]);

  useEffect(() => {
    load();
  }, [load]);

  const nextChange = useMemo(() => {
    if (!data?.sale.nextChangeAt) return null;
    return formatWhen(data.sale.nextChangeAt, timezone);
  }, [data, timezone]);

  async function saveWindows() {
    if (!windows || !canWrite) return;
    setSavingWindows(true);
    try {
      const updated = await setSaleWindows(eventId, {
        doorsAt: fromLocalInput(windows.doorsAt, timezone),
        announceAt: fromLocalInput(windows.announceAt, timezone),
        publishAt: fromLocalInput(windows.publishAt, timezone),
        salesStartAt: fromLocalInput(windows.salesStartAt, timezone),
        salesEndAt: fromLocalInput(windows.salesEndAt, timezone),
        durationMinutes: windows.durationMinutes ? Number(windows.durationMinutes) : null,
      });
      setData(updated);
      toast.success('Ventanas de venta actualizadas');
      onChanged?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudieron guardar las ventanas');
    } finally {
      setSavingWindows(false);
    }
  }

  async function submitReschedule() {
    if (!canWrite) return;
    if (!reschedule.startLocal || !reschedule.reason.trim()) {
      toast.error('Indica la nueva fecha y el motivo');
      return;
    }
    setBusy(true);
    try {
      await rescheduleEvent(eventId, {
        startsAt: fromLocalInput(reschedule.startLocal, timezone)!,
        reason: reschedule.reason.trim(),
        force: reschedule.force,
      });
      toast.success('Evento reprogramado');
      setReschedule((prev) => ({ ...prev, reason: '', force: false }));
      load();
      onChanged?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo reprogramar');
    } finally {
      setBusy(false);
    }
  }

  async function submitCancel() {
    if (!canWrite) return;
    const reason = window.prompt('Motivo de la cancelación (se guarda en la auditoría):');
    if (!reason?.trim()) return;
    setBusy(true);
    try {
      await cancelEvent(eventId, reason.trim());
      toast.success('Evento cancelado y ventas cerradas');
      load();
      onChanged?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo cancelar');
    } finally {
      setBusy(false);
    }
  }

  async function savePhase() {
    if (!phaseDraft || !canWrite) return;
    if (!phaseDraft.name.trim() || !phaseDraft.startLocal || !phaseDraft.endLocal) {
      toast.error('Nombre, inicio y fin son obligatorios');
      return;
    }
    setBusy(true);
    try {
      await upsertSalePhase(eventId, {
        id: phaseDraft.id,
        name: phaseDraft.name.trim(),
        kind: phaseDraft.kind,
        code: phaseDraft.code.trim() ? phaseDraft.code.trim().toUpperCase() : null,
        startsAt: fromLocalInput(phaseDraft.startLocal, timezone)!,
        endsAt: fromLocalInput(phaseDraft.endLocal, timezone)!,
        discountPercent: phaseDraft.discountPercent
          ? Number(phaseDraft.discountPercent)
          : null,
        maxPerOrder: phaseDraft.maxPerOrder ? Number(phaseDraft.maxPerOrder) : null,
      });
      toast.success('Fase guardada');
      setPhaseDraft(null);
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo guardar la fase');
    } finally {
      setBusy(false);
    }
  }

  async function removePhase(phaseId: string) {
    if (!canWrite) return;
    if (!confirm('¿Eliminar esta fase de venta?')) return;
    try {
      await deleteSalePhase(eventId, phaseId);
      toast.success('Fase eliminada');
      load();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo eliminar');
    }
  }

  if (loadError && !data) {
    return (
      <EmptyState
        title="No se pudo cargar la programación"
        description={loadError}
        illustration="error"
        tone="danger"
        action={
          <Button type="button" variant="outline" size="sm" onClick={load}>
            Reintentar
          </Button>
        }
      />
    );
  }

  if (!data || !windows) {
    return (
      <EmptyState
        title="Cargando programación…"
        description="Consultando ventanas, fases y estado de venta."
        illustration="inbox"
        size="sm"
      />
    );
  }

  return (
    <div className={styles.stack}>
      <Card variant="outline" padding="md">
        <CardHeader
          title="Estado de venta"
          description="Calendario y ventanas del evento"
          actions={
            <Badge tone={statusTone(data.sale.state)} variant="soft" size="sm" dot>
              {SALE_STATE_LABELS[data.sale.state] ?? data.sale.state}
            </Badge>
          }
        />
        <div className={styles.metaRow}>
          {data.sale.canPurchase ? (
            <Badge tone="success" variant="outline" size="sm">
              Comprable ahora
            </Badge>
          ) : (
            <Badge tone="neutral" variant="outline" size="sm">
              No comprable
            </Badge>
          )}
          {nextChange ? <span>Próximo cambio: {nextChange}</span> : null}
        </div>

        <dl className={styles.statGrid}>
          <div className={styles.statCard}>
            <span>Función</span>
            <strong style={{ fontSize: '0.875rem' }}>
              {formatWhen(data.event.startsAt, timezone)}
            </strong>
          </div>
          <div className={styles.statCard}>
            <span>Puertas</span>
            <strong style={{ fontSize: '0.875rem' }}>
              {formatWhen(data.event.doorsAt, timezone)}
            </strong>
          </div>
          <div className={styles.statCard}>
            <span>Anuncio</span>
            <strong style={{ fontSize: '0.875rem' }}>
              {formatWhen(data.event.announceAt, timezone)}
            </strong>
          </div>
          <div className={styles.statCard}>
            <span>Auto-publicación</span>
            <strong style={{ fontSize: '0.875rem' }}>
              {formatWhen(data.event.publishAt, timezone)}
            </strong>
          </div>
          <div className={styles.statCard}>
            <span>Venta abre</span>
            <strong style={{ fontSize: '0.875rem' }}>
              {formatWhen(data.event.salesStartAt, timezone)}
            </strong>
          </div>
          <div className={styles.statCard}>
            <span>Venta cierra</span>
            <strong style={{ fontSize: '0.875rem' }}>
              {formatWhen(data.event.salesEndAt, timezone)}
            </strong>
          </div>
        </dl>

        {data.event.seriesId ? (
          <p className={styles.hint}>
            Parte de una serie (función #{data.event.seriesOrder ?? '—'}) ·{' '}
            <Link href={`/events/series/${data.event.seriesId}`}>ver serie completa</Link>
          </p>
        ) : null}

        {data.event.rescheduledFrom ? (
          <p className={styles.hintDanger}>
            Reprogramado desde {formatWhen(data.event.rescheduledFrom, timezone)}
            {data.event.scheduleNote ? ` · ${data.event.scheduleNote}` : ''}
          </p>
        ) : null}

        {data.conflicts.length > 0 ? (
          <ul className={styles.hintDanger} style={{ paddingLeft: '1.1rem' }}>
            {data.conflicts.map((conflict, index) => (
              <li key={`${conflict.message}-${index}`}>{conflict.message}</li>
            ))}
          </ul>
        ) : null}
      </Card>

      <Card variant="outline" padding="md">
        <CardHeader title="Ventanas de venta" description={`Horas locales (${timezone})`} />
        {!canWrite ? (
          <EmptyState
            title="Solo lectura"
            description="Necesitas event:write para editar ventanas."
            illustration="inbox"
            size="sm"
            tone="neutral"
          />
        ) : (
          <>
            <div className={styles.formGrid}>
              <label>
                Puertas abren
                <input
                  type="datetime-local"
                  value={windows.doorsAt}
                  onChange={(e) => setWindows({ ...windows, doorsAt: e.target.value })}
                />
              </label>
              <label>
                Duración (min)
                <input
                  type="number"
                  min={30}
                  step={15}
                  value={windows.durationMinutes}
                  onChange={(e) =>
                    setWindows({ ...windows, durationMinutes: e.target.value })
                  }
                />
              </label>
              <label>
                Anuncio público
                <input
                  type="datetime-local"
                  value={windows.announceAt}
                  onChange={(e) => setWindows({ ...windows, announceAt: e.target.value })}
                />
              </label>
              <label>
                Auto-publicación
                <input
                  type="datetime-local"
                  value={windows.publishAt}
                  onChange={(e) => setWindows({ ...windows, publishAt: e.target.value })}
                />
              </label>
              <label>
                Venta abre
                <input
                  type="datetime-local"
                  value={windows.salesStartAt}
                  onChange={(e) => setWindows({ ...windows, salesStartAt: e.target.value })}
                />
              </label>
              <label>
                Venta cierra
                <input
                  type="datetime-local"
                  value={windows.salesEndAt}
                  onChange={(e) => setWindows({ ...windows, salesEndAt: e.target.value })}
                />
              </label>
            </div>
            <p className={styles.hint}>
              El worker aplica los cambios de estado automáticamente cada 30 segundos.
            </p>
            <div className={styles.actionsRow}>
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={savingWindows}
                onClick={() => void saveWindows()}
              >
                {savingWindows ? 'Guardando…' : 'Guardar ventanas'}
              </Button>
            </div>
          </>
        )}
      </Card>

      <Card variant="outline" padding="md">
        <CardHeader
          title={`Fases de venta (${data.phases.length})`}
          actions={
            canWrite ? (
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() =>
                  setPhaseDraft({
                    name: 'Preventa',
                    kind: 'PRESALE',
                    code: '',
                    startLocal: toLocalInput(
                      data.event.salesStartAt ?? data.event.startsAt,
                      timezone,
                    ),
                    endLocal: toLocalInput(data.event.startsAt, timezone),
                    discountPercent: '',
                    maxPerOrder: '4',
                  })
                }
              >
                + Nueva fase
              </Button>
            ) : undefined
          }
        />

        {data.phases.length === 0 ? (
          <EmptyState
            title="Sin fases"
            description="No hay fases de venta configuradas para este evento."
            illustration="inbox"
            size="sm"
          />
        ) : (
          <div className={styles.tableWrap} role="region" aria-label="Fases de venta">
            <table className={styles.table}>
              <thead>
                <tr>
                  <th scope="col">Fase</th>
                  <th scope="col">Tipo</th>
                  <th scope="col">Código</th>
                  <th scope="col">Ventana</th>
                  <th scope="col">Estado</th>
                  <th scope="col">
                    <span className={styles.srOnly}>Acciones</span>
                  </th>
                </tr>
              </thead>
              <tbody>
                {data.phases.map((phase) => (
                  <tr key={phase.id}>
                    <td>{phase.name}</td>
                    <td>
                      {PHASE_KINDS.find((kind) => kind.value === phase.kind)?.label ??
                        phase.kind}
                    </td>
                    <td>{phase.code ?? '—'}</td>
                    <td>
                      {formatWhen(phase.startsAt, timezone)} →{' '}
                      {formatWhen(phase.endsAt, timezone)}
                    </td>
                    <td>
                      <Badge tone={statusTone(phase.status)} variant="soft" size="sm">
                        {phase.status}
                      </Badge>
                    </td>
                    <td>
                      {canWrite ? (
                        <div className={styles.actionsRow}>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() =>
                              setPhaseDraft({
                                id: phase.id,
                                name: phase.name,
                                kind: phase.kind,
                                code: phase.code ?? '',
                                startLocal: toLocalInput(phase.startsAt, timezone),
                                endLocal: toLocalInput(phase.endsAt, timezone),
                                discountPercent:
                                  phase.discountPercent != null
                                    ? String(phase.discountPercent)
                                    : '',
                                maxPerOrder:
                                  phase.maxPerOrder != null
                                    ? String(phase.maxPerOrder)
                                    : '',
                              })
                            }
                          >
                            Editar
                          </Button>
                          <Button
                            type="button"
                            variant="ghost"
                            size="sm"
                            onClick={() => void removePhase(phase.id)}
                          >
                            Eliminar
                          </Button>
                        </div>
                      ) : (
                        '—'
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {phaseDraft && canWrite ? (
          <div className={styles.phaseDraft}>
            <div className={styles.formGrid}>
              <label>
                Nombre
                <input
                  value={phaseDraft.name}
                  onChange={(e) => setPhaseDraft({ ...phaseDraft, name: e.target.value })}
                />
              </label>
              <label>
                Tipo
                <select
                  value={phaseDraft.kind}
                  onChange={(e) =>
                    setPhaseDraft({
                      ...phaseDraft,
                      kind: e.target.value as SalePhaseKind,
                    })
                  }
                >
                  {PHASE_KINDS.map((kind) => (
                    <option key={kind.value} value={kind.value}>
                      {kind.label}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Código (vacío = abierta)
                <input
                  value={phaseDraft.code}
                  onChange={(e) => setPhaseDraft({ ...phaseDraft, code: e.target.value })}
                />
              </label>
              <label>
                Abre
                <input
                  type="datetime-local"
                  value={phaseDraft.startLocal}
                  onChange={(e) =>
                    setPhaseDraft({ ...phaseDraft, startLocal: e.target.value })
                  }
                />
              </label>
              <label>
                Cierra
                <input
                  type="datetime-local"
                  value={phaseDraft.endLocal}
                  onChange={(e) =>
                    setPhaseDraft({ ...phaseDraft, endLocal: e.target.value })
                  }
                />
              </label>
              <label>
                Descuento %
                <input
                  type="number"
                  min={0}
                  max={90}
                  value={phaseDraft.discountPercent}
                  onChange={(e) =>
                    setPhaseDraft({ ...phaseDraft, discountPercent: e.target.value })
                  }
                />
              </label>
              <label>
                Máx. por orden
                <input
                  type="number"
                  min={1}
                  value={phaseDraft.maxPerOrder}
                  onChange={(e) =>
                    setPhaseDraft({ ...phaseDraft, maxPerOrder: e.target.value })
                  }
                />
              </label>
            </div>
            <div className={styles.actionsRow} style={{ marginTop: '0.75rem' }}>
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={busy}
                onClick={() => void savePhase()}
              >
                Guardar fase
              </Button>
              <Button
                type="button"
                variant="ghost"
                size="sm"
                onClick={() => setPhaseDraft(null)}
              >
                Cancelar
              </Button>
            </div>
          </div>
        ) : null}
      </Card>

      <Card variant="outline" padding="md">
        <CardHeader
          title="Reprogramar o cancelar"
          description="Acciones destructivas con motivo auditado"
        />
        {!canWrite ? (
          <EmptyState
            title="Solo lectura"
            description="Necesitas event:write para reprogramar o cancelar."
            illustration="inbox"
            size="sm"
            tone="neutral"
          />
        ) : (
          <>
            <div className={styles.formGrid}>
              <label>
                Nueva fecha y hora
                <input
                  type="datetime-local"
                  value={reschedule.startLocal}
                  onChange={(e) =>
                    setReschedule({ ...reschedule, startLocal: e.target.value })
                  }
                />
              </label>
              <label>
                Motivo (obligatorio)
                <input
                  value={reschedule.reason}
                  placeholder="Ej. cambio de fecha del artista"
                  onChange={(e) =>
                    setReschedule({ ...reschedule, reason: e.target.value })
                  }
                />
              </label>
              <label className={styles.inlineCheck}>
                <input
                  type="checkbox"
                  checked={reschedule.force}
                  onChange={(e) =>
                    setReschedule({ ...reschedule, force: e.target.checked })
                  }
                />
                Ignorar conflictos de agenda del recinto
              </label>
            </div>
            <div className={styles.actionsRow}>
              <Button
                type="button"
                variant="primary"
                size="sm"
                disabled={busy}
                onClick={() => void submitReschedule()}
              >
                Reprogramar
              </Button>
              <Button
                type="button"
                variant="danger"
                size="sm"
                disabled={busy}
                onClick={() => void submitCancel()}
              >
                Cancelar evento
              </Button>
            </div>
          </>
        )}
      </Card>
    </div>
  );
}
