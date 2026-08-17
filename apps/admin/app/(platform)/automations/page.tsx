'use client';

import Link from 'next/link';
import { useEffect, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  EmptyState,
  KpiCard,
  PageHeader,
  Section,
  StatusDot,
  Tabs,
  formatDateTime,
  formatNumber,
} from '@boletera/ui';
import {
  useEventSalesPace,
  useFraudMetrics,
  useMetricsAlerts,
  useWaitlistMetrics,
} from '@/lib/queries/metrics';
import { useBanorteConfig, useWebhookHealth } from '@/lib/queries/integrations';
import { useSession } from '@/lib/use-session';
import { ConfirmToggleModal } from './_components/ConfirmToggleModal';
import {
  actionKindLabel,
  ruleStatusLabel,
  ruleStatusTone,
  runStatusLabel,
  runStatusTone,
  triggerKindLabel,
} from './_lib/labels';
import {
  AUTOMATION_TRIGGERS,
  buildRules,
  createHistoryEntry,
  emptyPersistedState,
  readPersistedState,
  triggerById,
  writePersistedState,
} from './_lib/model';
import type {
  AutomationHistoryEntry,
  AutomationRule,
  AutomationRuleStatus,
  AutomationView,
  AutomationsPersistedState,
} from './_lib/types';
import styles from './automations.module.scss';

type Opportunity = {
  id: string;
  title: string;
  description: string;
  tone: 'info' | 'success' | 'warning' | 'danger';
  href: string;
  action: string;
  ruleId?: string;
};

function daysAgoIso(days: number) {
  const d = new Date();
  d.setUTCDate(d.getUTCDate() - days);
  return d.toISOString();
}

export default function AutomationsPage() {
  const { organizationId } = useSession();
  const [hydrated, setHydrated] = useState(false);
  const [persisted, setPersisted] =
    useState<AutomationsPersistedState>(emptyPersistedState);
  const [view, setView] = useState<AutomationView>('rules');
  const [query, setQuery] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | AutomationRuleStatus>(
    'all',
  );
  const [pendingToggle, setPendingToggle] = useState<{
    ruleId: string;
    nextEnabled: boolean;
  } | null>(null);

  const rangeParams = useMemo(
    () => ({
      from: daysAgoIso(30),
      to: new Date().toISOString(),
      organizationId: organizationId ?? undefined,
    }),
    [organizationId],
  );

  const alertsQ = useMetricsAlerts(rangeParams);
  const waitlistQ = useWaitlistMetrics(rangeParams);
  const fraudQ = useFraudMetrics(rangeParams);
  const paceQ = useEventSalesPace(rangeParams);
  const banorteQ = useBanorteConfig();
  const webhooksQ = useWebhookHealth(!banorteQ.isError);

  useEffect(() => {
    setPersisted(readPersistedState());
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    writePersistedState(persisted);
  }, [hydrated, persisted]);

  const rules = useMemo(
    () => buildRules(persisted.ruleStatus),
    [persisted.ruleStatus],
  );

  const history = persisted.history;

  const filteredRules = useMemo(() => {
    const q = query.trim().toLowerCase();
    return rules.filter((rule) => {
      if (statusFilter !== 'all' && rule.status !== statusFilter) return false;
      if (!q) return true;
      const trigger = triggerById(AUTOMATION_TRIGGERS, rule.triggerId);
      const hay = [
        rule.name,
        rule.description,
        rule.actionLabel,
        trigger?.name ?? '',
        trigger?.eventKey ?? '',
      ]
        .join(' ')
        .toLowerCase();
      return hay.includes(q);
    });
  }, [query, rules, statusFilter]);

  const enabledCount = rules.filter((rule) => rule.status === 'enabled').length;
  const draftCount = rules.filter((rule) => rule.status === 'draft').length;
  const localHistoryCount = history.length;
  const simulatedCount = history.filter((row) => row.status === 'simulated').length;

  const alertCount = alertsQ.data?.alerts.length ?? 0;
  const waitlistPending = waitlistQ.data?.summary.pending ?? 0;
  const openFraudFlags = fraudQ.data?.summary.openFlags ?? 0;
  const behindPace =
    paceQ.data?.atRisk.length ??
    paceQ.data?.events.filter(
      (row) => row.riskLevel === 'at_risk' || row.riskLevel === 'critical',
    ).length ??
    0;

  const opportunities = useMemo(() => {
    const items: Opportunity[] = [];
    const cartRule = rules.find((rule) => rule.id === 'rule.cart-recovery');
    const waitlistRule = rules.find((rule) => rule.id === 'rule.waitlist-offer');
    const paceRule = rules.find((rule) => rule.id === 'rule.sales-pace-alert');
    const paymentRule = rules.find((rule) => rule.id === 'rule.payment-retry');

    if (waitlistPending >= 3) {
      items.push({
        id: 'waitlist',
        title: `${formatNumber(waitlistPending)} fans en waitlist`,
        description:
          'Hay demanda acumulada. Activa la oferta a lista de espera o notifica desde Waitlist.',
        tone: 'warning',
        href: '/waitlist',
        action: 'Abrir waitlist',
        ruleId: waitlistRule?.status !== 'enabled' ? waitlistRule?.id : undefined,
      });
    }

    if (openFraudFlags > 0) {
      items.push({
        id: 'fraud',
        title: `${formatNumber(openFraudFlags)} flags de fraude abiertos`,
        description:
          'Prioriza revisión humana en Fraude. Las reglas locales no inventan resoluciones.',
        tone: 'danger',
        href: '/fraud',
        action: 'Ir a fraude',
      });
    }

    if (behindPace > 0) {
      items.push({
        id: 'pace',
        title: `${formatNumber(behindPace)} eventos con ritmo atrasado`,
        description:
          'El ritmo de venta reporta atraso. Una alerta diaria puede empujar pricing o campañas.',
        tone: 'warning',
        href: '/pricing',
        action: 'Revisar pricing',
        ruleId: paceRule?.status !== 'enabled' ? paceRule?.id : undefined,
      });
    }

    if (alertCount > 0) {
      items.push({
        id: 'alerts',
        title: `${formatNumber(alertCount)} alertas operativas`,
        description:
          'Hay señales en /metrics/alerts. Cruza con reglas de inventario o acceso.',
        tone: 'info',
        href: '/analytics',
        action: 'Ver analytics',
      });
    }

    const banorteReady = Boolean(
      banorteQ.data?.productionReady && !banorteQ.data.demo,
    );
    const webhooksOk = webhooksQ.data?.health === 'healthy';
    if ((banorteQ.data && !banorteReady) || (webhooksQ.data && !webhooksOk)) {
      items.push({
        id: 'connectors',
        title: 'Conectores incompletos',
        description:
          'Algunas reglas de pago/recuperación necesitan Banorte o webhooks sanos.',
        tone: 'warning',
        href: '/integrations',
        action: 'Revisar integraciones',
        ruleId:
          paymentRule?.status !== 'enabled'
            ? paymentRule?.id
            : cartRule?.status !== 'enabled'
              ? cartRule?.id
              : undefined,
      });
    }

    return items.slice(0, 5);
  }, [
    alertCount,
    banorteQ.data,
    behindPace,
    openFraudFlags,
    rules,
    waitlistPending,
    webhooksQ.data,
  ]);

  const pendingRule =
    rules.find((rule) => rule.id === pendingToggle?.ruleId) ?? null;

  function appendHistory(entry: AutomationHistoryEntry) {
    setPersisted((prev) => ({
      ...prev,
      history: [entry, ...prev.history].slice(0, 100),
    }));
  }

  function setRuleStatus(rule: AutomationRule, status: AutomationRuleStatus) {
    setPersisted((prev) => ({
      ...prev,
      ruleStatus: {
        ...prev.ruleStatus,
        [rule.id]: status,
      },
    }));
    appendHistory(
      createHistoryEntry({
        ruleId: rule.id,
        ruleName: rule.name,
        status: 'toggled',
        summary: `Estado → ${ruleStatusLabel(status)} (confirmación humana).`,
      }),
    );
  }

  function simulateRule(rule: AutomationRule) {
    appendHistory(
      createHistoryEntry({
        ruleId: rule.id,
        ruleName: rule.name,
        status: 'simulated',
        summary:
          'Simulación local sin efectos reales. Cuando exista POST /automations/rules/:id/simulate, este historial se sustituye por ejecuciones del servidor.',
      }),
    );
    setView('history');
  }

  function confirmToggle() {
    if (!pendingRule || !pendingToggle) return;
    setRuleStatus(pendingRule, pendingToggle.nextEnabled ? 'enabled' : 'disabled');
    setPendingToggle(null);
  }

  function clearFilters() {
    setQuery('');
    setStatusFilter('all');
  }

  const signalsLoading =
    alertsQ.isPending || waitlistQ.isPending || fraudQ.isPending || paceQ.isPending;

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Inteligencia · Operación"
        title="Automatizaciones"
        description="Reglas locales con confirmación humana, cruzadas con señales reales de waitlist, fraude, ritmo de venta e integraciones. Los runs remotos siguen pendientes de API."
        actions={
          <div className={styles.toolbar}>
            <div className={styles.field}>
              <label htmlFor="automation-search">Buscar</label>
              <input
                id="automation-search"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Regla, disparador o acción"
              />
            </div>
            <div className={styles.field}>
              <label htmlFor="automation-status">Estado</label>
              <select
                id="automation-status"
                value={statusFilter}
                onChange={(event) =>
                  setStatusFilter(event.target.value as 'all' | AutomationRuleStatus)
                }
              >
                <option value="all">Todos</option>
                <option value="enabled">Activas</option>
                <option value="disabled">Pausadas</option>
                <option value="draft">Borrador</option>
              </select>
            </div>
          </div>
        }
      >
        <div className={styles.metaRow}>
          <Badge tone="info" variant="outline">
            {AUTOMATION_TRIGGERS.length} disparadores
          </Badge>
          <Badge tone="neutral" variant="outline">
            Catálogo local · señales vía metrics API
          </Badge>
        </div>
      </PageHeader>

      <div className={styles.banner} role="status">
        <strong>Modo híbrido</strong>
        <p>
          Enable/disable y simulaciones viven en este navegador. Los KPIs de señales
          salen de <code>/metrics/*</code> e integraciones reales — sin inventar runs
          remotos.
        </p>
      </div>

      <section className={styles.kpiGrid} aria-label="Indicadores de automatizaciones">
        <KpiCard
          label="Reglas activas"
          value={hydrated ? formatNumber(enabledCount) : '—'}
          tone="accent"
          hint={`${formatNumber(rules.length)} en catálogo · ${formatNumber(draftCount)} borrador`}
        />
        <KpiCard
          label="Alertas operativas"
          value={alertsQ.isPending ? '—' : formatNumber(alertCount)}
          loading={alertsQ.isPending}
          tone={alertCount > 0 ? 'warning' : 'info'}
          hint="GET /metrics/alerts · 30d"
        />
        <KpiCard
          label="Waitlist pendiente"
          value={waitlistQ.isPending ? '—' : formatNumber(waitlistPending)}
          loading={waitlistQ.isPending}
          tone={waitlistPending >= 3 ? 'warning' : 'success'}
          hint="Demanda acumulada · 30d"
        />
        <KpiCard
          label="Fraude abierto"
          value={fraudQ.isPending ? '—' : formatNumber(openFraudFlags)}
          loading={fraudQ.isPending}
          tone={openFraudFlags > 0 ? 'danger' : 'success'}
          hint="Flags abiertos · 30d"
        />
      </section>

      <Section
        title="Oportunidades accionables"
        description="Señales reales que justifican activar o revisar una regla."
      >
        {signalsLoading && opportunities.length === 0 ? (
          <p className={styles.muted}>Cargando señales operativas…</p>
        ) : opportunities.length === 0 ? (
          <EmptyState
            size="sm"
            tone="success"
            illustration="success"
            title="Sin urgencias de automatización"
            description="Waitlist, fraude, ritmo e integraciones no marcan presión. Mantén las reglas clave listas para el siguiente pico."
            action={
              <Link href="/integrations">
                <Button type="button" variant="secondary" size="sm">
                  Revisar conectores
                </Button>
              </Link>
            }
            secondaryAction={
              <Link href="/campaigns">
                <Button type="button" variant="ghost" size="sm">
                  Ver campañas
                </Button>
              </Link>
            }
          />
        ) : (
          <ul className={styles.opportunityList}>
            {opportunities.map((item) => (
              <li key={item.id} className={styles.opportunityCard}>
                <div className={styles.opportunityHead}>
                  <StatusDot tone={item.tone} pulse={item.tone === 'danger'} />
                  <strong>{item.title}</strong>
                </div>
                <p className={styles.opportunityBody}>{item.description}</p>
                <div className={styles.ruleActions}>
                  <Link href={item.href}>
                    <Button type="button" size="sm" variant="secondary">
                      {item.action}
                    </Button>
                  </Link>
                  {item.ruleId ? (
                    <Button
                      type="button"
                      size="sm"
                      onClick={() =>
                        setPendingToggle({ ruleId: item.ruleId!, nextEnabled: true })
                      }
                    >
                      Activar regla sugerida
                    </Button>
                  ) : null}
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Tabs
        label="Secciones de automatizaciones"
        variant="pill"
        value={view}
        onValueChange={(id) => setView(id as AutomationView)}
        items={[
          {
            id: 'rules',
            label: 'Reglas',
            badge: String(filteredRules.length),
          },
          {
            id: 'triggers',
            label: 'Disparadores',
            badge: String(AUTOMATION_TRIGGERS.length),
          },
          {
            id: 'history',
            label: 'Historial',
            badge: localHistoryCount > 0 ? String(localHistoryCount) : undefined,
          },
        ]}
      />

      {view === 'rules' ? (
        <Section
          title="Reglas"
          description="Activa o pausa con confirmación. Simular registra un intento local sin efectos reales."
        >
          {!hydrated ? (
            <p className={styles.muted}>Cargando estado local…</p>
          ) : filteredRules.length === 0 ? (
            <EmptyState
              size="sm"
              tone="neutral"
              illustration="search"
              title="Sin reglas en este filtro"
              description="Ajusta la búsqueda o el estado para ver el catálogo de reglas."
              action={
                <Button type="button" variant="secondary" size="sm" onClick={clearFilters}>
                  Limpiar filtros
                </Button>
              }
              secondaryAction={
                <Button
                  type="button"
                  variant="ghost"
                  size="sm"
                  onClick={() => setView('triggers')}
                >
                  Ver disparadores
                </Button>
              }
            />
          ) : (
            <ul className={styles.ruleList}>
              {filteredRules.map((rule) => {
                const trigger = triggerById(AUTOMATION_TRIGGERS, rule.triggerId);
                const canEnable = rule.status !== 'enabled';
                return (
                  <li key={rule.id} className={styles.ruleCard}>
                    <div className={styles.ruleHead}>
                      <div className={styles.metaRow}>
                        <Badge tone={ruleStatusTone(rule.status)}>
                          {ruleStatusLabel(rule.status)}
                        </Badge>
                        <Badge tone="neutral" variant="outline">
                          {actionKindLabel(rule.actionKind)}
                        </Badge>
                        {rule.requiresConnector ? (
                          <Badge tone="warning" variant="outline">
                            {rule.requiresConnector}
                          </Badge>
                        ) : null}
                      </div>
                    </div>
                    <h3 className={styles.ruleTitle}>{rule.name}</h3>
                    <p className={styles.ruleBody}>{rule.description}</p>
                    <p className={styles.muted}>
                      Disparador:{' '}
                      {trigger
                        ? `${trigger.name} · ${triggerKindLabel(trigger.kind)}`
                        : rule.triggerId}
                      {' · '}
                      Acción: {rule.actionLabel}
                    </p>
                    <div className={styles.ruleActions}>
                      <Button
                        size="sm"
                        variant={canEnable ? 'primary' : 'danger'}
                        onClick={() =>
                          setPendingToggle({
                            ruleId: rule.id,
                            nextEnabled: canEnable,
                          })
                        }
                      >
                        {canEnable ? 'Activar' : 'Pausar'}
                      </Button>
                      <Button
                        size="sm"
                        variant="secondary"
                        onClick={() => simulateRule(rule)}
                      >
                        Simular
                      </Button>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </Section>
      ) : null}

      {view === 'triggers' ? (
        <Section
          title="Catálogo de disparadores"
          description="Eventos y schedules declarados para validar reglas. La API remota los sustituirá vía GET /automations/triggers."
        >
          <ul className={styles.triggerList}>
            {AUTOMATION_TRIGGERS.map((trigger) => (
              <li key={trigger.id} className={styles.triggerCard}>
                <div className={styles.triggerHead}>
                  <h3 className={styles.triggerTitle}>{trigger.name}</h3>
                  <Badge tone="info" variant="outline">
                    {triggerKindLabel(trigger.kind)}
                  </Badge>
                </div>
                <p className={styles.triggerBody}>{trigger.description}</p>
                <p className={styles.muted}>
                  {trigger.eventKey
                    ? `Evento: ${trigger.eventKey}`
                    : trigger.scheduleHint
                      ? `Agenda: ${trigger.scheduleHint}`
                      : 'Manual'}
                </p>
              </li>
            ))}
          </ul>
        </Section>
      ) : null}

      {view === 'history' ? (
        <Section
          title="Historial"
          description="Bitácora local de activaciones, pausas y simulaciones. No sustituye GET /automations/runs."
        >
          {history.length === 0 ? (
            <EmptyState
              size="sm"
              tone="neutral"
              illustration="chart"
              title="Sin ejecuciones locales"
              description="Activa, pausa o simula una regla para registrar el primer evento. Los runs remotos aparecerán cuando la API exista."
              action={
                <Button
                  type="button"
                  size="sm"
                  onClick={() => setView('rules')}
                >
                  Ir a reglas
                </Button>
              }
              secondaryAction={
                <Link href="/audit">
                  <Button type="button" variant="ghost" size="sm">
                    Ver auditoría
                  </Button>
                </Link>
              }
              hints={['POST /automations/rules/:id/simulate', 'GET /automations/runs']}
            />
          ) : (
            <ul className={styles.historyList}>
              {history.map((row) => (
                <li key={row.id} className={styles.historyCard}>
                  <div className={styles.historyHead}>
                    <div className={styles.metaRow}>
                      <Badge tone={runStatusTone(row.status)}>
                        {runStatusLabel(row.status)}
                      </Badge>
                      <strong>{row.ruleName}</strong>
                    </div>
                    <span className={styles.muted}>
                      {formatDateTime(new Date(row.at))}
                    </span>
                  </div>
                  <p className={styles.historyBody}>{row.summary}</p>
                </li>
              ))}
            </ul>
          )}
        </Section>
      ) : null}

      <Section
        title="Contexto local"
        description={`${formatNumber(localHistoryCount)} eventos en este navegador${
          simulatedCount > 0 ? ` · ${formatNumber(simulatedCount)} simulaciones` : ''
        }.`}
      >
        <p className={styles.muted}>
          Cuando existan <code>GET /automations/runs</code> y{' '}
          <code>/runs/summary</code>, este panel se sustituye por telemetría remota.
        </p>
      </Section>

      <ConfirmToggleModal
        open={Boolean(pendingToggle && pendingRule)}
        rule={pendingRule}
        nextEnabled={pendingToggle?.nextEnabled ?? false}
        onClose={() => setPendingToggle(null)}
        onConfirm={confirmToggle}
      />
    </div>
  );
}
