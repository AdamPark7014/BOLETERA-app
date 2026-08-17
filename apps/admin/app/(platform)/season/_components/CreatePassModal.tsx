'use client';

import { useState, type FormEvent } from 'react';
import { Button, Input, Modal } from '@boletera/ui';
import { slugify } from '../_lib/passes';
import styles from '../season.module.scss';

export type CreatePassPayload = {
  name: string;
  slug: string;
  seasonLabel: string;
  price: number;
  startsAt: string;
  endsAt: string;
};

type CreatePassModalProps = {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (payload: CreatePassPayload) => Promise<void>;
};

type FormState = {
  name: string;
  slug: string;
  seasonLabel: string;
  price: string;
  startsAt: string;
  endsAt: string;
  slugTouched: boolean;
};

function defaultForm(): FormState {
  const today = new Date();
  const end = new Date(today.getTime() + 365 * 24 * 60 * 60 * 1000);
  return {
    name: '',
    slug: '',
    seasonLabel: `${today.getFullYear()}-${today.getFullYear() + 1}`,
    price: '4500',
    startsAt: today.toISOString().slice(0, 10),
    endsAt: end.toISOString().slice(0, 10),
    slugTouched: false,
  };
}

export function CreatePassModal({ open, busy, onClose, onSubmit }: CreatePassModalProps) {
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

    if (new Date(form.endsAt) <= new Date(form.startsAt)) {
      setLocalError('La fecha de fin debe ser posterior al inicio.');
      return;
    }

    const slug = (form.slug.trim() || slugify(name)).trim();
    if (!slug) {
      setLocalError('El slug no es válido.');
      return;
    }

    try {
      await onSubmit({
        name,
        slug,
        seasonLabel: form.seasonLabel.trim(),
        price,
        startsAt: new Date(`${form.startsAt}T00:00:00`).toISOString(),
        endsAt: new Date(`${form.endsAt}T23:59:59`).toISOString(),
      });
      reset();
    } catch (error) {
      setLocalError(error instanceof Error ? error.message : 'No se pudo crear el abono.');
    }
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Crear abono de temporada"
      description="Publica un pase con precio, vigencia y cupo inicial."
      size="lg"
      dismissible={!busy}
      footer={
        <div className={styles.modalFooter}>
          <Button type="button" variant="ghost" disabled={busy} onClick={handleClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form="create-season-pass"
            loading={busy}
            loadingLabel="Publicando…"
          >
            Publicar abono
          </Button>
        </div>
      }
    >
      <form
        id="create-season-pass"
        className={styles.formGrid}
        onSubmit={(e) => void handleSubmit(e)}
      >
        <Input
          label="Nombre"
          requiredMark
          required
          value={form.name}
          onChange={(e) => {
            const name = e.target.value;
            setForm((current) => ({
              ...current,
              name,
              slug: current.slugTouched ? current.slug : slugify(name),
            }));
          }}
          placeholder="Abono Anual 2026"
          autoFocus
        />
        <Input
          label="Slug"
          value={form.slug}
          onChange={(e) =>
            setForm((current) => ({
              ...current,
              slug: e.target.value,
              slugTouched: true,
            }))
          }
          placeholder="abono-anual-2026"
          hint="Identificador URL-friendly"
        />
        <div className={styles.fieldRow}>
          <Input
            label="Temporada"
            requiredMark
            required
            value={form.seasonLabel}
            onChange={(e) => setForm((current) => ({ ...current, seasonLabel: e.target.value }))}
            placeholder="2026-2027"
          />
          <Input
            label="Precio (MXN)"
            type="number"
            min={1}
            step={1}
            requiredMark
            required
            value={form.price}
            onChange={(e) => setForm((current) => ({ ...current, price: e.target.value }))}
          />
        </div>
        <div className={styles.fieldRow}>
          <Input
            label="Inicio"
            type="date"
            requiredMark
            required
            value={form.startsAt}
            onChange={(e) => setForm((current) => ({ ...current, startsAt: e.target.value }))}
          />
          <Input
            label="Fin"
            type="date"
            requiredMark
            required
            value={form.endsAt}
            onChange={(e) => setForm((current) => ({ ...current, endsAt: e.target.value }))}
          />
        </div>
        {localError ? (
          <p className={styles.formError} role="alert">
            {localError}
          </p>
        ) : null}
      </form>
    </Modal>
  );
}
