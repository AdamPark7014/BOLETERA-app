'use client';

import { BarChart, EmptyState } from '@boletera/ui';
import type { SponsorshipPackage } from '@/lib/queries/sponsorships';
import { formatRatioPrecise } from '../_lib/money';
import { hasRoiData, packageRoi } from '../_lib/packages';
import styles from '../sponsorships.module.scss';

type RoiPanelProps = {
  packages: readonly SponsorshipPackage[];
  loading: boolean;
};

export function RoiPanel({ packages, loading }: RoiPanelProps) {
  const withRoi = packages
    .map((pkg) => ({
      id: pkg.id,
      label: pkg.sponsorName ?? pkg.name,
      roi: packageRoi(pkg),
    }))
    .filter((row): row is { id: string; label: string; roi: number } => row.roi !== null)
    .sort((a, b) => b.roi - a.roi)
    .slice(0, 8);

  return (
    <aside className={styles.card} aria-label="ROI de patrocinios">
      <div className={styles.cardHead}>
        <div>
          <h2>ROI</h2>
          <p>Solo si el contrato trae estimatedRoi o actualRoi</p>
        </div>
      </div>

      {loading ? (
        <p className={styles.muted} role="status">
          Evaluando ROI…
        </p>
      ) : !hasRoiData(packages) ? (
        <EmptyState
          title="Sin datos de ROI"
          description="Cuando los paquetes incluyan ROI estimado o real, se mostrará aquí. No se inventan múltiplos."
          illustration="chart"
          size="sm"
          hints={['actualRoi / estimatedRoi en el paquete']}
        />
      ) : (
        <BarChart
          label="ROI por paquete"
          height={180}
          series={[
            {
              id: 'roi',
              name: 'ROI %',
              data: withRoi.map((row) => ({
                label: row.label,
                value: Math.round(row.roi * 100),
              })),
            },
          ]}
          formatValue={(value) => formatRatioPrecise(value / 100)}
          formatAxis={(value) => `${Math.round(value)}%`}
        />
      )}
    </aside>
  );
}
