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
import { useCreateEventSeries } from '@/lib/queries/events';
import { useVenues } from '@/lib/queries/venues';
import type { SchedulePreview, SeriesTemplate } from '@/lib/scheduling-api';
import styles from '../series.module.scss';

type Props = {
  disabled?: boolean;
  onCreated?: () => void;
};

function defaultStartLocal(): string {
  const date = new Date();
  date.setDate(date.getDate() + 14);
  date.setHours(20, 0, 0, 0);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

export function CreateSeriesForm({ disabled, onCreated }: Props) {
  const toast = useToast();
  const venuesQuery = useVenues();
  const createSeries = useCreateEventSeries();

  const [seriesName, setSeriesName] = useState('');
  const [description, setDescription] = useState('');
  const [venueId, setVenueId] = useState('');
  const [capacity, setCapacity] = useState(500);
  const [basePrice, setBasePrice] = useState(450);
  const [preview, setPreview] = useState<SchedulePreview | null>(null);
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
    [capacity, basePrice, description],
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
      toast.error('No hay fechas válidas para la serie');
      return;
    }

    try {
      const result = await createSeries.mutateAsync({
        seriesName: seriesName.trim(),
        description: description.trim(),
        venueId,
        occurrences,
      });
      toast.success(
        `Serie creada · ${formatNumber(result.totalEvents)} eventos en gestión. Revisa el listado de Eventos.`,
      );
      setSeriesName('');
      setDescription('');
      onCreated?.();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo crear la serie');
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
        description="Necesitas al menos un recinto para crear una serie."
        illustration="seats"
      />
    );
  }

  return (
    <Card variant="outline" padding="lg">
      <CardHeader
        title="Nueva serie de funciones"
        description="Alta rápida de fechas a partir de la vista previa del ScheduleBuilder. Para series programadas con fases y ficha en este catálogo, usa el asistente completo."
      />
      <div className={styles.formGrid}>
        <label className={`${styles.field} ${styles.full}`}>
          Nombre de la serie
          <input
            value={seriesName}
            onChange={(e) => setSeriesName(e.target.value)}
            placeholder="Ej. Ciclo de jazz — primavera"
            disabled={disabled}
          />
        </label>
        <label className={`${styles.field} ${styles.full}`}>
          Descripción
          <textarea
            rows={3}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
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
          Aforo por fecha
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
          Precio de referencia: <strong>{formatCurrency(basePrice, 0)}</strong> · zona horaria{' '}
          {timezone}
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
          <p className={styles.hint}>Selecciona un recinto para calcular la recurrencia.</p>
        )}
      </div>

      {(preview?.totals.blocking ?? 0) > 0 && (
        <p className={styles.alertDanger} role="alert">
          Hay {formatNumber(preview?.totals.blocking ?? 0)} conflicto(s) bloqueantes. Ajusta la
          recurrencia antes de crear.
        </p>
      )}

      <div className={styles.formActions}>
        <Button
          type="button"
          loading={createSeries.isPending}
          disabled={!canSubmit}
          onClick={() => void submit()}
        >
          Crear serie ({formatNumber(preview?.totals.occurrences ?? 0)} fechas)
        </Button>
      </div>
    </Card>
  );
}
