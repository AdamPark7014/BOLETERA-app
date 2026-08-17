'use client';

import { useMemo } from 'react';
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  formatCurrency,
  formatDelta,
  formatNumber,
  type DataTableColumn,
} from '@boletera/ui';
import {
  PAGE_SIZES,
  type PageSize,
  type Paged,
  isActionable,
  isPageSize,
} from '../_lib/derive';
import {
  confidenceLabel,
  confidenceTone,
  directionLabel,
  directionTone,
} from '../_lib/labels';
import type { OfferRecommendation } from '../_lib/types';
import styles from '../pricing.module.scss';

type Props = {
  page: Paged<OfferRecommendation>;
  pageSize: PageSize;
  loading: boolean;
  canWrite: boolean;
  selectedKeys: readonly string[];
  applying: boolean;
  emptyBecauseFilters: boolean;
  onSelectionChange: (keys: string[]) => void;
  onRowOpen: (offerId: string) => void;
  onPageChange: (page: number) => void;
  onPageSizeChange: (size: PageSize) => void;
  onClearFilters: () => void;
  onApplySelection: (confirmApproval: boolean) => void;
};

/**
 * Tabla paginada de recomendaciones. La selección solo contempla ofertas
 * accionables (`hold` no se puede aplicar).
 */
export function RecommendationsTable({
  page,
  pageSize,
  loading,
  canWrite,
  selectedKeys,
  applying,
  emptyBecauseFilters,
  onSelectionChange,
  onRowOpen,
  onPageChange,
  onPageSizeChange,
  onClearFilters,
  onApplySelection,
}: Props) {
  const columns = useMemo<DataTableColumn<OfferRecommendation>[]>(
    () => [
      {
        key: 'offer',
        header: 'Oferta',
        width: 200,
        sortValue: (row) => row.name,
        render: (row) => (
          <div>
            <strong>{row.name}</strong>
            <p className={styles.muted}>{row.zone}</p>
          </div>
        ),
      },
      {
        key: 'current',
        header: 'Vigente',
        width: 110,
        align: 'right',
        sortValue: (row) => row.currentPrice,
        render: (row) => formatCurrency(row.currentPrice),
      },
      {
        key: 'recommended',
        header: 'Recomendado',
        width: 120,
        align: 'right',
        sortValue: (row) => row.recommendedPrice,
        render: (row) => formatCurrency(row.recommendedPrice),
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
        key: 'confidence',
        header: 'Confianza',
        width: 130,
        sortValue: (row) => row.confidence,
        render: (row) => (
          <Badge tone={confidenceTone(row.confidence)} variant="soft">
            {confidenceLabel(row.confidence)}
          </Badge>
        ),
      },
      {
        key: 'flags',
        header: 'Guardrails',
        width: 160,
        sortValue: (row) =>
          (row.requiresApproval ? 2 : 0) + (row.guardrail.clamped ? 1 : 0),
        render: (row) => (
          <div className={styles.bulkActions}>
            {row.requiresApproval ? (
              <Badge tone="warning" variant="soft">
                Aprobación
              </Badge>
            ) : row.autoApplicable ? (
              <Badge tone="success" variant="soft">
                Seguro
              </Badge>
            ) : (
              <Badge tone="neutral" variant="outline">
                Hold
              </Badge>
            )}
            {row.guardrail.clamped ? (
              <Badge tone="info" variant="outline">
                Acotado
              </Badge>
            ) : null}
          </div>
        ),
      },
      {
        key: 'multiplier',
        header: '×',
        width: 80,
        align: 'right',
        sortValue: (row) => row.recommendedMultiplier,
        render: (row) => formatNumber(row.recommendedMultiplier, 3),
      },
    ],
    [],
  );

  const selectedActionable = selectedKeys.length;

  return (
    <div className={styles.stack}>
      {selectedActionable > 0 ? (
        <div className={styles.bulkBar} role="status">
          <p className={styles.bulkMeta}>
            {formatNumber(selectedActionable)} oferta
            {selectedActionable === 1 ? '' : 's'} seleccionada
            {selectedActionable === 1 ? '' : 's'}
          </p>
          <div className={styles.bulkActions}>
            <Button
              size="sm"
              variant="outline"
              disabled={!canWrite || applying}
              loading={applying}
              title={
                !canWrite
                  ? 'Necesitas el permiso price:write'
                  : 'Aplica solo las que no exigen firma; el resto se encola'
              }
              onClick={() => onApplySelection(false)}
            >
              Aplicar seguras
            </Button>
            <Button
              size="sm"
              disabled={!canWrite || applying}
              loading={applying}
              title={
                !canWrite
                  ? 'Necesitas el permiso price:write'
                  : 'Confirma también las que requieren aprobación humana'
              }
              onClick={() => onApplySelection(true)}
            >
              Aplicar con aprobación
            </Button>
            <Button
              size="sm"
              variant="ghost"
              disabled={applying}
              onClick={() => onSelectionChange([])}
            >
              Limpiar
            </Button>
          </div>
        </div>
      ) : null}

      <DataTable
        label="Recomendaciones de precio por oferta"
        columns={columns}
        data={[...page.rows]}
        rowKey={(row) => row.offerId}
        loading={loading}
        selectable
        selectedKeys={selectedKeys}
        onSelectionChange={(keys) => {
          const actionable = new Set(
            page.rows.filter(isActionable).map((row) => row.offerId),
          );
          onSelectionChange(keys.filter((key) => actionable.has(key)));
        }}
        onRowClick={(row) => onRowOpen(row.offerId)}
        defaultSort={{ key: 'delta', direction: 'desc' }}
        maxHeight={440}
        empty={
          <EmptyState
            illustration={emptyBecauseFilters ? 'search' : 'inbox'}
            title={
              emptyBecauseFilters
                ? 'Ninguna oferta coincide'
                : 'Sin recomendaciones'
            }
            description={
              emptyBecauseFilters
                ? 'Prueba otra búsqueda o quita el filtro de dirección / aprobación / banda.'
                : 'El motor no devolvió ofertas para este evento. Verifica que existan zonas publicadas.'
            }
            action={
              emptyBecauseFilters ? (
                <Button size="sm" variant="outline" onClick={onClearFilters}>
                  Quitar filtros
                </Button>
              ) : undefined
            }
          />
        }
      />

      {page.total > 0 ? (
        <div className={styles.pager}>
          <p className={styles.pagerMeta}>
            {formatNumber(page.from)}–{formatNumber(page.to)} de{' '}
            {formatNumber(page.total)} ofertas
          </p>
          <div className={styles.pagerControls}>
            <label>
              <span className={styles.muted}>Por página</span>{' '}
              <select
                className={styles.sizeSelect}
                value={pageSize}
                aria-label="Ofertas por página"
                onChange={(event) => {
                  const next = Number(event.target.value);
                  if (isPageSize(next)) onPageSizeChange(next);
                }}
              >
                {PAGE_SIZES.map((size) => (
                  <option key={size} value={size}>
                    {size}
                  </option>
                ))}
              </select>
            </label>
            <Button
              size="sm"
              variant="outline"
              disabled={page.page <= 1}
              onClick={() => onPageChange(page.page - 1)}
            >
              Anterior
            </Button>
            <span className={styles.pagerMeta}>
              Página {formatNumber(page.page)} / {formatNumber(page.pageCount)}
            </span>
            <Button
              size="sm"
              variant="outline"
              disabled={page.page >= page.pageCount}
              onClick={() => onPageChange(page.page + 1)}
            >
              Siguiente
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
