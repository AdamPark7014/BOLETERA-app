'use client';

import { useCallback, useEffect, useState } from 'react';
import { Badge } from '@boletera/ui';
import {
  getEventPublishValidation,
  type EventPublishValidation,
  type PublishCheckItem,
} from '@/lib/platform-api';
import styles from './publish-validation.module.scss';

type Props = {
  token: string;
  eventId: string;
  /** Called when validation result updates (e.g. to gate publish button). */
  onValidationChange?: (validation: EventPublishValidation | null) => void;
  /** Bump to force reload after hub changes. */
  refreshKey?: number;
};

const STATUS_LABEL = {
  ok: 'Listo',
  warning: 'Aviso',
  blocker: 'Bloqueo',
} as const;

const STATUS_TONE = {
  ok: 'success',
  warning: 'warning',
  blocker: 'danger',
} as const satisfies Record<PublishCheckItem['status'], 'success' | 'warning' | 'danger'>;

export function EventPublishValidationPanel({
  token,
  eventId,
  onValidationChange,
  refreshKey = 0,
}: Props) {
  const [validation, setValidation] = useState<EventPublishValidation | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setError(null);
    setLoading(true);
    try {
      const data = await getEventPublishValidation(token, eventId);
      setValidation(data);
      onValidationChange?.(data);
    } catch (e) {
      const message = e instanceof Error ? e.message : 'No se pudo cargar la validación';
      setError(message);
      setValidation(null);
      onValidationChange?.(null);
    } finally {
      setLoading(false);
    }
  }, [token, eventId, onValidationChange]);

  useEffect(() => {
    void refresh();
  }, [refresh, refreshKey]);

  if (loading && !validation) {
    return (
      <section className={styles.panel} aria-busy="true">
        <p className={styles.muted}>Verificando requisitos de publicación…</p>
      </section>
    );
  }

  if (error && !validation) {
    return (
      <section className={styles.panel}>
        <p className={styles.error}>{error}</p>
        <button type="button" className={styles.retryBtn} onClick={() => void refresh()}>
          Reintentar
        </button>
      </section>
    );
  }

  if (!validation) return null;

  const { progress, ready } = validation;
  const pct = progress.total ? Math.round((progress.passed / progress.total) * 100) : 0;

  return (
    <section className={styles.panel} aria-labelledby="publish-checklist-title">
      <header className={styles.header}>
        <div>
          <h2 id="publish-checklist-title">Checklist de publicación</h2>
          <p className={styles.muted}>
            {ready
              ? progress.warnings > 0
                ? 'Puedes publicar; revisa los avisos antes de abrir venta.'
                : 'Todo listo para publicar inventario.'
              : `${progress.blockers} bloqueo(s) pendiente(s) — corrige antes de publicar.`}
          </p>
        </div>
        <div className={styles.summary}>
          <Badge tone={ready ? (progress.warnings ? 'warning' : 'success') : 'danger'}>
            {ready ? (progress.warnings ? 'Con avisos' : 'Listo') : 'Bloqueado'}
          </Badge>
          <span className={styles.progressText}>
            {progress.passed}/{progress.total} · {pct}%
          </span>
        </div>
      </header>

      <div
        className={styles.progressBar}
        role="progressbar"
        aria-valuenow={progress.passed}
        aria-valuemin={0}
        aria-valuemax={progress.total}
        aria-label="Progreso del checklist"
      >
        <span className={styles.progressFill} style={{ width: `${pct}%` }} />
      </div>

      <ul className={styles.checklist}>
        {validation.checks.map((check) => (
          <li key={check.id} className={styles.checkItem} data-status={check.status}>
            <div className={styles.checkMain}>
              <Badge tone={STATUS_TONE[check.status]}>{STATUS_LABEL[check.status]}</Badge>
              <strong>{check.label}</strong>
              <span>{check.message}</span>
            </div>
            {check.detail ? <p className={styles.checkDetail}>{check.detail}</p> : null}
          </li>
        ))}
      </ul>

      <button type="button" className={styles.retryBtn} onClick={() => void refresh()} disabled={loading}>
        {loading ? 'Actualizando…' : 'Actualizar checklist'}
      </button>
    </section>
  );
}
