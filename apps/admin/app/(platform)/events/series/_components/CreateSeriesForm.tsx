'use client';

import { useMemo, useState } from 'react';
import { Field, TicketButton, formatTicketAmount } from '@boletera/ui';
import {
  ScheduleBuilder,
  type ScheduleBuilderValue,
} from '@/components/ScheduleBuilder/ScheduleBuilder';
import { useCreateEventSeries } from '@/lib/queries/events';
import { useVenues } from '@/lib/queries/venues';
import type { SchedulePreview, SeriesTemplate } from '@/lib/scheduling-api';
import frame from '../../_ticket/frame.module.scss';
import { SheetSelect } from '../../_ticket/controls';
import { formatCount } from '../../_ticket/read';
import styles from '../series.module.scss';

type Props = {
  disabled?: boolean;
  onCreated?: (message: string) => void;
};

function defaultStartLocal(): string {
  const date = new Date();
  date.setDate(date.getDate() + 14);
  date.setHours(20, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function CreateSeriesForm({ disabled, onCreated }: Props) {
  const venuesQuery = useVenues();
  const createSeries = useCreateEventSeries();

  const [seriesName, setSeriesName] = useState('');
  const [description, setDescription] = useState('');
  const [venueId, setVenueId] = useState('');
  const [capacity, setCapacity] = useState(500);
  const [basePrice, setBasePrice] = useState(450);
  const [preview, setPreview] = useState<SchedulePreview | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [schedule, setSchedule] = useState<ScheduleBuilderValue>({
    mode: 'recurring',
    rule: {
      frequency: 'WEEKLY',
      startLocal: defaultStartLocal(),
      timezone: 'America/Mexico_City',
      interval: 1,
      count: 8,
    },
  });

  const timezone = 'America/Mexico_City';
  const template: SeriesTemplate = useMemo(
    () => ({
      capacity,
      basePrice,
      currency: 'MXN',
      description: description || undefined,
    }),
    [capacity, basePrice, description]
  );

  const canSubmit =
    !disabled &&
    seriesName.trim().length >= 3 &&
    Boolean(venueId) &&
    capacity > 0 &&
    basePrice >= 0 &&
    schedule.mode === 'recurring' &&
    (preview?.totals.occurrences ?? 0) > 0 &&
    (preview?.totals.blocking ?? 0) === 0;

  async function submit() {
    if (!canSubmit || !preview) return;
    setFailure(null);
    const exceptions = new Set(schedule.rule.exceptions ?? []);
    const occurrences = preview.occurrences
      .filter((item) => !exceptions.has(item.localDate))
      .map((item) => ({
        date: item.startsAt,
        title: seriesName.trim(),
        capacity,
        basePrice,
      }));

    if (!occurrences.length) {
      setFailure('No hay fechas válidas para la serie.');
      return;
    }

    try {
      // La regla y la plantilla se guardan en la serie para mostrarlas y poder
      // extenderla después. El hook reenvía el cuerpo completo al API.
      const payload = {
        seriesName: seriesName.trim(),
        description: description.trim(),
        venueId,
        occurrences,
        recurrence: { ...schedule.rule, timezone },
        template,
      };
      const result = await createSeries.mutateAsync(payload);
      setSeriesName('');
      setDescription('');
      onCreated?.(
        `Serie creada · ${formatCount(result.totalEvents)} eventos en gestión. Revisa el listado de Eventos.`
      );
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'No se pudo crear la serie.');
    }
  }

  if (venuesQuery.isPending) return <p className={frame.quiet}>Cargando recintos.</p>;
  if (venuesQuery.error) {
    return (
      <div className={styles.alert} role="alert">
        <p className={styles.subTitle}>No se pudieron cargar recintos</p>
        <p className={frame.danger}>
          {venuesQuery.error instanceof Error ? venuesQuery.error.message : 'Error desconocido'}
        </p>
        <div className={styles.actions}>
          <TicketButton variant="secondary" onClick={() => void venuesQuery.refetch()}>
            Reintentar
          </TicketButton>
        </div>
      </div>
    );
  }
  if (!venuesQuery.data?.length) {
    return <p className={frame.quiet}>Necesitas al menos un recinto para crear una serie.</p>;
  }

  return (
    <div className={styles.block}>
      <h2 className={styles.subTitle}>Nueva serie de funciones</h2>
      <p className={frame.quiet}>
        Alta rápida de fechas a partir de la vista previa de recurrencia. Para series con fases y
        ficha propia, usa el asistente completo.
      </p>
      <div className={styles.formGrid}>
        <Field
          className={styles.full}
          label="Nombre de la serie"
          value={seriesName}
          onChange={(e) => setSeriesName(e.target.value)}
          placeholder="Ej. Ciclo de jazz — primavera"
          disabled={disabled}
        />
        <Field
          className={styles.full}
          label="Descripción"
          value={description}
          onChange={(e) => setDescription(e.target.value)}
          disabled={disabled}
        />
        <div className={`${styles.pick} ${styles.full}`}>
          <p className={styles.caption}>Recinto</p>
          <SheetSelect
            label="Recinto"
            value={venueId}
            placeholder="Seleccionar recinto"
            options={venuesQuery.data.map((venue) => ({ value: venue.id, label: venue.name }))}
            onChange={setVenueId}
          />
        </div>
        <Field
          label="Aforo por fecha"
          type="number"
          min={1}
          value={capacity}
          onChange={(e) => setCapacity(Number(e.target.value) || 0)}
          disabled={disabled}
        />
        <Field
          label="Precio base"
          kind="money"
          type="number"
          min={0}
          step={50}
          value={basePrice}
          onChange={(e) => setBasePrice(Number(e.target.value) || 0)}
          hint={`${formatTicketAmount(basePrice)} MXN · zona horaria ${timezone}`}
          disabled={disabled}
        />
      </div>

      <div className={styles.builder}>
        {venueId ? (
          <ScheduleBuilder
            venueId={venueId}
            timezone={timezone}
            template={template}
            value={schedule}
            onChange={(value) =>
              setSchedule(value.mode === 'recurring' ? value : { ...value, mode: 'recurring' })
            }
            onPreview={setPreview}
          />
        ) : (
          <p className={frame.tertiary}>Selecciona un recinto para calcular la recurrencia.</p>
        )}
      </div>

      {(preview?.totals.blocking ?? 0) > 0 ? (
        <p className={frame.danger} role="alert">
          Hay {formatCount(preview?.totals.blocking ?? 0)} conflicto(s) bloqueantes. Ajusta la
          recurrencia antes de crear.
        </p>
      ) : null}
      {venueId && !preview ? (
        <p className={frame.tertiary}>
          Sin vista previa de fechas no se puede crear: la serie necesita al menos una fecha.
        </p>
      ) : null}
      {failure ? (
        <p className={frame.danger} role="alert">
          {failure}
        </p>
      ) : null}

      <div className={styles.actions}>
        <TicketButton disabled={!canSubmit || createSeries.isPending} onClick={() => void submit()}>
          {createSeries.isPending
            ? 'Creando serie'
            : `Crear serie (${formatCount(preview?.totals.occurrences ?? 0)} fechas)`}
        </TicketButton>
      </div>
    </div>
  );
}
