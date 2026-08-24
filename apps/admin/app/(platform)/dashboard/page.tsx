'use client';

import { useMemo, useState } from 'react';
import { useSession } from '@/components/Session/SessionProvider';
import { buildDashboardRange, type DashboardRangeKey } from './range';
import { useDashboardData } from './_lib/use-dashboard-data';
import type { DashboardMetric } from './_lib/derive';
import { DashboardHeader } from './_components/DashboardHeader';
import { KpiStrip } from './_components/KpiStrip';
import { SeriesPanel } from './_components/SeriesPanel';
import { ChannelsPanel } from './_components/ChannelsPanel';
import { PacePanel } from './_components/PacePanel';
import { AlertsPanel } from './_components/AlertsPanel';
import { ActivityPanel } from './_components/ActivityPanel';
import { ProjectionStrip } from './_components/ProjectionStrip';
import { ErrorBanner } from './_components/ErrorBanner';
import styles from './dashboard.module.scss';

export default function DashboardPage() {
  const { can } = useSession();
  const [rangeKey, setRangeKey] = useState<DashboardRangeKey>('7d');
  const [metric, setMetric] = useState<DashboardMetric>('revenue');
  const range = useMemo(() => buildDashboardRange(rangeKey), [rangeKey]);

  const data = useDashboardData(range, metric);

  if (!can('dashboard.view')) {
    return (
      <div className={styles.wrap}>
        <section className={styles.denied}>
          <h1>Sin acceso al panel</h1>
          <p>Tu rol no incluye permiso para ver el dashboard operativo.</p>
        </section>
      </div>
    );
  }

  return (
    <div className={styles.wrap}>
      <DashboardHeader
        range={range}
        onRangeChange={setRangeKey}
        generatedAt={data.generatedAt}
        isRefreshing={data.isRefreshing}
        onRefresh={data.refetchAll}
      />

      {data.failures.length > 0 ? (
        <ErrorBanner failures={data.failures} onRetry={data.refetchAll} />
      ) : null}

      <KpiStrip
        kpis={data.executive.data?.kpis}
        trends={data.trends}
        comparisonLabel={range.comparisonLabel}
        loading={data.executive.isPending}
      />

      <ProjectionStrip projection={data.executive.data?.projection} />

      <div className={styles.mainGrid}>
        <SeriesPanel
          range={range}
          metric={metric}
          onMetricChange={setMetric}
          current={data.chartData}
          previous={data.comparisonData}
          stats={data.stats}
          comparisonStats={data.comparisonStats}
          loading={data.chartQuery.isPending}
          error={data.chartQuery.error}
          onRetry={() => void data.chartQuery.refetch()}
        />

        <div className={styles.sideStack}>
          {can('marketing.manage') ? (
            <ChannelsPanel
              breakdown={data.executive.data?.revenueByChannel}
              loading={data.executive.isPending}
              error={data.executive.error}
              onRetry={() => void data.executive.refetch()}
            />
          ) : null}
          <AlertsPanel
            data={data.alerts.data}
            loading={data.alerts.isPending}
            error={data.alerts.error}
            onRetry={() => void data.alerts.refetch()}
          />
        </div>
      </div>

      <div className={styles.lowerGrid}>
        <PacePanel
          data={data.salesPace.data}
          loading={data.salesPace.isPending}
          error={data.salesPace.error}
          onRetry={() => void data.salesPace.refetch()}
        />
        <ActivityPanel
          overview={data.overview.data}
          loading={data.overview.isPending}
          error={data.overview.error}
          onRetry={() => void data.overview.refetch()}
        />
      </div>
    </div>
  );
}
