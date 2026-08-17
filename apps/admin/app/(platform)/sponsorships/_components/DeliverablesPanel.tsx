'use client';

import { Badge, EmptyState } from '@boletera/ui';
import type {
  SponsorshipComplianceIssue,
  SponsorshipComplianceSummary,
} from '@/lib/queries/sponsorships';
import { formatCount, formatRatio } from '../_lib/money';
import { PanelState } from './PanelState';
import styles from '../sponsorships.module.scss';

type DeliverablesPanelProps = {
  summary: SponsorshipComplianceSummary | undefined;
  issues: readonly SponsorshipComplianceIssue[] | undefined;
  isPending: boolean;
  error: unknown;
  onRetry?: () => void;
};

function severityTone(
  severity: string,
): 'info' | 'warning' | 'danger' | 'neutral' {
  switch (severity.toLowerCase()) {
    case 'danger':
    case 'critical':
      return 'danger';
    case 'warning':
      return 'warning';
    case 'info':
      return 'info';
    default:
      return 'neutral';
  }
}

export function DeliverablesPanel({
  summary,
  issues,
  isPending,
  error,
  onRetry,
}: DeliverablesPanelProps) {
  const data =
    summary || issues
      ? { summary: summary ?? null, issues: issues ?? [] }
      : undefined;

  return (
    <aside className={styles.card} aria-label="Entregables y cumplimiento">
      <div className={styles.cardHead}>
        <div>
          <h2>Entregables</h2>
          <p>Cumplimiento y evidencias pendientes</p>
        </div>
      </div>

      <PanelState
        data={data}
        isPending={isPending}
        error={error}
        onRetry={onRetry}
        isEmpty={(value) =>
          !value.summary && value.issues.length === 0
        }
        emptyTitle="Sin cumplimiento"
        emptyDescription="El resumen aparece con GET …/compliance/summary."
      >
        {(value) => (
          <>
            {value.summary ? (
              <div className={styles.complianceStrip}>
                <div>
                  <strong>{formatRatio(value.summary.onTrackRate)}</strong>
                  <small>al día</small>
                </div>
                <div>
                  <strong>{formatCount(value.summary.completedDeliverables)}</strong>
                  <small>cumplidos</small>
                </div>
                <div>
                  <strong>{formatCount(value.summary.overdueDeliverables)}</strong>
                  <small>vencidos</small>
                </div>
                <div>
                  <strong>{formatCount(value.summary.openIssues)}</strong>
                  <small>issues</small>
                </div>
              </div>
            ) : (
              <EmptyState
                title="Sin resumen"
                description="Solo hay issues sueltos."
                illustration="inbox"
                size="sm"
              />
            )}
            {value.issues.length > 0 ? (
              <ul className={styles.sideList}>
                {value.issues.slice(0, 6).map((issue) => (
                  <li key={issue.id}>
                    <div>
                      <strong>{issue.title}</strong>
                      <small>
                        {issue.packageName ?? 'Sin paquete'}
                        {issue.dueAt
                          ? ` · vence ${new Date(issue.dueAt).toLocaleDateString('es-MX')}`
                          : ''}
                      </small>
                    </div>
                    <Badge
                      tone={severityTone(issue.severity)}
                      variant="soft"
                      size="sm"
                      dot
                    >
                      {issue.severity}
                    </Badge>
                  </li>
                ))}
              </ul>
            ) : null}
          </>
        )}
      </PanelState>
    </aside>
  );
}
