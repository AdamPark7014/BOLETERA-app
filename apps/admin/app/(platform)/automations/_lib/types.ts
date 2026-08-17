export type AutomationTriggerKind = 'event' | 'schedule' | 'manual';

export type AutomationActionKind =
  | 'notify'
  | 'email'
  | 'offer'
  | 'channel'
  | 'incident'
  | 'report'
  | 'payment';

export type AutomationRuleStatus = 'enabled' | 'disabled' | 'draft';

export type AutomationRunStatus =
  | 'succeeded'
  | 'failed'
  | 'skipped'
  | 'simulated'
  | 'toggled';

export type AutomationTrigger = {
  id: string;
  kind: AutomationTriggerKind;
  name: string;
  description: string;
  eventKey?: string;
  scheduleHint?: string;
};

export type AutomationRule = {
  id: string;
  name: string;
  description: string;
  triggerId: string;
  actionKind: AutomationActionKind;
  actionLabel: string;
  requiresConnector?: string;
  status: AutomationRuleStatus;
  updatedAt: string;
};

export type AutomationHistoryEntry = {
  id: string;
  ruleId: string;
  ruleName: string;
  status: AutomationRunStatus;
  summary: string;
  at: string;
};

export type AutomationView = 'rules' | 'triggers' | 'history';

export const STORAGE_KEY = 'boletera.admin.automations.v1';

export type AutomationsPersistedState = {
  ruleStatus: Record<string, AutomationRuleStatus>;
  history: AutomationHistoryEntry[];
};
