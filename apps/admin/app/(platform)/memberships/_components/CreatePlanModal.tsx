'use client';

import { useState, type FormEvent } from 'react';
import { Button, Input, Modal } from '@boletera/ui';
import { slugify } from '../_lib/plans';
import styles from '../memberships.module.scss';

export type CreatePlanPayload = {
  name: string;
  slug: string;
  tier: string;
  price: number;
  billingPeriod: 'MONTHLY' | 'ANNUAL' | 'SEASON';
  description?: string;
  maxMembers?: number;
};

type CreatePlanModalProps = {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (payload: CreatePlanPayload) => Promise<void>;
};

type FormState = {
  name: string;
  slug: string;
  tier: string;
  price: string;
  billingPeriod: 'MONTHLY' | 'ANNUAL' | 'SEASON';
  maxMembers: string;
  description: string;
  slugTouched: boolean;
};

function defaultForm(): FormState {
  return {
    name: '',
    slug: '',
    tier: 'Premium',
    price: '2499',
    billingPeriod: 'ANNUAL',
    maxMembers: '',
    description: '',
    slugTouched: false,
  };
}

export function CreatePlanModal({ open, busy, onClose, onSubmit }: CreatePlanModalProps) {
  const [form, setForm] = useState<FormState>(defaultForm);
  const [localError, setLocalError] = useState<string | null>(null);

  function reset() {
    setForm(defaultForm());
    setLocalError(null);
  }

  function handleClose() {
    if (busy) return;
    reset();
    onClose();
  }

  async function handleSubmit(event: FormEvent) {
    event.preventDefault();
    setLocalError(null);

    const name = form.name.trim();
    if (!name) {
      setLocalError('El nombre es obligatorio.');
      return;
    }

    const price = Number(form.price);
    if (!Number.isFinite(price) || price <= 0) {
      setLocalError('El precio debe ser mayor a 0.');
      return;
    }

    const maxMembers = form.maxMembers.trim()
      ? Number(form.maxMembers)
      : undefined;
    if (maxMembers !== undefined && (!Number.isFinite(maxMembers) || maxMembers < 1)) {
      setLocalError('El cupo máximo debe ser un entero positivo.');
      return;
    }

    try {
      await onSubmit({
        name,
        slug: form.slug.trim() || slugify(name),
        tier: form.tier.trim() || 'Standard',
        price,
        billingPeriod: form.billingPeriod,
        description: form.description.trim() || undefined,
        maxMembers,
      });
      reset();
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'No se pudo crear el plan.');
    }
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Nuevo plan de membresía"
      description="Define tier, precio y cupo. El plan se publica vía API."
      size="md"
    >
      <form className={styles.formGrid} onSubmit={(e) => void handleSubmit(e)}>
        <Input
          label="Nombre"
          value={form.name}
          onChange={(e) => {
            const name = e.target.value;
            setForm((prev) => ({
              ...prev,
              name,
              slug: prev.slugTouched ? prev.slug : slugify(name),
            }));
          }}
          required
          autoFocus
        />
        <div className={styles.fieldRow}>
          <Input
            label="Slug"
            value={form.slug}
            onChange={(e) =>
              setForm((prev) => ({
                ...prev,
                slug: e.target.value,
                slugTouched: true,
              }))
            }
          />
          <Input
            label="Tier"
            value={form.tier}
            onChange={(e) => setForm((prev) => ({ ...prev, tier: e.target.value }))}
          />
        </div>
        <div className={styles.fieldRow}>
          <Input
            label="Precio (MXN)"
            type="number"
            min={1}
            step="0.01"
            value={form.price}
            onChange={(e) => setForm((prev) => ({ ...prev, price: e.target.value }))}
            required
          />
          <label className={styles.selectField}>
            <span>Periodo</span>
            <select
              value={form.billingPeriod}
              onChange={(e) =>
                setForm((prev) => ({
                  ...prev,
                  billingPeriod: e.target.value as FormState['billingPeriod'],
                }))
              }
            >
              <option value="ANNUAL">Anual</option>
              <option value="MONTHLY">Mensual</option>
              <option value="SEASON">Temporada</option>
            </select>
          </label>
        </div>
        <Input
          label="Cupo máximo (opcional)"
          type="number"
          min={1}
          value={form.maxMembers}
          onChange={(e) => setForm((prev) => ({ ...prev, maxMembers: e.target.value }))}
        />
        <Input
          label="Descripción (opcional)"
          value={form.description}
          onChange={(e) => setForm((prev) => ({ ...prev, description: e.target.value }))}
        />
        {localError ? <p className={styles.formError}>{localError}</p> : null}
        <div className={styles.modalFooter}>
          <Button type="button" variant="ghost" disabled={busy} onClick={handleClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? 'Creando…' : 'Crear plan'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
