'use client';

import {
  Badge,
  Button,
  Drawer,
  EmptyState,
  StatusDot,
  formatCurrency,
  formatDelta,
  formatNumber,
} from '@boletera/ui';
import {
  confidenceLabel,
  confidenceTone,
  contributionTone,
  directionLabel,
  directionTone,
  factorLabel,
} from '../_lib/labels';
import type { OfferRecommendation, PriceHistoryEntry } from '../_lib/types';
import { PriceHistoryPanel } from './PriceHistoryPanel';
import styles from '../pricing.module.scss';

type Props = {
  recommendation: OfferRecommendation | null;
  canWrite: boolean;
  applying: boolean;
  history: readonly PriceHistoryEntry[];
  historyLoading: boolean;
  historyError: Error | null;
  onClose: () => void;
  onApplySafe: (offerId: string) => void;
  onQueueApproval: (offerId: string) => void;
  onRetryHistory: () => void;
};

function deltaClass(direction: OfferRecommendation['direction']): string {
  if (direction === 'increase') return styles.deltaUp;
  if (direction === 'decrease') return styles.deltaDown;
  return styles.deltaHold;
}

/**
 * Detalle de una oferta: precios, factores explicables, guardrails e historial.
 * Las acciones respetan `price:write` y el estado `hold`.
 */
export function RecommendationDetailDrawer({
  recommendation,
  canWrite,
  applying,
  history,
  historyLoading,
  historyError,
  onClose,
  onApplySafe,
  onQueueApproval,
  onRetryHistory,
}: Props) {
  const open = recommendation !== null;
  const actionable = recommendation !== null && recommendation.direction !== 'hold';

  return (
    <Drawer
      open={open}
      onClose={onClose}
      size="lg"
      title={recommendation?.name ?? 'Oferta'}
      description={
        recommendation
          ? `${recommendation.zone} · ${recommendation.offerId}`
          : undefined
      }
      footer={
        <div className={styles.bulkActions}>
          <Button variant="secondary" onClick={onClose}>
            Cerrar
          </Button>
          {recommendation && actionable ? (
            recommendation.requiresApproval ? (
              <Button
                disabled={!canWrite || applying}
                loading={applying}
                title={
                  !canWrite
                    ? 'Necesitas el permiso price:write'
                    : 'Encola la recomendación para firma humana'
                }
                onClick={() => onQueueApproval(recommendation.offerId)}
              >
                Encolar aprobación
              </Button>
            ) : (
              <Button
                disabled={!canWrite || applying}
                loading={applying}
                title={
                  !canWrite
                    ? 'Necesitas el permiso price:write'
                    : 'Aplica el Δ seguro sin firma adicional'
                }
                onClick={() => onApplySafe(recommendation.offerId)}
              >
                Aplicar cambio seguro
              </Button>
            )
          ) : null}
        </div>
      }
    >
      {recommendation ? (
        <div className={styles.drawerStack}>
          <div className={styles.headerActions}>
            <Badge tone={directionTone(recommendation.direction)} variant="outline">
              {directionLabel(recommendation.direction)}
            </Badge>
            <Badge tone={confidenceTone(recommendation.confidence)} variant="soft">
              {confidenceLabel(recommendation.confidence)}
            </Badge>
            {recommendation.requiresApproval ? (
              <Badge tone="warning" variant="soft">
                Requiere aprobación
              </Badge>
            ) : null}
            {recommendation.autoApplicable ? (
              <Badge tone="success" variant="soft">
                Auto-aplicable
              </Badge>
            ) : null}
          </div>

          <dl className={styles.drawerMeta}>
            <div>
              <dt>Precio vigente</dt>
              <dd>{formatCurrency(recommendation.currentPrice)}</dd>
            </div>
            <div>
              <dt>Recomendado</dt>
              <dd>{formatCurrency(recommendation.recommendedPrice)}</dd>
            </div>
            <div>
              <dt>Precio base</dt>
              <dd>{formatCurrency(recommendation.basePrice)}</dd>
            </div>
            <div>
              <dt>Variación</dt>
              <dd className={deltaClass(recommendation.direction)}>
                {formatDelta(recommendation.deltaPercent)}
              </dd>
            </div>
            <div>
              <dt>Multiplicador</dt>
              <dd>×{formatNumber(recommendation.recommendedMultiplier, 3)}</dd>
            </div>
            <div>
              <dt>Banda</dt>
              <dd>
                {recommendation.guardrail.bandLabel}
                {recommendation.guardrail.clamped ? ' · acotado' : ''}
              </dd>
            </div>
          </dl>

          <p className={styles.summaryLine}>{recommendation.explanation}</p>

          {recommendation.guardrail.clamped ? (
            <p className={styles.muted} role="note">
              El candidato era {formatCurrency(recommendation.guardrail.preClampPrice)}; el
              motor lo recortó a [{formatCurrency(recommendation.guardrail.floor)} –{' '}
              {formatCurrency(recommendation.guardrail.ceiling)}].
            </p>
          ) : (
            <p className={styles.muted}>
              Dentro de [{formatCurrency(recommendation.guardrail.floor)} –{' '}
              {formatCurrency(recommendation.guardrail.ceiling)}].
            </p>
          )}

          <section aria-labelledby="pricing-factors-title">
            <div className={styles.cardHead}>
              <h3 id="pricing-factors-title">Factores explicables</h3>
            </div>
            {recommendation.factors.length === 0 ? (
              <EmptyState
                size="sm"
                illustration="inbox"
                title="Sin factores"
                description="El motor no adjuntó contribuciones para esta oferta."
              />
            ) : (
              <ul className={styles.factorList}>
                {recommendation.factors.map((factor) => (
                  <li key={`${factor.code}-${factor.detail}`} className={styles.factor}>
                    <StatusDot tone={contributionTone(factor.contribution)} size="sm" />
                    <div className={styles.factorMeta}>
                      <strong>{factorLabel(factor.code)}</strong>
                      <span>{factor.detail}</span>
                    </div>
                    <span className={styles.factorValue}>
                      ×{formatNumber(factor.contribution, 3)}
                      {factor.threshold !== undefined
                        ? ` · umbral ${formatNumber(factor.threshold, 2)}`
                        : ''}
                    </span>
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section aria-labelledby="pricing-history-title">
            <div className={styles.cardHead}>
              <h3 id="pricing-history-title">Historial de precios</h3>
            </div>
            <PriceHistoryPanel
              entries={history}
              loading={historyLoading}
              error={historyError}
              onRetry={onRetryHistory}
            />
          </section>
        </div>
      ) : null}
    </Drawer>
  );
}
