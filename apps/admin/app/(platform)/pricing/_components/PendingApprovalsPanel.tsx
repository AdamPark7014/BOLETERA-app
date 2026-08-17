'use client';

import { useMemo, useState } from 'react';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  Modal,
  formatCurrency,
  formatDateTime,
  formatDelta,
  type DataTableColumn,
} from '@boletera/ui';
import { directionLabel, directionTone } from '../_lib/labels';
import type { PendingRow } from '../_lib/derive';
import styles from '../pricing.module.scss';

type Props = {
  rows: readonly PendingRow[];
  loading: boolean;
  canWrite: boolean;
  reviewingId: string | null;
  emptyBecauseFilters: boolean;
  onClearFilters: () => void;
  onApprove: (recommendationId: string, note: string) => void;
  onReject: (recommendationId: string, note: string) => void;
};

type ReviewMode = 'approve' | 'reject';

/**
 * Cola humana de DynamicPrice con prefijo pending_approval. Las filas de más
 * de 24 h se marcan expiradas: la API las rechazará, así que no ofrecemos el
 * botón de aprobar.
 */
export function PendingApprovalsPanel({
  rows,
  loading,
  canWrite,
  reviewingId,
  emptyBecauseFilters,
  onClearFilters,
  onApprove,
  onReject,
}: Props) {
  const [target, setTarget] = useState<PendingRow | null>(null);
  const [mode, setMode] = useState<ReviewMode>('approve');
  const [note, setNote] = useState('');

  const columns = useMemo<DataTableColumn<PendingRow>[]>(
    () => [
      {
        key: 'offer',
        header: 'Oferta',
        width: 200,
        sortValue: (row) => row.offerName,
        render: (row) => (
          <div>
            <strong>{row.offerName}</strong>
            <p className={styles.muted}>{row.zone}</p>
          </div>
        ),
      },
      {
        key: 'from',
        header: 'De',
        width: 110,
        align: 'right',
        sortValue: (row) => row.currentPrice,
        render: (row) => formatCurrency(row.currentPrice),
      },
      {
        key: 'to',
        header: 'A',
        width: 110,
        align: 'right',
        sortValue: (row) => row.adjustedPrice,
        render: (row) => formatCurrency(row.adjustedPrice),
      },
      {
        key: 'delta',
        header: 'Δ',
        width: 90,
        align: 'right',
        sortValue: (row) => row.deltaPercent,
        render: (row) => (
          <span
            className={
              row.direction === 'increase'
                ? styles.deltaUp
                : row.direction === 'decrease'
                  ? styles.deltaDown
                  : styles.deltaHold
            }
          >
            {formatDelta(row.deltaPercent)}
          </span>
        ),
      },
      {
        key: 'direction',
        header: 'Dirección',
        width: 110,
        sortValue: (row) => row.direction,
        render: (row) => (
          <Badge tone={directionTone(row.direction)} variant="outline">
            {directionLabel(row.direction)}
          </Badge>
        ),
      },
      {
        key: 'created',
        header: 'Creada',
        width: 150,
        sortValue: (row) => new Date(row.createdAt).getTime(),
        render: (row) => formatDateTime(row.createdAt),
      },
      {
        key: 'expires',
        header: 'Vence',
        width: 150,
        sortValue: (row) => row.expiresAt,
        render: (row) =>
          row.expired ? (
            <Badge tone="danger" variant="soft">
              Expirada
            </Badge>
          ) : (
            formatDateTime(row.expiresAt)
          ),
      },
      {
        key: 'actions',
        header: 'Revisión',
        width: 180,
        resizable: false,
        render: (row) => (
          <div className={styles.bulkActions}>
            <Button
              size="sm"
              disabled={!canWrite || row.expired || reviewingId === row.id}
              loading={reviewingId === row.id}
              title={
                !canWrite
                  ? 'Necesitas el permiso price:write'
                  : row.expired
                    ? 'Genera un paquete nuevo; esta recomendación expiró'
                    : undefined
              }
              onClick={() => {
                setMode('approve');
                setNote('');
                setTarget(row);
              }}
            >
              Aprobar
            </Button>
            <Button
              size="sm"
              variant="danger"
              disabled={!canWrite || reviewingId === row.id}
              title={!canWrite ? 'Necesitas el permiso price:write' : undefined}
              onClick={() => {
                setMode('reject');
                setNote('');
                setTarget(row);
              }}
            >
              Rechazar
            </Button>
          </div>
        ),
      },
    ],
    [canWrite, reviewingId],
  );

  return (
    <>
      <DataTable
        label="Recomendaciones pendientes de aprobación"
        columns={columns}
        data={[...rows]}
        rowKey={(row) => row.id}
        loading={loading}
        defaultSort={{ key: 'created', direction: 'desc' }}
        maxHeight={420}
        empty={
          <EmptyState
            illustration={emptyBecauseFilters ? 'search' : 'success'}
            tone={emptyBecauseFilters ? 'accent' : 'success'}
            title={emptyBecauseFilters ? 'Ninguna coincidencia' : 'Cola vacía'}
            description={
              emptyBecauseFilters
                ? 'Ninguna recomendación pendiente coincide con la búsqueda.'
                : 'No hay recomendaciones en espera de firma humana para este evento. Las que exceden el tope automático aparecerán aquí al aplicarlas.'
            }
            action={
              emptyBecauseFilters ? (
                <Button size="sm" variant="outline" onClick={onClearFilters}>
                  Limpiar búsqueda
                </Button>
              ) : undefined
            }
          />
        }
      />

      <Modal
        open={target !== null}
        onClose={() => setTarget(null)}
        title={mode === 'approve' ? 'Aprobar recomendación' : 'Rechazar recomendación'}
        description={
          target
            ? `${target.offerName} · ${formatCurrency(target.currentPrice)} → ${formatCurrency(target.adjustedPrice)}`
            : undefined
        }
        footer={
          <div className={styles.bulkActions}>
            <Button variant="secondary" onClick={() => setTarget(null)}>
              Cancelar
            </Button>
            <Button
              variant={mode === 'reject' ? 'danger' : 'primary'}
              disabled={!canWrite || (target?.expired === true && mode === 'approve')}
              loading={target !== null && reviewingId === target.id}
              onClick={() => {
                if (!target) return;
                if (mode === 'approve') onApprove(target.id, note);
                else onReject(target.id, note);
                setTarget(null);
                setNote('');
              }}
            >
              {mode === 'approve' ? 'Confirmar aprobación' : 'Confirmar rechazo'}
            </Button>
          </div>
        }
      >
        {target ? (
          <div className={styles.drawerStack}>
            <p className={styles.summaryLine}>
              {target.payload?.explanation ??
                'Sin explicación embebida; revisa el paquete vigente de recomendaciones.'}
            </p>
            <div className={styles.noteField}>
              <label htmlFor="pricing-review-note">
                {mode === 'approve'
                  ? 'Nota de aprobación (opcional)'
                  : 'Motivo del rechazo (opcional)'}
              </label>
              <textarea
                id="pricing-review-note"
                value={note}
                maxLength={500}
                onChange={(event) => setNote(event.target.value)}
                placeholder={
                  mode === 'approve'
                    ? 'Queda registrado en la bitácora de auditoría.'
                    : 'Explica por qué no se aplica el cambio.'
                }
              />
            </div>
          </div>
        ) : null}
      </Modal>
    </>
  );
}
