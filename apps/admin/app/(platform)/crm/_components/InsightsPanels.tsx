'use client';

import {
  ActivityFeed,
  Badge,
  Card,
  CardHeader,
  EmptyState,
  formatCompact,
  formatNumber,
  type ActivityItem,
} from '@boletera/ui';
import type { AuditEntry } from '@/lib/queries/audit';
import type { ApiKey } from '@/lib/queries/partners';
import type { WaitlistRow } from '@/lib/platform-api';
import {
  formatChurnPct,
  formatMoney,
  formatRelativeDay,
} from '../_lib/format';
import {
  CHURN_LABEL,
  CHURN_TONE,
  priorityLabel,
  priorityTone,
  SEGMENT_LABEL,
  SEGMENT_TONE,
} from '../_lib/labels';
import type { CrmCustomerRow, CrmRecommendation } from '../_lib/types';
import styles from '../crm.module.scss';

function auditVerb(action: string): string {
  const normalized = action.toUpperCase();
  if (normalized.includes('ORDER')) return 'actualizó pedido';
  if (normalized.includes('REFUND')) return 'procesó reembolso';
  if (normalized.includes('WAITLIST')) return 'tocó lista de espera';
  if (normalized.includes('API_KEY')) return 'gestionó clave partner';
  if (normalized.includes('CAMPAIGN')) return 'ajustó campaña';
  return action.toLowerCase().replaceAll('_', ' ');
}

export function buildCrmActivity(input: {
  orders: ReadonlyArray<{
    id: string;
    buyerName: string;
    buyerEmail: string;
    status: string;
    createdAt: string;
    publicId: string;
    totalAmount: string;
    currency: string;
    event?: { title: string } | null;
  }>;
  audit: readonly AuditEntry[];
}): ActivityItem[] {
  const fromOrders = input.orders
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 6)
    .map((order) => ({
      id: `order-${order.id}`,
      actor: order.buyerName || order.buyerEmail || 'Cliente',
      action: `registró pedido ${order.status.toLowerCase()}`,
      target: order.event?.title || order.publicId,
      timestamp: order.createdAt,
      detail: formatMoney(Number(order.totalAmount) || 0, order.currency),
    }));

  const fromAudit = input.audit
    .slice()
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
    .slice(0, 6)
    .map((entry) => ({
      id: `audit-${entry.id}`,
      actor: 'Sistema',
      action: auditVerb(entry.action),
      target: `${entry.entityType} · ${entry.entityId.slice(0, 8)}`,
      timestamp: entry.createdAt,
    }));

  return [...fromOrders, ...fromAudit]
    .sort(
      (a, b) =>
        new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime(),
    )
    .slice(0, 10);
}

type ListProps = {
  frequent: readonly CrmCustomerRow[];
  churn: readonly CrmCustomerRow[];
  onSelect: (id: string) => void;
};

export function FrequentAndChurnLists({ frequent, churn, onSelect }: ListProps) {
  return (
    <div className={styles.listsGrid}>
      <Card padding="md">
        <CardHeader
          title="Compradores frecuentes"
          description="2+ pedidos completados en la muestra"
        />
        {frequent.length === 0 ? (
          <EmptyState
            size="sm"
            illustration="inbox"
            title="Sin frecuentes aún"
            description="Aparecen cuando un correo acumula pedidos completados repetidos."
          />
        ) : (
          <ul className={styles.personList} aria-label="Compradores frecuentes">
            {frequent.map((row) => (
              <li key={row.id}>
                <button type="button" className={styles.personBtn} onClick={() => onSelect(row.id)}>
                  <span>
                    <strong>{row.name}</strong>
                    <span className={styles.personMeta}>
                      {formatNumber(row.completedOrders)} pedidos · {formatMoney(row.totalSpend)}
                    </span>
                  </span>
                  <Badge tone={SEGMENT_TONE[row.segment]} variant="soft" size="sm">
                    {SEGMENT_LABEL[row.segment]}
                  </Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>

      <Card padding="md">
        <CardHeader
          title="Riesgo de churn"
          description="Heurística por recencia · no es modelo predictivo"
        />
        {churn.length === 0 ? (
          <EmptyState
            size="sm"
            illustration="chart"
            title="Sin señales altas"
            description="No hay perfiles con recencia media/alta en la muestra actual."
          />
        ) : (
          <ul className={styles.personList} aria-label="Riesgo de churn">
            {churn.map((row) => (
              <li key={row.id}>
                <button type="button" className={styles.personBtn} onClick={() => onSelect(row.id)}>
                  <span>
                    <strong>{row.name}</strong>
                    <span className={styles.personMeta}>
                      {formatRelativeDay(row.lastOrderAt)} · LTV {formatMoney(row.totalSpend)}
                    </span>
                  </span>
                  <Badge tone={CHURN_TONE[row.churnBand]} variant="soft" size="sm">
                    {CHURN_LABEL[row.churnBand]} · {formatChurnPct(row.churnRisk)}
                  </Badge>
                </button>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </div>
  );
}

export function RecommendationsCard({
  items,
  aiAvailable,
}: {
  items: readonly CrmRecommendation[];
  aiAvailable: boolean;
}) {
  return (
    <Card padding="md">
      <CardHeader
        title="Recomendaciones"
        description={
          aiAvailable
            ? 'Derivadas de la cartera + GET /ai/recommendations'
            : 'Derivadas de conteos observados (AI no disponible o vacío)'
        }
      />
      {items.length === 0 ? (
        <EmptyState
          size="sm"
          illustration="chart"
          title="Sin recomendaciones"
          description="Cuando haya segmentos en riesgo, lista de espera o insights AI aparecerán aquí."
        />
      ) : (
        <ul className={styles.recs} aria-label="Recomendaciones CRM">
          {items.slice(0, 8).map((rec) => (
            <li key={rec.id} className={styles.rec}>
              <div className={styles.recHead}>
                <Badge tone={priorityTone(rec.priority)} size="sm">
                  {priorityLabel(rec.priority)}
                </Badge>
                <Badge tone="neutral" variant="outline" size="sm">
                  {rec.source === 'ai' ? 'AI' : 'Derivada'}
                </Badge>
              </div>
              <h3 className={styles.recTitle}>{rec.title}</h3>
              <p className={styles.recBody}>{rec.rationale}</p>
              <p className={styles.recAction}>Acción: {rec.action}</p>
            </li>
          ))}
        </ul>
      )}
    </Card>
  );
}

export function DemandSignalsCard({
  waitlist,
  waitlistTotal,
  apiKeys,
  analyticsRevenue,
}: {
  waitlist: readonly WaitlistRow[];
  waitlistTotal: number | null;
  apiKeys: readonly ApiKey[];
  analyticsRevenue: number | null;
}) {
  const activeKeys = apiKeys.filter((k) => k.active).length;
  const waiting = waitlist.filter((w) => {
    const s = w.status.toUpperCase();
    return s === 'WAITING' || s === 'PENDING' || s === 'ACTIVE' || s === 'QUEUED';
  }).length;

  return (
    <Card padding="md">
      <CardHeader
        title="Señales de demanda"
        description="Waitlist · partners · analytics (sin inventar KPIs)"
      />
      <dl className={styles.signalGrid}>
        <div>
          <dt>Lista de espera</dt>
          <dd>
            {formatNumber(waiting)}
            {waitlistTotal != null ? (
              <span className={styles.inlineMuted}>
                {' '}
                / métrica {formatNumber(waitlistTotal)}
              </span>
            ) : null}
          </dd>
        </div>
        <div>
          <dt>Claves partner activas</dt>
          <dd>{formatNumber(activeKeys)}</dd>
        </div>
        <div>
          <dt>Ingreso analytics (mes)</dt>
          <dd>
            {analyticsRevenue != null
              ? `${formatCompact(analyticsRevenue)} MXN`
              : '—'}
          </dd>
        </div>
      </dl>
      {waitlist.length === 0 && apiKeys.length === 0 ? (
        <p className={styles.muted}>
          Sin filas de waitlist ni claves partner en esta organización.
        </p>
      ) : null}
    </Card>
  );
}

export function ActivityCard({
  items,
  loading,
}: {
  items: readonly ActivityItem[];
  loading: boolean;
}) {
  return (
    <Card padding="md">
      <CardHeader
        title="Actividad"
        description="Pedidos recientes + auditoría relevante"
      />
      <ActivityFeed
        items={[...items]}
        loading={loading}
        empty={
          <EmptyState
            size="sm"
            illustration="inbox"
            title="Sin actividad"
            description="Los movimientos de compra y auditoría aparecerán aquí."
          />
        }
      />
    </Card>
  );
}

export function LimitsNote() {
  return (
    <aside className={styles.limits} aria-label="Límites del CRM">
      <strong>Límites de datos</strong>
      <ul>
        <li>
          No existe API CRM dedicada: perfiles = agregación local de GET /admin/orders.
        </li>
        <li>
          El cliente de pedidos no pagina ni filtra en la petición; LTV/RFM cubren solo la
          muestra recibida.
        </li>
        <li>
          Churn local ≈ recencia; el churn AI se usa solo si el correo coincide con
          /ai/segmentation.
        </li>
        <li>
          Waitlist, partners y audit aportan contexto; no son un CRM de contactos unificado.
        </li>
      </ul>
    </aside>
  );
}
