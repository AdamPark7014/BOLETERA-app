'use client';

import { useState, type FormEvent } from 'react';
import { Button, Input, Modal } from '@boletera/ui';
import styles from '../sponsorships.module.scss';

export type CreatePackagePayload = {
  name: string;
  sponsorName: string;
  category?: string;
  value: number;
  deliverablesTotal: number;
  startsAt?: string;
  endsAt?: string;
};

type CreatePackageModalProps = {
  open: boolean;
  busy: boolean;
  onClose: () => void;
  onSubmit: (payload: CreatePackagePayload) => Promise<void>;
};

type FormState = {
  name: string;
  sponsorName: string;
  category: string;
  value: string;
  deliverablesTotal: string;
  startsAt: string;
  endsAt: string;
};

function defaultForm(): FormState {
  const today = new Date().toISOString().slice(0, 10);
  return {
    name: '',
    sponsorName: '',
    category: '',
    value: '250000',
    deliverablesTotal: '6',
    startsAt: today,
    endsAt: '',
  };
}

export function CreatePackageModal({
  open,
  busy,
  onClose,
  onSubmit,
}: CreatePackageModalProps) {
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
    const sponsorName = form.sponsorName.trim();
    if (!name || !sponsorName) {
      setLocalError('Nombre del paquete y patrocinador son obligatorios.');
      return;
    }

    const value = Number(form.value);
    if (!Number.isFinite(value) || value <= 0) {
      setLocalError('El valor debe ser mayor a 0.');
      return;
    }

    const deliverablesTotal = Number(form.deliverablesTotal);
    if (!Number.isFinite(deliverablesTotal) || deliverablesTotal < 1) {
      setLocalError('Debes definir al menos un entregable.');
      return;
    }

    if (form.endsAt && form.startsAt && new Date(form.endsAt) <= new Date(form.startsAt)) {
      setLocalError('La fecha de fin debe ser posterior al inicio.');
      return;
    }

    try {
      await onSubmit({
        name,
        sponsorName,
        category: form.category.trim() || undefined,
        value,
        deliverablesTotal: Math.round(deliverablesTotal),
        startsAt: form.startsAt || undefined,
        endsAt: form.endsAt || undefined,
      });
      reset();
    } catch (error) {
      setLocalError(
        error instanceof Error ? error.message : 'No se pudo crear el paquete.',
      );
    }
  }

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title="Nuevo paquete de patrocinio"
      description="Define valor, patrocinador y entregables. Se publica vía API."
      size="md"
    >
      <form className={styles.formGrid} onSubmit={(e) => void handleSubmit(e)}>
        <Input
          label="Nombre del paquete"
          value={form.name}
          onChange={(e) => setForm((prev) => ({ ...prev, name: e.target.value }))}
          required
          autoFocus
        />
        <Input
          label="Patrocinador"
          value={form.sponsorName}
          onChange={(e) =>
            setForm((prev) => ({ ...prev, sponsorName: e.target.value }))
          }
          required
        />
        <div className={styles.fieldRow}>
          <Input
            label="Valor (MXN)"
            type="number"
            min={1}
            value={form.value}
            onChange={(e) => setForm((prev) => ({ ...prev, value: e.target.value }))}
            required
          />
          <Input
            label="Entregables"
            type="number"
            min={1}
            value={form.deliverablesTotal}
            onChange={(e) =>
              setForm((prev) => ({ ...prev, deliverablesTotal: e.target.value }))
            }
            required
          />
        </div>
        <Input
          label="Categoría (opcional)"
          value={form.category}
          onChange={(e) => setForm((prev) => ({ ...prev, category: e.target.value }))}
        />
        <div className={styles.fieldRow}>
          <Input
            label="Inicio"
            type="date"
            value={form.startsAt}
            onChange={(e) => setForm((prev) => ({ ...prev, startsAt: e.target.value }))}
          />
          <Input
            label="Fin"
            type="date"
            value={form.endsAt}
            onChange={(e) => setForm((prev) => ({ ...prev, endsAt: e.target.value }))}
          />
        </div>
        {localError ? <p className={styles.formError}>{localError}</p> : null}
        <div className={styles.modalFooter}>
          <Button type="button" variant="ghost" disabled={busy} onClick={handleClose}>
            Cancelar
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? 'Creando…' : 'Crear paquete'}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
