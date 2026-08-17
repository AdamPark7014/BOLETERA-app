'use client';

import type { SightlineResult, SightlineScore } from '@boletera/venue-engine';
import { GRADE_LABELS } from '../types';
import type { StudioSeat } from '../types';
import styles from '../Venue3DStudio.module.scss';

type SeatInspectorPanelProps = {
  seat: StudioSeat | null;
  sightline: SightlineScore | null;
  summary: SightlineResult['summary'] | null;
  currency?: string;
};

function gradeClass(grade: SightlineScore['grade']): string {
  switch (grade) {
    case 'premium':
      return styles.gradePremium;
    case 'good':
      return styles.gradeGood;
    case 'fair':
      return styles.gradeFair;
    case 'restricted':
      return styles.gradeRestricted;
    case 'blocked':
      return styles.gradeBlocked;
    default:
      return '';
  }
}

export function SeatInspectorPanel({
  seat,
  sightline,
  summary,
  currency = 'MXN',
}: SeatInspectorPanelProps) {
  return (
    <section className={styles.panel} aria-labelledby="studio-seat-title">
      <h2 id="studio-seat-title" className={styles.panelTitle}>
        Visibilidad del asiento
      </h2>
      <div className={styles.panelBody}>
        {!seat ? (
          <p className={styles.hint}>
            Selecciona un asiento en el recinto para simular la perspectiva real y consultar la
            calidad de visión calculada.
          </p>
        ) : (
          <>
            <dl className={styles.inspectorList} aria-live="polite">
              <div>
                <dt>Asiento</dt>
                <dd>{seat.label || seat.id}</dd>
              </div>
              <div>
                <dt>Zona</dt>
                <dd>{seat.section || '—'}</dd>
              </div>
              <div>
                <dt>Fila</dt>
                <dd>{seat.row || '—'}</dd>
              </div>
              {typeof seat.price === 'number' && seat.price > 0 && (
                <div>
                  <dt>Precio</dt>
                  <dd>
                    ${seat.price.toLocaleString('es-MX', { maximumFractionDigits: 0 })} {currency}
                  </dd>
                </div>
              )}
              {sightline && (
                <>
                  <div>
                    <dt>Calidad de visión</dt>
                    <dd className={gradeClass(sightline.grade)}>
                      {GRADE_LABELS[sightline.grade]} ({Math.round(sightline.score * 100)}%)
                    </dd>
                  </div>
                  <div>
                    <dt>Distancia al foco</dt>
                    <dd>{sightline.distance.toFixed(1)} u</dd>
                  </div>
                  <div>
                    <dt>Orientación</dt>
                    <dd>{(sightline.facingDot * 100).toFixed(0)}% hacia el escenario</dd>
                  </div>
                  <div>
                    <dt>Obstrucciones</dt>
                    <dd>
                      {sightline.occluded || sightline.rowBlocked
                        ? [
                            sightline.occluded ? 'obstáculo' : null,
                            sightline.rowBlocked ? 'fila frontal' : null,
                          ]
                            .filter(Boolean)
                            .join(' · ')
                        : 'Sin obstrucción detectada'}
                    </dd>
                  </div>
                  {typeof sightline.cValue === 'number' && (
                    <div>
                      <dt>Valor C</dt>
                      <dd>{sightline.cValue.toFixed(1)}</dd>
                    </div>
                  )}
                </>
              )}
            </dl>
            <p className={styles.hint}>
              Activa la cámara «Desde el asiento» (V) para ver la perspectiva del comprador.
            </p>
          </>
        )}

        {summary && (
          <>
            <div className={styles.legendScale} aria-hidden>
              <span>Mala</span>
              <div className={styles.sightScale} />
              <span>Buena</span>
            </div>
            <div className={styles.summaryGrid} aria-label="Resumen de visibilidad del recinto">
              {(Object.keys(GRADE_LABELS) as Array<keyof typeof GRADE_LABELS>).map((grade) => (
                <div key={grade}>
                  <span>{GRADE_LABELS[grade]}</span>{' '}
                  <strong>{summary[grade]}</strong>
                </div>
              ))}
            </div>
          </>
        )}
      </div>
    </section>
  );
}
