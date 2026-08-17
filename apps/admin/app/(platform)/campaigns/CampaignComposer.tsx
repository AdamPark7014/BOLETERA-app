'use client';

import { useEffect, useId, useMemo, useState } from 'react';
import { Button, Modal } from '@boletera/ui';
import { toLocalInputValue } from './model';
import styles from './campaigns.module.scss';

export type ComposerPayload = {
  name: string;
  type: string;
  discountType: 'percentage' | 'fixed';
  discountValue: number;
  allocation: number;
  quantityPerUser: number;
  startsAt: string;
  endsAt: string;
};

type ComposerProps = {
  open: boolean;
  eventTitle: string;
  submitting: boolean;
  error: string | null;
  onClose: () => void;
  onSubmit: (payload: ComposerPayload) => void;
};

type FormState = {
  name: string;
  type: string;
  discountType: 'percentage' | 'fixed';
  discountValue: string;
  allocation: string;
  quantityPerUser: string;
  startsAt: string;
  endsAt: string;
};

const TYPE_OPTIONS: ReadonlyArray<{ value: string; label: string; hint: string }> = [
  { value: 'presale', label: 'Preventa', hint: 'Genera códigos únicos por lugar asignado.' },
  { value: 'early_bird', label: 'Early bird', hint: 'Descuento por compra anticipada, sin códigos.' },
  { value: 'vip', label: 'VIP', hint: 'Acceso preferente para audiencias seleccionadas.' },
  { value: 'group', label: 'Grupal', hint: 'Pensada para compras de varios boletos.' },
];

/** Cotas replicadas de la validación del backend para fallar antes de la red. */
const MAX_ALLOCATION = 100;

function defaultState(): FormState {
  const start = new Date(Date.now() + 60 * 60 * 1000);
  const end = new Date(start.getTime() + 14 * 24 * 60 * 60 * 1000);
  return {
    name: '',
    type: 'presale',
    discountType: 'percentage',
    discountValue: '15',
    allocation: '50',
    quantityPerUser: '4',
    startsAt: toLocalInputValue(start),
    endsAt: toLocalInputValue(end),
  };
}

function validate(form: FormState): Partial<Record<keyof FormState, string>> {
  const errors: Partial<Record<keyof FormState, string>> = {};
  if (!form.name.trim()) errors.name = 'Ponle un nombre reconocible para el equipo.';

  const discountValue = Number(form.discountValue);
  if (!Number.isFinite(discountValue) || discountValue < 0) {
    errors.discountValue = 'El descuento no puede ser negativo.';
  } else if (form.discountType === 'percentage' && discountValue > 100) {
    errors.discountValue = 'Un porcentaje no puede superar 100 %.';
  }

  const allocation = Number(form.allocation);
  if (!Number.isInteger(allocation) || allocation < 1 || allocation > MAX_ALLOCATION) {
    errors.allocation = `El cupo debe ser un entero entre 1 y ${MAX_ALLOCATION}.`;
  }

  const perUser = Number(form.quantityPerUser);
  if (!Number.isInteger(perUser) || perUser < 1) {
    errors.quantityPerUser = 'Cada usuario debe poder comprar al menos 1 boleto.';
  }

  const start = new Date(form.startsAt);
  const end = new Date(form.endsAt);
  if (Number.isNaN(start.getTime())) errors.startsAt = 'Fecha de inicio inválida.';
  if (Number.isNaN(end.getTime())) errors.endsAt = 'Fecha de fin inválida.';
  if (!errors.startsAt && !errors.endsAt && end <= start) {
    errors.endsAt = 'La ventana debe cerrar después de abrir.';
  }
  return errors;
}

/** Alta guiada de campañas: valida en cliente y explica el efecto de cada campo. */
export function CampaignComposer({
  open,
  eventTitle,
  submitting,
  error,
  onClose,
  onSubmit,
}: ComposerProps) {
  const formId = useId();
  const [form, setForm] = useState<FormState>(defaultState);
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (!open) return;
    setForm(defaultState());
    setTouched(false);
  }, [open]);

  const errors = useMemo(() => validate(form), [form]);
  const invalid = Object.keys(errors).length > 0;
  const typeHint = TYPE_OPTIONS.find((option) => option.value === form.type)?.hint ?? '';

  function update<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setTouched(true);
    if (invalid) return;
    onSubmit({
      name: form.name.trim(),
      type: form.type,
      discountType: form.discountType,
      discountValue: Number(form.discountValue),
      allocation: Number(form.allocation),
      quantityPerUser: Number(form.quantityPerUser),
      startsAt: new Date(form.startsAt).toISOString(),
      endsAt: new Date(form.endsAt).toISOString(),
    });
  }

  function fieldError(key: keyof FormState): string | undefined {
    return touched ? errors[key] : undefined;
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Nueva campaña"
      description={`Se creará en ${eventTitle} y quedará en borrador hasta que la publiques.`}
      size="lg"
      footer={
        <div className={styles.modalFooter}>
          <Button type="button" variant="ghost" onClick={onClose} disabled={submitting}>
            Cancelar
          </Button>
          <Button type="submit" form={formId} loading={submitting}>
            Crear en borrador
          </Button>
        </div>
      }
    >
      <form id={formId} className={styles.form} onSubmit={handleSubmit} noValidate>
        {error ? (
          <p className={styles.formError} role="alert">
            {error}
          </p>
        ) : null}

        <label className={styles.fieldFull}>
          <span className={styles.fieldLabel}>Nombre de la campaña</span>
          <input
            className={styles.input}
            value={form.name}
            onChange={(event) => update('name', event.target.value)}
            placeholder="Preventa fans club"
            aria-invalid={fieldError('name') ? true : undefined}
            aria-describedby={fieldError('name') ? `${formId}-name-error` : undefined}
            autoFocus
          />
          {fieldError('name') ? (
            <span className={styles.fieldError} id={`${formId}-name-error`}>
              {errors.name}
            </span>
          ) : null}
        </label>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>Tipo</span>
          <select
            className={styles.input}
            value={form.type}
            onChange={(event) => update('type', event.target.value)}
          >
            {TYPE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>
          <span className={styles.fieldHint}>{typeHint}</span>
        </label>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>Tipo de descuento</span>
          <select
            className={styles.input}
            value={form.discountType}
            onChange={(event) =>
              update('discountType', event.target.value === 'fixed' ? 'fixed' : 'percentage')
            }
          >
            <option value="percentage">Porcentaje</option>
            <option value="fixed">Monto fijo (MXN)</option>
          </select>
          <span className={styles.fieldHint}>
            Se aplica sobre el precio base al validar el código en checkout.
          </span>
        </label>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>
            {form.discountType === 'percentage' ? 'Descuento (%)' : 'Descuento (MXN)'}
          </span>
          <input
            className={styles.input}
            type="number"
            inputMode="decimal"
            min={0}
            max={form.discountType === 'percentage' ? 100 : undefined}
            step={form.discountType === 'percentage' ? 1 : 50}
            value={form.discountValue}
            onChange={(event) => update('discountValue', event.target.value)}
            aria-invalid={fieldError('discountValue') ? true : undefined}
            aria-describedby={
              fieldError('discountValue') ? `${formId}-discount-error` : undefined
            }
          />
          {fieldError('discountValue') ? (
            <span className={styles.fieldError} id={`${formId}-discount-error`}>
              {errors.discountValue}
            </span>
          ) : null}
        </label>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>Cupo</span>
          <input
            className={styles.input}
            type="number"
            inputMode="numeric"
            min={1}
            max={MAX_ALLOCATION}
            value={form.allocation}
            onChange={(event) => update('allocation', event.target.value)}
            aria-invalid={fieldError('allocation') ? true : undefined}
            aria-describedby={`${formId}-allocation-hint`}
          />
          <span className={styles.fieldHint} id={`${formId}-allocation-hint`}>
            {fieldError('allocation') ??
              `Lugares reservados para la campaña (máximo ${MAX_ALLOCATION}). En preventa se genera un código por lugar.`}
          </span>
        </label>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>Boletos por usuario</span>
          <input
            className={styles.input}
            type="number"
            inputMode="numeric"
            min={1}
            value={form.quantityPerUser}
            onChange={(event) => update('quantityPerUser', event.target.value)}
            aria-invalid={fieldError('quantityPerUser') ? true : undefined}
          />
          {fieldError('quantityPerUser') ? (
            <span className={styles.fieldError}>{errors.quantityPerUser}</span>
          ) : null}
        </label>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>Abre</span>
          <input
            className={styles.input}
            type="datetime-local"
            value={form.startsAt}
            onChange={(event) => update('startsAt', event.target.value)}
            aria-invalid={fieldError('startsAt') ? true : undefined}
          />
          {fieldError('startsAt') ? (
            <span className={styles.fieldError}>{errors.startsAt}</span>
          ) : null}
        </label>

        <label className={styles.field}>
          <span className={styles.fieldLabel}>Cierra</span>
          <input
            className={styles.input}
            type="datetime-local"
            value={form.endsAt}
            onChange={(event) => update('endsAt', event.target.value)}
            aria-invalid={fieldError('endsAt') ? true : undefined}
          />
          {fieldError('endsAt') ? <span className={styles.fieldError}>{errors.endsAt}</span> : null}
        </label>
      </form>
    </Modal>
  );
}
