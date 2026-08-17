export type MetricsRangeKey = '7d' | '30d' | '90d';

export type SettlementPeriod = 'DAILY' | 'WEEKLY' | 'MONTHLY';

export type ReportCatalogId =
  | 'executive'
  | 'channels'
  | 'attendance'
  | 'pace'
  | 'settlement'
  | 'z-reports'
  | 'egress';

export type ReportCatalogItem = {
  id: ReportCatalogId;
  title: string;
  description: string;
  href: string;
  tone: 'neutral' | 'accent' | 'success' | 'warning' | 'danger' | 'info';
  live: boolean;
};
