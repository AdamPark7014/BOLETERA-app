'use client';

import { useMemo, useState } from 'react';
import { Field, TicketButton, formatTicketAmount } from '@boletera/ui';
import {
  ScheduleBuilder,
  type ScheduleBuilderValue,
} from '@/components/ScheduleBuilder/ScheduleBuilder';
import { useCreateResidency } from '@/lib/queries/events';
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

type Frequency = 'daily' | 'weekly' | 'biweekly' | 'monthly';

function defaultStartLocal(): string {
  const date = new Date();
  date.setDate(date.getDate() + 7);
  date.setHours(21, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function mapFrequency(rule: ScheduleBuilderValue['rule']): Frequency {
  if (rule.frequency === 'DAILY') return 'daily';
  if (rule.frequency === 'MONTHLY') return 'monthly';
  if ((rule.interval ?? 1) >= 2) return 'biweekly';
  return 'weekly';
}

const FREQUENCY_LABELS: Record<Frequency, string> = {
  daily: 'Diaria',
  weekly: 'Semanal',
  biweekly: 'Quincenal',
  monthly: 'Mensual',
};

export function CreateResidencyForm({ disabled, onCreated }: Props) {
  const venuesQuery = useVenues();
  const createResidency = useCreateResidency();

  const [name, setName] = useState('');
  const [venueId, setVenueId] = useState('');
  const [capacity, setCapacity] = useState(400);
  const [basePrice, setBasePrice] = useState(350);
  const [preview, setPreview] = useState<SchedulePreview | null>(null);
  const [failure, setFailure] = useState<string | null>(null);
  const [schedule, setSchedule] = useState<ScheduleBuilderValue>({
    mode: 'recurring',
    rule: {
      frequency: 'WEEKLY',
      startLocal: defaultStartLocal(),
      timezone: 'America/Mexico_City',
      interval: 1,
      count: 12,
    },
  });

  const timezone = 'America/Mexico_City';
  const frequency = mapFrequency(schedule.rule);
  const occurrenceCount = preview?.totals.occurrences ?? schedule.rule.count ?? 12;

  const template: SeriesTemplate = useMemo(
    () => ({
      capacity,
      basePrice,
      currency: 'MXN',
    }),
    [capacity, basePrice]
  );

  const canSubmit =
    !disabled &&
    name.trim().length >= 3 &&
    Boolean(venueId) &&
    capacity > 0 &&
    basePrice >= 0 &&
    occurrenceCount > 0 &&
    (preview?.totals.blocking ?? 0) === 0;

  async function submit() {
    if (!canSubmit) return;
    setFailure(null);
    try {
      const result = await createResidency.mutateAsync({
        name: name.trim(),
        venueId,
        startDate: schedule.rule.startLocal,
        frequency,
        occurrenceCount,
        capacity,
        basePrice,
      });
      const total = typeof result.totalEvents === 'number' ? result.totalEvents : occurrenceCount;
      setName('');
      onCreated?.(`Residencia creada · ${formatCount(total)} fechas`);
    } catch (error) {
      setFailure(error instanceof Error ? error.message : 'No se pudo crear la residencia.');
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
    return <p className={frame.quiet}>Necesitas al menos un recinto para crear una residencia.</p>;
  }

  return (
    <div className={styles.block}>
      <h2 className={styles.subTitle}>Nueva residencia</h2>
      <p className={frame.quiet}>
        Misma plaza y ritmo fijo. La frecuencia se deriva de la regla de recurrencia.
      </p>
      <div className={styles.formGrid}>
        <Field
          className={styles.full}
          label="Nombre de la residencia"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="Ej. Residencia stand-up — Foro Sur"
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
          label="Aforo"
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
          disabled={disabled}
        />
        <p className={`${frame.quiet} ${styles.full}`}>
          Frecuencia efectiva: {FREQUENCY_LABELS[frequency]} · {formatCount(occurrenceCount)} fechas
          · {formatTicketAmount(basePrice)} MXN
        </p>
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
          <p className={frame.tertiary}>Selecciona un recinto para calcular la residencia.</p>
        )}
      </div>

      {(preview?.totals.blocking ?? 0) > 0 ? (
        <p className={frame.danger} role="alert">
          Hay conflictos bloqueantes en la vista previa. Ajústalos antes de crear.
        </p>
      ) : null}
      {failure ? (
        <p className={frame.danger} role="alert">
          {failure}
        </p>
      ) : null}

      <div className={styles.actions}>
        <TicketButton
          disabled={!canSubmit || createResidency.isPending}
          onClick={() => void submit()}
        >
          {createResidency.isPending ? 'Creando residencia' : 'Crear residencia'}
        </TicketButton>
      </div>
    </div>
  );
}
