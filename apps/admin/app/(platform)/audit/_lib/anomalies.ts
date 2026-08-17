import type { AuditEntry } from '@/lib/queries/audit';
import { actionLabel, isSensitiveAction } from './labels';

export type AuditAnomalySeverity = 'info' | 'warning' | 'critical';

export type AuditAnomaly = {
  id: string;
  severity: AuditAnomalySeverity;
  title: string;
  explanation: string;
  suggestedAction: string;
  relatedAction?: string;
  count: number;
  detectedAt: string;
};

export type AuditRecord = AuditEntry & {
  userId?: string | null;
  ipAddress?: string | null;
  entityId?: string | null;
};

const BURST_WINDOW_MS = 15 * 60 * 1000;
const FAILED_LOGIN_THRESHOLD = 5;
const SENSITIVE_BURST_THRESHOLD = 8;
const NIGHT_HOUR_START = 0;
const NIGHT_HOUR_END = 5;

function ts(entry: AuditRecord): number {
  return new Date(entry.createdAt).getTime();
}

/** Detecta patrones anómalos en el trail cargado (heurística client-side). */
export function detectAnomalies(entries: readonly AuditRecord[]): AuditAnomaly[] {
  if (!entries.length) return [];

  const anomalies: AuditAnomaly[] = [];
  const sorted = [...entries].sort((a, b) => ts(b) - ts(a));
  const newest = sorted[0]?.createdAt ?? new Date().toISOString();

  const failedLogins = sorted.filter((e) => e.action === 'AUTH_LOGIN_FAILED');
  if (failedLogins.length >= FAILED_LOGIN_THRESHOLD) {
    const recent = failedLogins.filter(
      (e) => ts(failedLogins[0]!) - ts(e) <= BURST_WINDOW_MS,
    );
    if (recent.length >= FAILED_LOGIN_THRESHOLD) {
      anomalies.push({
        id: 'burst-failed-login',
        severity: 'critical',
        title: 'Ráfaga de logins fallidos',
        explanation: `${recent.length} intentos fallidos en ~15 minutos. Puede indicar fuerza bruta o credenciales comprometidas.`,
        suggestedAction: 'Revisar IPs, bloquear actores sospechosos y forzar rotación de credenciales.',
        relatedAction: 'AUTH_LOGIN_FAILED',
        count: recent.length,
        detectedAt: failedLogins[0]!.createdAt,
      });
    }
  }

  const reuse = sorted.filter((e) => e.action === 'AUTH_REFRESH_REUSE_DETECTED');
  if (reuse.length > 0) {
    anomalies.push({
      id: 'refresh-reuse',
      severity: 'critical',
      title: 'Reuso de refresh token',
      explanation: `Se detectaron ${reuse.length} evento(s) de reuso de refresh. Suele indicar robo de sesión.`,
      suggestedAction: 'Revocar todas las sesiones del usuario afectado y auditar accesos posteriores.',
      relatedAction: 'AUTH_REFRESH_REUSE_DETECTED',
      count: reuse.length,
      detectedAt: reuse[0]!.createdAt,
    });
  }

  const sensitive = sorted.filter((e) => isSensitiveAction(e.action));
  if (sensitive.length >= SENSITIVE_BURST_THRESHOLD) {
    const windowed = sensitive.filter(
      (e) => ts(sensitive[0]!) - ts(e) <= BURST_WINDOW_MS,
    );
    if (windowed.length >= SENSITIVE_BURST_THRESHOLD) {
      anomalies.push({
        id: 'sensitive-burst',
        severity: 'warning',
        title: 'Actividad sensible concentrada',
        explanation: `${windowed.length} eventos sensibles en una ventana corta (reembolsos, cambios de equipo, cancelaciones, etc.).`,
        suggestedAction: 'Validar que las acciones correspondan a un flujo operativo legítimo.',
        count: windowed.length,
        detectedAt: sensitive[0]!.createdAt,
      });
    }
  }

  const nightSensitive = sensitive.filter((e) => {
    const hour = new Date(e.createdAt).getHours();
    return hour >= NIGHT_HOUR_START && hour < NIGHT_HOUR_END;
  });
  if (nightSensitive.length >= 3) {
    anomalies.push({
      id: 'night-activity',
      severity: 'info',
      title: 'Actividad sensible en madrugada',
      explanation: `${nightSensitive.length} acciones sensibles entre 00:00 y 05:00 (hora local del navegador).`,
      suggestedAction: 'Confirmar con el equipo si hubo operaciones programadas o acceso no autorizado.',
      count: nightSensitive.length,
      detectedAt: nightSensitive[0]!.createdAt,
    });
  }

  const byActor = new Map<string, number>();
  for (const entry of sensitive) {
    const actor = entry.userId || entry.ipAddress || 'desconocido';
    byActor.set(actor, (byActor.get(actor) ?? 0) + 1);
  }
  for (const [actor, count] of byActor) {
    if (count < 6) continue;
    anomalies.push({
      id: `actor-${actor}`,
      severity: 'warning',
      title: 'Actor con alto volumen sensible',
      explanation: `El actor ${actor.slice(0, 18)} concentra ${count} eventos sensibles en el trail cargado.`,
      suggestedAction: 'Revisar el historial del usuario/IP y contrastar con roles asignados.',
      count,
      detectedAt: newest,
    });
  }

  // Deduplicate by id keeping highest severity order already pushed
  const seen = new Set<string>();
  return anomalies.filter((item) => {
    if (seen.has(item.id)) return false;
    seen.add(item.id);
    return true;
  });
}

export function summarizeSensitive(entries: readonly AuditRecord[]): {
  total: number;
  sensitive: number;
  entities: number;
  latestSensitiveAt: string | null;
} {
  const sensitive = entries.filter((e) => isSensitiveAction(e.action));
  const entities = new Set(entries.map((e) => e.entityType)).size;
  return {
    total: entries.length,
    sensitive: sensitive.length,
    entities,
    latestSensitiveAt: sensitive[0]?.createdAt ?? null,
  };
}

export function describeEntry(entry: AuditRecord): string {
  const entity = entry.entityType;
  const id = entry.entityId ? entry.entityId.slice(0, 10) : '—';
  return `${actionLabel(entry.action)} · ${entity} ${id}`;
}
