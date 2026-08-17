'use client';

import { useEffect } from 'react';
import { Button, Modal } from '@boletera/ui';
import { usePublishEvent } from '@/lib/queries/events';
import { useToast } from '@/components/Toast/ToastProvider';

type Props = {
  eventId: string;
  eventTitle: string;
  open: boolean;
  onClose: () => void;
  onPublished: () => void;
  onSkip: () => void;
};

/**
 * Confirma publicación con el hook real `usePublishEvent(eventId)`.
 * Se monta solo cuando ya existe el id creado.
 */
export function PublishConfirm({
  eventId,
  eventTitle,
  open,
  onClose,
  onPublished,
  onSkip,
}: Props) {
  const toast = useToast();
  const publish = usePublishEvent(eventId);

  const resetPublish = publish.reset;
  useEffect(() => {
    if (!open) resetPublish();
  }, [open, resetPublish]);

  async function confirm() {
    try {
      const result = await publish.mutateAsync();
      toast.success(
        `Publicado: ${result.totalSeats.toLocaleString('es-MX')} asientos · ${result.sections} secciones`,
      );
      onPublished();
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'No se pudo publicar el evento');
    }
  }

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="Publicar evento"
      description="La publicación genera inventario y abre canales. Confirma solo si el mapa y la oferta están listos."
      dismissible={!publish.isPending}
      footer={
        <>
          <Button
            type="button"
            variant="ghost"
            disabled={publish.isPending}
            onClick={onSkip}
          >
            Dejar en borrador
          </Button>
          <Button type="button" loading={publish.isPending} onClick={() => void confirm()}>
            Publicar ahora
          </Button>
        </>
      }
    >
      <p>
        ¿Publicar <strong>{eventTitle}</strong>? Esta acción crea asientos y deja el evento
        visible según las ventanas de venta configuradas.
      </p>
    </Modal>
  );
}
