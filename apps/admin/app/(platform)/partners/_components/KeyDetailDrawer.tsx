'use client';

import {
  Badge,
  Button,
  Drawer,
  Sparkline,
  StatusDot,
  formatDateTime,
} from '@boletera/ui';
import type { ApiKey } from '@/lib/queries/partners';
import {
  activitySparkline,
  classifyKey,
  keyHealthMeta,
} from '../_lib/keys';
import { daysUntil, formatCount, formatDay, relativeFuture, relativePast } from '../_lib/format';
import { isWriteScope, scopeLabel } from '../_lib/scopes';
import styles from '../partners.module.scss';

type KeyDetailDrawerProps = {
  keyRow: ApiKey | null;
  now: number;
  busy: boolean;
  onClose: () => void;
  onRotate: (key: ApiKey) => void;
  onRevoke: (key: ApiKey) => void;
};

export function KeyDetailDrawer({
  keyRow,
  now,
  busy,
  onClose,
  onRotate,
  onRevoke,
}: KeyDetailDrawerProps) {
  if (!keyRow) {
    return (
      <Drawer open={false} onClose={onClose} title="Detalle de API key">
        {null}
      </Drawer>
    );
  }

  const health = keyHealthMeta(classifyKey(keyRow, now));
  const expiresIn = daysUntil(keyRow.expiresAt, now);
  const spark = activitySparkline(keyRow, now);
  const canMutate = keyRow.active && classifyKey(keyRow, now) !== 'expired';

  return (
    <Drawer
      open
      onClose={onClose}
      title={keyRow.name}
      description={`Prefijo ${keyRow.keyPrefix}…`}
      size="md"
      footer={
        canMutate ? (
          <div className={styles.modalFooter}>
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={busy}
              onClick={() => onRotate(keyRow)}
            >
              Rotar
            </Button>
            <Button
              type="button"
              variant="danger"
              size="sm"
              disabled={busy}
              onClick={() => onRevoke(keyRow)}
            >
              Revocar
            </Button>
          </div>
        ) : undefined
      }
    >
      <div className={styles.drawerBody}>
        <div className={styles.drawerHealth}>
          <StatusDot tone={health.statusTone} pulse={health.pulse} aria-hidden />
          <Badge tone={health.tone} variant="soft" size="sm" dot>
            {health.label}
          </Badge>
          <span className={styles.muted}>{relativePast(keyRow.lastUsedAt, now)}</span>
        </div>

        <dl className={styles.metaList}>
          <div>
            <dt>Creada</dt>
            <dd>{formatDateTime(keyRow.createdAt)}</dd>
          </div>
          <div>
            <dt>Último uso</dt>
            <dd>
              {keyRow.lastUsedAt
                ? formatDateTime(keyRow.lastUsedAt)
                : 'Nunca'}
            </dd>
          </div>
          <div>
            <dt>Caducidad</dt>
            <dd>
              {keyRow.expiresAt
                ? `${formatDay(keyRow.expiresAt)}${
                    expiresIn !== null ? ` · ${relativeFuture(expiresIn)}` : ''
                  }`
                : 'Sin caducidad'}
            </dd>
          </div>
          <div>
            <dt>Rate limit</dt>
            <dd>{formatCount(keyRow.rateLimit)} / min</dd>
          </div>
        </dl>

        <section aria-label="Actividad estimada">
          <h3 className={styles.drawerSectionTitle}>Señal de tráfico (7 d)</h3>
          <Sparkline
            data={spark}
            label={`Actividad estimada de ${keyRow.name}`}
            width={220}
            height={36}
            tone={health.tone === 'success' ? 'success' : health.tone === 'danger' ? 'danger' : 'neutral'}
          />
          <p className={styles.muted}>
            Derivada del último uso y del rate limit — no es telemetría de gateway.
          </p>
        </section>

        <section aria-label="Scopes concedidos">
          <h3 className={styles.drawerSectionTitle}>Scopes</h3>
          <ul className={styles.scopeChipList}>
            {keyRow.scopes.map((scope) => (
              <li key={scope}>
                <Badge
                  tone={isWriteScope(scope) ? 'warning' : 'neutral'}
                  variant="outline"
                  size="sm"
                >
                  {scopeLabel(scope)}
                </Badge>
                <code>{scope}</code>
              </li>
            ))}
          </ul>
        </section>
      </div>
    </Drawer>
  );
}
