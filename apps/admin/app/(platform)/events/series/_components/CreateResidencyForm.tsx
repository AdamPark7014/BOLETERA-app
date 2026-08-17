'use client';

import { useMemo, useState } from 'react';
import {
  Button,
  Card,
  CardHeader,
  EmptyState,
  formatCurrency,
  formatNumber,
  Skeleton,
} from '@boletera/ui';
import { ScheduleBuilder, type ScheduleBuilderValue } from '@/components/ScheduleBuilder/ScheduleBuilder';
import { useToast } from '@/components/Toast/ToastProvider';
import { useCreateResidency } from '@/lib/queries/events';
import { useVenues } from '@/lib/queries/venues';
import type { SchedulePreview, SeriesTemplate } from '@/lib/scheduling-api';
import styles from '../series.module.scss';

type Props = {
  disabled?: boolean;
  onCreated?: () => void;
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
  const toast = useToast();
  const venuesQuery = useVenues();
  const createResidency = useCreateResidency();

  const [name, setName] = useState('');
  const [venueId, setVenueId] = useState('');
  const [capacity, setCapacity] = useState(400);
  const [basePrice, setBasePrice] = useState(350);
  const [preview, setPreview] = useState<SchedulePreview | null>(null);
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
    [capacity, basePrice],
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
      const total =
        typeof result.totalEvents === 'number' ? result.totalEvents : occurrenceCount;
      toast.success(`Residencia creada · ${formatNumber(total)} fechas`);
      setName('');
      onCreated?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo crear la residencia');
    }
  }

  if (venuesQuery.isPending) return <Skeleton height={280} />;
  if (venuesQuery.error) {
    return (
      <EmptyState
        title="No se pudieron cargar recintos"
        description={
          venuesQuery.error instanceof Error
            ? venuesQuery.error.message
            : 'Error desconocido'
        }
        illustration="error"
        tone="danger"
        action={
          <Button type="button" onClick={() => void venuesQuery.refetch()}>
            Reintentar
          </Button>
        }
      />
    );
  }
  if (!venuesQuery.data?.length) {
    return (
      <EmptyState
        title="Sin recintos"
        description="Necesitas al menos un recinto para crear una residencia."
        illustration="seats"
      />
    );
  }

  return (
    <Card variant="outline" padding="lg">
      <CardHeader
        title="Nueva residencia"
        description="Alta rápida de residencia: misma plaza y ritmo fijo. La frecuencia se deriva de la regla del ScheduleBuilder."
      />
      <div className={styles.formGrid}>
        <label className={`${styles.field} ${styles.full}`}>
          Nombre de la residencia
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Ej. Residencia stand-up — Foro Sur"
            disabled={disabled}
          />
        </label>
        <label className={styles.field}>
          Recinto
          <select
            value={venueId}
            onChange={(e) => setVenueId(e.target.value)}
            disabled={disabled}
          >
            <option value="">Seleccionar…</option>
            {venuesQuery.data.map((venue) => (
              <option key={venue.id} value={venue.id}>
                {venue.name}
              </option>
            ))}
          </select>
        </label>
        <label className={styles.field}>
          Aforo
          <input
            type="number"
            min={1}
            value={capacity}
            onChange={(e) => setCapacity(Number(e.target.value) || 0)}
            disabled={disabled}
          />
        </label>
        <label className={styles.field}>
          Precio base (MXN)
          <input
            type="number"
            min={0}
            step={50}
            value={basePrice}
            onChange={(e) => setBasePrice(Number(e.target.value) || 0)}
            disabled={disabled}
          />
        </label>
        <p className={`${styles.hint} ${styles.full}`}>
          Frecuencia efectiva: <strong>{FREQUENCY_LABELS[frequency]}</strong> ·{' '}
          {formatNumber(occurrenceCount)} fechas · {formatCurrency(basePrice, 0)}
        </p>
      </div>

      <div className={styles.builderBlock}>
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
          <p className={styles.hint}>Selecciona un recinto para calcular la residencia.</p>
        )}
      </div>

      {(preview?.totals.blocking ?? 0) > 0 && (
        <p className={styles.alertDanger} role="alert">
          Hay conflictos bloqueantes en la vista previa. Ajústalos antes de crear.
        </p>
      )}

      <div className={styles.formActions}>
        <Button
          type="button"
          loading={createResidency.isPending}
          disabled={!canSubmit}
          onClick={() => void submit()}
        >
          Crear residencia
        </Button>
      </div>
    </Card>
  );
}
