'use client';

import { Card, CardHeader } from '@boletera/ui/src/components/Card';
import type { Insight, InsightTone } from '../_lib/insights';
import styles from '../analytics.module.scss';
import { PanelEmpty } from './PanelState';

const TONE_CLASS: Record<InsightTone, string> = {
  positive: styles.tonePositive,
  warning: styles.toneWarning,
  critical: styles.toneCritical,
  neutral: styles.toneNeutral,
};

export function InsightsPanel({ insights }: { insights: readonly Insight[] }) {
  return (
    <Card className={styles.panel} padding="md" variant="outline">
      <CardHeader
        title="Hallazgos"
        description="Lecturas accionables derivadas de los agregados del periodo."
        as="h2"
      />
      {insights.length === 0 ? (
        <PanelEmpty
          title="Sin hallazgos todavía"
          description="Cuando haya suficiente volumen en el periodo, aquí aparecerán tendencias, riesgos y oportunidades."
          hints={[
            'Amplía el rango de fechas',
            'Publica eventos con ventas activas',
          ]}
        />
      ) : (
        <ul className={styles.insightList}>
          {insights.map((insight) => (
            <li
              key={insight.id}
              className={`${styles.insight} ${TONE_CLASS[insight.tone]}`}
            >
              <h3 className={styles.insightTitle}>{insight.title}</h3>
              <p className={styles.insightDetail}>{insight.detail}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}
