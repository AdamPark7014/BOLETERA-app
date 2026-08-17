'use client';

import { useState, type FormEvent } from 'react';
import { useRouter } from 'next/navigation';
import { Button, Input, Modal } from '@boletera/ui';
import { useToast } from '@/components/Toast/ToastProvider';
import { useCreateVenue, type CreateVenueInput } from '@/lib/queries/venues';
import styles from '../venues.module.scss';

type CreateVenueModalProps = {
  open: boolean;
  onClose: () => void;
};

type FormState = {
  name: string;
  city: string;
  state: string;
  address: string;
  totalCapacity: string;
  template: CreateVenueInput['template'];
};

const INITIAL: FormState = {
  name: '',
  city: '',
  state: '',
  address: '',
  totalCapacity: '',
  template: 'blank',
};

const TEMPLATES: ReadonlyArray<{ value: NonNullable<CreateVenueInput['template']>; label: string }> = [
  { value: 'blank', label: 'En blanco' },
  { value: 'theater', label: 'Teatro' },
  { value: 'arena', label: 'Arena' },
  { value: 'stadium', label: 'Estadio' },
  { value: 'festival', label: 'Festival' },
];

export function CreateVenueModal({ open, onClose }: CreateVenueModalProps) {
  const router = useRouter();
  const toast = useToast();
  const createVenue = useCreateVenue();
  const [form, setForm] = useState<FormState>(INITIAL);

  function resetAndClose() {
    setForm(INITIAL);
    onClose();
  }

  async function onSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = form.name.trim();
    if (!name) {
      toast.error('El nombre del venue es obligatorio');
      return;
    }

    const capacityRaw = form.totalCapacity.trim();
    let totalCapacity: number | undefined;
    if (capacityRaw) {
      const parsed = Number(capacityRaw);
      if (!Number.isFinite(parsed) || parsed < 0 || !Number.isInteger(parsed)) {
        toast.error('El aforo debe ser un entero mayor o igual a 0');
        return;
      }
      totalCapacity = parsed;
    }

    try {
      const venue = await createVenue.mutateAsync({
        name,
        ...(form.city.trim() ? { city: form.city.trim() } : {}),
        ...(form.state.trim() ? { state: form.state.trim() } : {}),
        ...(form.address.trim() ? { address: form.address.trim() } : {}),
        ...(totalCapacity !== undefined ? { totalCapacity } : {}),
        ...(form.template ? { template: form.template } : {}),
      });
      toast.success('Venue creado');
      resetAndClose();
      router.push(`/venues/${venue.id}/map`);
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo crear el venue');
    }
  }

  return (
    <Modal
      open={open}
      onClose={resetAndClose}
      title="Nuevo venue"
      description="Crea el recinto y abre el constructor de mapa para configurar aforo y circulación."
      size="md"
      footer={
        <div className={styles.modalActions}>
          <Button type="button" variant="ghost" onClick={resetAndClose}>
            Cancelar
          </Button>
          <Button
            type="submit"
            form="create-venue-form"
            loading={createVenue.isPending}
            loadingLabel="Creando…"
          >
            Crear y abrir mapa
          </Button>
        </div>
      }
    >
      <form id="create-venue-form" className={styles.createForm} onSubmit={(e) => void onSubmit(e)}>
        <Input
          label="Nombre"
          requiredMark
          value={form.name}
          onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))}
          placeholder="Auditorio Nacional"
          autoComplete="off"
        />
        <div className={styles.formRow}>
          <Input
            label="Ciudad"
            value={form.city}
            onChange={(event) => setForm((current) => ({ ...current, city: event.target.value }))}
            placeholder="Ciudad de México"
            autoComplete="address-level2"
          />
          <Input
            label="Estado"
            value={form.state}
            onChange={(event) => setForm((current) => ({ ...current, state: event.target.value }))}
            placeholder="CDMX"
            autoComplete="address-level1"
          />
        </div>
        <Input
          label="Dirección"
          value={form.address}
          onChange={(event) => setForm((current) => ({ ...current, address: event.target.value }))}
          placeholder="Av. Paseo de la Reforma 50"
          autoComplete="street-address"
        />
        <div className={styles.formRow}>
          <Input
            label="Aforo declarado"
            inputMode="numeric"
            value={form.totalCapacity}
            onChange={(event) =>
              setForm((current) => ({ ...current, totalCapacity: event.target.value }))
            }
            placeholder="12000"
            hint="Cupo operativo del recinto (opcional)."
          />
          <label className={styles.selectField}>
            <span>Plantilla inicial</span>
            <select
              value={form.template ?? 'blank'}
              onChange={(event) =>
                setForm((current) => ({
                  ...current,
                  template: event.target.value as CreateVenueInput['template'],
                }))
              }
            >
              {TEMPLATES.map((item) => (
                <option key={item.value} value={item.value}>
                  {item.label}
                </option>
              ))}
            </select>
          </label>
        </div>
      </form>
    </Modal>
  );
}
