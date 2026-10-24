'use client';

import { ParameterCard } from '@boletera/ui';
import { Param } from './controls';
import styles from './frame.module.scss';
import { asRecord, formatCount, formatWhen, readNumber, readString } from './read';

const FIELDS = [
  ['announceAt', 'Anuncio', 'Visible en la cartelera.'],
  ['publishAt', 'Publicación', 'El borrador pasa a programado.'],
  ['salesStartAt', 'Inicio de venta', 'Apertura de la venta.'],
  ['salesEndAt', 'Fin de venta', 'Cierre de la venta.'],
  ['rescheduledFrom', 'Fecha anterior', 'Queda al reprogramar.'],
  ['doorsAt', 'Puertas', 'Distinta de la hora de función.'],
] as const;

export function AgendaSection({ event }: { event: unknown }) {
  const row = asRecord(event);
  const zone = readString(row.timezone) ?? 'America/Mexico_City';
  const duration = readNumber(row.durationMinutes);
  const note = readString(row.scheduleNote);
  const blank =
    FIELDS.every(([key]) => !readString(row[key])) && duration == null && !note;

  return (
    <section>
      <header className={styles.sectionHead}>
        <h1 className={styles.sectionTitle}>Agenda</h1>
        {blank ? <p className={styles.quiet}>Sin agenda guardada.</p> : null}
      </header>
      <div className={styles.stack}>
        {FIELDS.map(([key, name, effect]) => (
          <Param key={key} name={name}>
            <ParameterCard name={name} value={formatWhen(row[key], zone)} effect={effect} />
          </Param>
        ))}
        <Param name="Nota de reprogramación">
          <ParameterCard
            name="Nota de reprogramación"
            value={note ?? '—'}
            effect="La lee el comprador."
          />
        </Param>
        <Param name="Duración">
          <ParameterCard
            name="Duración"
            value={duration == null ? '—' : `${formatCount(duration)} min`}
            valueStyle="tabular"
            effect="Arma el fin y el hueco de sala."
          />
        </Param>
      </div>
    </section>
  );
}
