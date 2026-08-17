import type { ApiKey } from '@/lib/queries/partners';
import type { BadgeTone, StatusTone } from '@boletera/ui';
import { countWriteScopes, isWriteScope } from './scopes';

const HOUR_MS = 60 * 60 * 1000;
const DAY_MS = 24 * HOUR_MS;
const WEEK_MS = 7 * DAY_MS;

/** Estados operativos derivados; no existen en el backend. */
export type KeyHealth =
  | 'active'
  | 'low'
  | 'idle'
  | 'expiring'
  | 'expired'
  | 'revoked';

export type KeyHealthMeta = {
  id: KeyHealth;
  label: string;
  tone: BadgeTone;
  statusTone: StatusTone;
  /** El punto de estado pulsa cuando hay tráfico reciente. */
  pulse: boolean;
};

const HEALTH_META: Record<KeyHealth, KeyHealthMeta> = {
  active: {
    id: 'active',
    label: 'Activa',
    tone: 'success',
    statusTone: 'success',
    pulse: true,
  },
  low: {
    id: 'low',
    label: 'Bajo uso',
    tone: 'warning',
    statusTone: 'warning',
    pulse: false,
  },
  idle: {
    id: 'idle',
    label: 'Sin tráfico',
    tone: 'warning',
    statusTone: 'warning',
    pulse: false,
  },
  expiring: {
    id: 'expiring',
    label: 'Por expirar',
    tone: 'warning',
    statusTone: 'warning',
    pulse: false,
  },
  expired: {
    id: 'expired',
    label: 'Expirada',
    tone: 'danger',
    statusTone: 'danger',
    pulse: false,
  },
  revoked: {
    id: 'revoked',
    label: 'Revocada',
    tone: 'neutral',
    statusTone: 'neutral',
    pulse: false,
  },
};

export function keyHealthMeta(health: KeyHealth): KeyHealthMeta {
  return HEALTH_META[health];
}

/**
 * Clasifica una clave según su ciclo de vida y el tráfico reciente.
 * `now` es inyectable para que un único tick de reloj refresque toda la vista.
 */
export function classifyKey(key: ApiKey, now: number): KeyHealth {
  if (!key.active) return 'revoked';

  if (key.expiresAt) {
    const expiresAt = new Date(key.expiresAt).getTime();
    if (!Number.isNaN(expiresAt)) {
      if (expiresAt < now) return 'expired';
      if (expiresAt - now < 14 * DAY_MS) return 'expiring';
    }
  }

  if (!key.lastUsedAt) return 'idle';

  const lastUsed = new Date(key.lastUsedAt).getTime();
  if (Number.isNaN(lastUsed)) return 'idle';

  const age = now - lastUsed;
  if (age < DAY_MS) return 'active';
  if (age < WEEK_MS) return 'low';
  return 'idle';
}

export type KeyAlert = {
  id: string;
  tone: BadgeTone;
  text: string;
};

/** Alertas accionables a nivel de portfolio. */
export function buildKeyAlerts(keys: readonly ApiKey[], now: number): KeyAlert[] {
  const alerts: KeyAlert[] = [];
  const expired = keys.filter((key) => classifyKey(key, now) === 'expired');
  const expiring = keys.filter((key) => classifyKey(key, now) === 'expiring');
  const idleActive = keys.filter(
    (key) => key.active && classifyKey(key, now) === 'idle',
  );
  const writeHeavy = keys.filter(
    (key) => key.active && countWriteScopes(key.scopes) > 0 && !key.lastUsedAt,
  );

  if (expired.length > 0) {
    alerts.push({
      id: 'expired',
      tone: 'danger',
      text: `${expired.length} clave${expired.length === 1 ? '' : 's'} expirada${expired.length === 1 ? '' : 's'}. Rótala o emite una nueva.`,
    });
  }
  if (expiring.length > 0) {
    alerts.push({
      id: 'expiring',
      tone: 'warning',
      text: `${expiring.length} clave${expiring.length === 1 ? '' : 's'} caduca${expiring.length === 1 ? '' : 'n'} en menos de 14 días.`,
    });
  }
  if (idleActive.length > 0) {
    alerts.push({
      id: 'idle',
      tone: 'warning',
      text: `${idleActive.length} clave${idleActive.length === 1 ? '' : 's'} activa${idleActive.length === 1 ? '' : 's'} sin tráfico reciente.`,
    });
  }
  if (writeHeavy.length > 0) {
    alerts.push({
      id: 'write-idle',
      tone: 'info',
      text: `${writeHeavy.length} clave${writeHeavy.length === 1 ? '' : 's'} con scopes de escritura aún sin primer uso.`,
    });
  }

  return alerts;
}

export type PartnerKpis = {
  total: number;
  active: number;
  usedRecently: number;
  avgLimit: number;
  writeCapable: number;
  expiringSoon: number;
};

export function computePartnerKpis(keys: readonly ApiKey[], now: number): PartnerKpis {
  const active = keys.filter((key) => key.active);
  const usedRecently = active.filter((key) => {
    if (!key.lastUsedAt) return false;
    const time = new Date(key.lastUsedAt).getTime();
    return !Number.isNaN(time) && now - time < WEEK_MS;
  });
  const avgLimit =
    active.length > 0
      ? Math.round(active.reduce((sum, key) => sum + key.rateLimit, 0) / active.length)
      : 0;
  const writeCapable = active.filter((key) => key.scopes.some(isWriteScope)).length;
  const expiringSoon = active.filter((key) => {
    const health = classifyKey(key, now);
    return health === 'expiring' || health === 'expired';
  }).length;

  return {
    total: keys.length,
    active: active.length,
    usedRecently: usedRecently.length,
    avgLimit,
    writeCapable,
    expiringSoon,
  };
}

/** Serie sintética para sparklines: actividad semanal relativa a `lastUsedAt`. */
export function activitySparkline(key: ApiKey, now: number): number[] {
  const points = 7;
  if (!key.active) return Array.from({ length: points }, () => 0);
  if (!key.lastUsedAt) return Array.from({ length: points }, () => 0);

  const lastUsed = new Date(key.lastUsedAt).getTime();
  if (Number.isNaN(lastUsed)) return Array.from({ length: points }, () => 0);

  const ageDays = Math.max(0, Math.floor((now - lastUsed) / DAY_MS));
  return Array.from({ length: points }, (_, index) => {
    const dayAge = points - 1 - index;
    if (dayAge < ageDays) return 0;
    // Decae con la antigüedad: tráfico reciente pesa más.
    const freshness = Math.max(0, 1 - dayAge / 14);
    const base = Math.max(1, Math.round(key.rateLimit / 250));
    return Math.round(base * freshness);
  });
}

export type ScopeSlice = {
  id: string;
  label: string;
  value: number;
};

/** Conteo de scopes concedidos entre claves activas (para el DonutChart). */
export function scopeDistribution(keys: readonly ApiKey[]): ScopeSlice[] {
  const counts = new Map<string, number>();
  for (const key of keys) {
    if (!key.active) continue;
    for (const scope of key.scopes) {
      counts.set(scope, (counts.get(scope) ?? 0) + 1);
    }
  }
  return Array.from(counts.entries())
    .map(([id, value]) => ({ id, label: id, value }))
    .sort((a, b) => b.value - a.value);
}

export type HealthFilter = 'all' | KeyHealth;

export function matchesHealth(key: ApiKey, filter: HealthFilter, now: number): boolean {
  if (filter === 'all') return true;
  return classifyKey(key, now) === filter;
}

export function matchesQuery(key: ApiKey, query: string): boolean {
  const term = query.trim().toLowerCase();
  if (!term) return true;
  return (
    key.name.toLowerCase().includes(term) ||
    key.keyPrefix.toLowerCase().includes(term) ||
    key.scopes.some((scope) => scope.toLowerCase().includes(term))
  );
}

export const HEALTH_FILTER_OPTIONS: readonly { value: HealthFilter; label: string }[] = [
  { value: 'all', label: 'Todas' },
  { value: 'active', label: 'Activas' },
  { value: 'low', label: 'Bajo uso' },
  { value: 'idle', label: 'Sin tráfico' },
  { value: 'expiring', label: 'Por expirar' },
  { value: 'expired', label: 'Expiradas' },
  { value: 'revoked', label: 'Revocadas' },
];
