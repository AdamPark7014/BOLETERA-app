export type ReconciliationCheckStatus = 'ok' | 'warn' | 'error';

export type ReconciliationSample = Record<string, string | number | null>;

export type ReconciliationCheck = {
  id: string;
  label: string;
  description: string;
  status: ReconciliationCheckStatus;
  count: number;
  samples: ReconciliationSample[];
};

export type ReconciliationReport = {
  generatedAt: string;
  scope: 'organization' | 'platform';
  organizationId: string | null;
  checks: ReconciliationCheck[];
  summary: {
    ok: number;
    warn: number;
    error: number;
  };
};
