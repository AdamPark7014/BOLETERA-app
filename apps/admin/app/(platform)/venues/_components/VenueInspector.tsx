'use client';

import Link from 'next/link';
import {
  Badge,
  Button,
  EmptyState,
  Skeleton,
  formatNumber,
} from '@boletera/ui';
import { QueryError } from '@/components/QueryStates';
import { useVenueEgress, useVenueLayout } from '@/lib/queries/venues';
import {
  countSeatMapSeats,
  formatClearance,
  formatRelativeDate,
  HEALTH_LABEL,
  healthTone,
} from '../_lib/format';
import type { VenuePortfolioRow } from '../_lib/types';
import styles from '../venues.module.scss';

type VenueInspectorProps = {
  row: VenuePortfolioRow | null;
  onClose: () => void;
};

export function VenueInspector({ row, onClose }: VenueInspectorProps) {
  const venueId = row?.id ?? '';
  const layoutQuery = useVenueLayout(venueId);
  const egressQuery = useVenueEgress(venueId);

  if (!row) {
    return (
      <aside className={styles.inspector} aria-label="Detalle del venue">
        <EmptyState
          size="sm"
          title="Selecciona un venue"
          description="Elige una fila o tarjeta para revisar aforo, mapa asociado y salud de configuración."
        />
      </aside>
    );
  }

  const mapData = layoutQuery.data?.layout.mapData;
  const seatCount = mapData ? countSeatMapSeats(mapData.sections) : null;
  const sectionCount = mapData?.sections.length ?? null;
  const egressSummary = egressQuery.data?.report.summary;
  const egressBusy = egressQuery.isPending;
  const layoutBusy = layoutQuery.isPending;

  return (
    <aside className={styles.inspector} aria-label={`Detalle de ${row.name}`}>
      <div className={styles.inspectorHead}>
        <div>
          <p className={styles.eyebrow}>Inspección</p>
          <h2>{row.name}</h2>
          <p className={styles.muted}>
            {row.city} · <code>{row.slug}</code>
          </p>
        </div>
        <Button type="button" variant="ghost" size="sm" onClick={onClose} aria-label="Cerrar detalle">
          Cerrar
        </Button>
      </div>

      <div className={styles.inspectorBadges}>
        <Badge tone={healthTone(row.health)} variant="soft" size="sm" dot>
          {row.health ? HEALTH_LABEL[row.health] : 'Sin análisis'}
        </Badge>
        <Badge tone={row.hasActiveMap ? 'accent' : 'neutral'} variant="outline" size="sm">
          {row.hasActiveMap
            ? `${formatNumber(row.mapCount)} mapa${row.mapCount === 1 ? '' : 's'}`
            : 'Sin mapa activo'}
        </Badge>
      </div>

      {row.healthReason ? <p className={styles.reason}>{row.healthReason}</p> : null}

      <dl className={styles.metaGrid}>
        <div>
          <dt>Aforo declarado</dt>
          <dd>{formatNumber(row.capacity)}</dd>
        </div>
        <div>
          <dt>Eventos ligados</dt>
          <dd>{formatNumber(row.events)}</dd>
        </div>
        <div>
          <dt>Versión de layout</dt>
          <dd>{row.layoutVersion != null ? `v${row.layoutVersion}` : '—'}</dd>
        </div>
        <div>
          <dt>Última actualización</dt>
          <dd>{formatRelativeDate(row.layoutUpdatedAt)}</dd>
        </div>
      </dl>

      <section className={styles.inspectorSection} aria-labelledby="layout-detail-title">
        <h3 id="layout-detail-title">Mapa asociado</h3>
        {layoutBusy ? (
          <div className={styles.skeletonStack} aria-busy="true">
            <Skeleton shape="text" width="70%" />
            <Skeleton shape="text" width="48%" delay={70} />
          </div>
        ) : layoutQuery.error ? (
          <QueryError error={layoutQuery.error} onRetry={() => void layoutQuery.refetch()} />
        ) : !mapData || !sectionCount ? (
          <p className={styles.muted}>
            No hay secciones en el layout activo. Ábrelo en el constructor para configurarlo.
          </p>
        ) : (
          <ul className={styles.statList}>
            <li>
              <span>Secciones</span>
              <strong>{formatNumber(sectionCount)}</strong>
            </li>
            <li>
              <span>Asientos en mapa</span>
              <strong>{seatCount != null ? formatNumber(seatCount) : '—'}</strong>
            </li>
            <li>
              <span>Viewport</span>
              <strong>
                {mapData.viewport
                  ? `${mapData.viewport.width}×${mapData.viewport.height}`
                  : '—'}
              </strong>
            </li>
          </ul>
        )}
      </section>

      <section className={styles.inspectorSection} aria-labelledby="egress-detail-title">
        <h3 id="egress-detail-title">Salud de configuración</h3>
        {egressBusy ? (
          <div className={styles.skeletonStack} aria-busy="true">
            <Skeleton shape="text" width="64%" />
            <Skeleton shape="text" width="52%" delay={70} />
          </div>
        ) : egressQuery.error ? (
          <p className={styles.muted}>
            El reporte de egress no está disponible para este venue (puede faltar red o layout).
          </p>
        ) : !egressSummary ? (
          <p className={styles.muted}>Sin reporte de circulación todavía.</p>
        ) : (
          <ul className={styles.statList}>
            <li>
              <span>Secciones analizadas</span>
              <strong>{formatNumber(egressSummary.sections)}</strong>
            </li>
            <li>
              <span>Sin acceso</span>
              <strong>{formatNumber(egressSummary.unreachable)}</strong>
            </li>
            <li>
              <span>Asientos con ruta</span>
              <strong>{formatNumber(egressSummary.seatsWithPath)}</strong>
            </li>
            <li>
              <span>Vaciado estimado</span>
              <strong>{formatClearance(egressSummary.clearanceMinutes)}</strong>
            </li>
          </ul>
        )}
      </section>

      <p className={styles.occupancyNote}>
        Ocupación histórica: no hay serie temporal disponible en los endpoints actuales del portafolio.
      </p>

      <div className={styles.inspectorActions}>
        <Link href={`/venues/${row.id}/map`} className={styles.primaryLink}>
          Abrir layout
        </Link>
        <Link href={`/venues/${row.id}/3d`} className={styles.secondaryLink}>
          Vista 3D
        </Link>
        <Link href="/reports/egress" className={styles.secondaryLink}>
          Egress org.
        </Link>
      </div>
    </aside>
  );
}
