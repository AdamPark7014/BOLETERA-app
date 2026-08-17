'use client';

import { memo } from 'react';
import { priceHeatColor, SEAT_STATUS_COLORS, sightlineHeatColor } from '@boletera/venue-engine';
import { useEditor } from '../store/store-context';
import styles from '../VenueBuilder.module.scss';

type LegendRow = { color: string; label: string };

const TIER_PALETTE = ['#5b9fd4', '#d4a017', '#22c55e', '#a855f7', '#f97316', '#14b8a6'];

export const Legend = memo(function Legend() {
  const colorMode = useEditor((state) => state.colorMode);
  const sections = useEditor((state) => state.scene.sections);
  const sightlineSummary = useEditor((state) => state.validation?.sightlineSummary ?? null);

  let rows: LegendRow[] = [];
  let caption = '';

  if (colorMode === 'zone') {
    caption = 'Un color por zona autorizada';
    rows = sections.slice(0, 12).map((section) => ({ color: section.color, label: section.name }));
  } else if (colorMode === 'tier') {
    caption = 'Paleta por tier de precio';
    const tiers = new Set<string>();
    for (const section of sections) {
      for (const seat of section.seats) tiers.add(seat.tier ?? 'default');
    }
    rows = [...tiers].slice(0, 8).map((tier, i) => ({
      color: TIER_PALETTE[i % TIER_PALETTE.length],
      label: tier,
    }));
  } else if (colorMode === 'price') {
    caption = 'Mapa de calor de precio (bajo → alto)';
    rows = [0, 0.5, 1].map((t) => ({
      color: priceHeatColor(t, 0, 1),
      label: t === 0 ? 'Mínimo' : t === 1 ? 'Máximo' : 'Medio',
    }));
  } else if (colorMode === 'status') {
    caption = 'Inventario en vivo';
    rows = [
      { color: SEAT_STATUS_COLORS.available, label: 'Disponible' },
      { color: SEAT_STATUS_COLORS.held, label: 'Apartado' },
      { color: SEAT_STATUS_COLORS.sold, label: 'Vendido' },
      { color: SEAT_STATUS_COLORS.selected, label: 'Seleccionado' },
      { color: SEAT_STATUS_COLORS.dimmed, label: 'Atenuado' },
    ];
  } else {
    caption = sightlineSummary
      ? 'Calidad de visión calculada'
      : 'Ejecuta el análisis para obtener puntajes de visión';
    rows = [1, 0.72, 0.5, 0.28, 0].map((score, i) => ({
      color: sightlineHeatColor(score),
      label: ['Premium', 'Buena', 'Regular', 'Restringida', 'Bloqueada'][i],
    }));
  }

  return (
    <div className={styles.legend}>
      <p className={styles.emptyHint}>{caption}</p>
      <ul className={styles.legendList}>
        {rows.map((row) => (
          <li key={`${row.label}-${row.color}`} className={styles.legendItem}>
            <span className={styles.legendSwatch} style={{ background: row.color }} />
            {row.label}
          </li>
        ))}
      </ul>
    </div>
  );
});
