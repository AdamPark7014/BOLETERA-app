'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge, Button, Modal } from '@boletera/ui';
import type { LayoutPublishStatusValue } from '@boletera/shared';
import {
  archiveVenueLayout,
  getVenueLayoutWorkflow,
  publishVenueLayout,
  revertVenueLayoutDraft,
  rollbackVenueLayout,
  submitVenueLayoutReview,
  type VenueLayoutWorkflow,
} from '@/lib/platform-api';

const STATUS_LABEL: Record<LayoutPublishStatusValue, string> = {
  DRAFT: 'Borrador',
  IN_REVIEW: 'En revisión',
  PUBLISHED: 'Publicado',
  ARCHIVED: 'Archivado',
};

const STATUS_TONE: Record<
  LayoutPublishStatusValue,
  'neutral' | 'info' | 'success' | 'warning'
> = {
  DRAFT: 'neutral',
  IN_REVIEW: 'info',
  PUBLISHED: 'success',
  ARCHIVED: 'warning',
};

type Props = {
  venueId: string;
  token: string;
  /** Bloquea «Publicar mapa» si el editor reporta errores de validación. */
  validationOk?: boolean;
  validationErrorCount?: number;
  onWorkflowChange?: (workflow: VenueLayoutWorkflow) => void;
  onMapReload?: () => void;
};

export function LayoutPublishPanel({
  venueId,
  token,
  validationOk = true,
  validationErrorCount = 0,
  onWorkflowChange,
  onMapReload,
}: Props) {
  const [workflow, setWorkflow] = useState<VenueLayoutWorkflow | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [historyOpen, setHistoryOpen] = useState(false);

  const refresh = useCallback(async () => {
    setError(null);
    try {
      const data = await getVenueLayoutWorkflow(token, venueId);
      setWorkflow(data);
      onWorkflowChange?.(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo cargar el estado del mapa');
    } finally {
      setLoading(false);
    }
  }, [token, venueId, onWorkflowChange]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  async function runAction(
    key: string,
    fn: () => Promise<VenueLayoutWorkflow>,
    reloadMap = false,
  ) {
    setBusy(key);
    setError(null);
    try {
      const data = await fn();
      setWorkflow(data);
      onWorkflowChange?.(data);
      if (reloadMap) onMapReload?.();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Error en la operación');
    } finally {
      setBusy(null);
    }
  }

  if (loading && !workflow) {
    return <p style={{ fontSize: '0.875rem', opacity: 0.7 }}>Cargando estado del mapa…</p>;
  }

  if (!workflow) {
    return error ? (
      <p style={{ fontSize: '0.875rem', color: 'var(--bl-danger, #b91c1c)' }}>{error}</p>
    ) : null;
  }

  const status = workflow.publishStatus;

  return (
    <div
      style={{
        display: 'flex',
        flexWrap: 'wrap',
        gap: '0.5rem',
        alignItems: 'center',
        marginBottom: '0.75rem',
      }}
    >
      <Badge tone={STATUS_TONE[status]}>{STATUS_LABEL[status]}</Badge>
      <span style={{ fontSize: '0.8125rem', opacity: 0.85 }}>
        v{workflow.version}
        {workflow.salesLocked && (
          <>
            {' · '}
            <strong>Bloqueado por ventas</strong> ({workflow.soldTicketCount.toLocaleString('es-MX')}{' '}
            boleto(s))
          </>
        )}
      </span>

      {status === 'DRAFT' && (
        <Button
          type="button"
          size="sm"
          loading={busy === 'review'}
          onClick={() =>
            void runAction('review', () => submitVenueLayoutReview(token, venueId))
          }
        >
          Enviar a revisión
        </Button>
      )}

      {status === 'IN_REVIEW' && (
        <>
          <Button
            type="button"
            size="sm"
            loading={busy === 'publish'}
            disabled={!validationOk}
            title={
              validationOk
                ? undefined
                : `${validationErrorCount} error(es) en el mapa — corrígelos en el panel Validación`
            }
            onClick={() => {
              if (!validationOk) {
                setError(
                  `No se puede publicar: ${validationErrorCount} error(es) pendientes en el mapa.`,
                );
                return;
              }
              void runAction('publish', () => publishVenueLayout(token, venueId));
            }}
          >
            Publicar mapa
          </Button>
          <Button
            type="button"
            size="sm"
            variant="ghost"
            loading={busy === 'draft'}
            onClick={() =>
              void runAction('draft', () => revertVenueLayoutDraft(token, venueId))
            }
          >
            Volver a borrador
          </Button>
        </>
      )}

      {status === 'PUBLISHED' && !workflow.salesLocked && (
        <Button
          type="button"
          size="sm"
          variant="ghost"
          loading={busy === 'archive'}
          onClick={() =>
            void runAction('archive', () => archiveVenueLayout(token, venueId))
          }
        >
          Archivar
        </Button>
      )}

      <Button type="button" size="sm" variant="ghost" onClick={() => setHistoryOpen(true)}>
        Historial ({workflow.snapshots.length})
      </Button>

      {error && (
        <span style={{ fontSize: '0.8125rem', color: 'var(--bl-danger, #b91c1c)', width: '100%' }}>
          {error}
        </span>
      )}

      <Modal
        open={historyOpen}
        onClose={() => setHistoryOpen(false)}
        title="Historial de versiones"
        description="Snapshots inmutables creados al publicar o antes de un rollback."
        footer={
          <Button type="button" variant="ghost" onClick={() => setHistoryOpen(false)}>
            Cerrar
          </Button>
        }
      >
        {workflow.snapshots.length === 0 ? (
          <p>No hay snapshots todavía. Publica el mapa para crear el primero.</p>
        ) : (
          <ul style={{ listStyle: 'none', padding: 0, margin: 0 }}>
            {workflow.snapshots.map((snap) => (
              <li
                key={snap.id}
                style={{
                  display: 'flex',
                  justifyContent: 'space-between',
                  alignItems: 'center',
                  gap: '0.75rem',
                  padding: '0.5rem 0',
                  borderBottom: '1px solid var(--bl-border, #e5e5e5)',
                }}
              >
                <div>
                  <strong>v{snap.version}</strong>
                  {snap.label ? ` — ${snap.label}` : ''}
                  <div style={{ fontSize: '0.75rem', opacity: 0.75 }}>
                    {STATUS_LABEL[snap.publishStatus]} ·{' '}
                    {new Date(snap.createdAt).toLocaleString('es-MX')}
                  </div>
                </div>
                <Button
                  type="button"
                  size="sm"
                  variant="ghost"
                  disabled={workflow.salesLocked || busy === snap.id}
                  loading={busy === snap.id}
                  title={
                    workflow.salesLocked
                      ? 'Rollback bloqueado: hay ventas vinculadas'
                      : 'Restaurar esta versión'
                  }
                  onClick={() =>
                    void runAction(
                      snap.id,
                      () => rollbackVenueLayout(token, venueId, snap.id),
                      true,
                    )
                  }
                >
                  Restaurar
                </Button>
              </li>
            ))}
          </ul>
        )}
      </Modal>
    </div>
  );
}
