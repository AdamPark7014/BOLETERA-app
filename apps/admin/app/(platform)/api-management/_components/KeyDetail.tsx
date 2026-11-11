'use client';

import { TicketButton } from '@boletera/ui';
import type { ApiKey } from '@/lib/queries/api-management';
import styles from '../../events/_ticket/frame.module.scss';
import { formatWhen } from '../../events/_ticket/read';
import { daysUntil, formatCount, formatDay, relativeFuture, relativePast } from '../_lib/format';
import { classifyKey, keyHealthMeta } from '../_lib/keys';
import { isWriteScope, scopeLabel } from '../_lib/scopes';

export type KeyConfirm = { kind: 'rotate' | 'revoke'; keyId: string } | null;

type KeyDetailProps = {
  keyRow: ApiKey;
  now: number;
  busy: boolean;
  confirm: KeyConfirm;
  onAsk: (kind: 'rotate' | 'revoke') => void;
  onCancel: () => void;
  onRotate: () => void;
  onRevoke: () => void;
};

function InfoRow({ label, value }: { label: string; value: string }) {
  return (
    <div className={styles.row}>
      <p className={styles.rowMeta}>{label}</p>
      <span />
      <p className={styles.quiet} style={{ textAlign: 'right' }}>
        {value}
      </p>
    </div>
  );
}

/** Detalle de una llave abierto en acordeón. Solo prefijo: el secreto nunca se vuelve a mostrar. */
export function KeyDetail({
  keyRow,
  now,
  busy,
  confirm,
  onAsk,
  onCancel,
  onRotate,
  onRevoke,
}: KeyDetailProps) {
  const health = keyHealthMeta(classifyKey(keyRow, now));
  const expiresIn = daysUntil(keyRow.expiresAt, now);
  const asking = confirm && confirm.keyId === keyRow.id ? confirm.kind : null;

  return (
    <div className={styles.stack}>
      <p className={styles.tertiary}>
        Prefijo <span className={styles.mono}>{keyRow.keyPrefix}…</span> · el secreto nunca se
        vuelve a mostrar
      </p>
      <div className={styles.rows}>
        <InfoRow
          label="Estado"
          value={`${health.label} · ${relativePast(keyRow.lastUsedAt, now)}`}
        />
        <InfoRow label="Creada" value={formatWhen(keyRow.createdAt)} />
        <InfoRow
          label="Último uso"
          value={keyRow.lastUsedAt ? formatWhen(keyRow.lastUsedAt) : 'Nunca'}
        />
        <InfoRow
          label="Caducidad"
          value={
            keyRow.expiresAt
              ? `${formatDay(keyRow.expiresAt)}${expiresIn !== null ? ` · ${relativeFuture(expiresIn)}` : ''}`
              : 'Sin caducidad'
          }
        />
        <InfoRow label="Límite" value={`${formatCount(keyRow.rateLimit)} por minuto`} />
      </div>

      <p className={styles.rowTitle}>Permisos</p>
      <ul className={styles.rows}>
        {keyRow.scopes.map((scope) => (
          <li key={scope} className={styles.row}>
            <div className={styles.rowMain}>
              <p className={styles.rowTitle}>{scopeLabel(scope)}</p>
              <p className={styles.mono}>{scope}</p>
            </div>
            <span />
            <p className={styles.tertiary}>{isWriteScope(scope) ? 'Escritura' : 'Lectura'}</p>
          </li>
        ))}
      </ul>

      {keyRow.active ? (
        asking === 'rotate' ? (
          <div className={styles.stack}>
            <p className={styles.quiet}>
              Se emite una llave nueva para «{keyRow.name}» con los mismos permisos y se revoca la
              actual. Las integraciones dejan de autenticarse con este prefijo. El secreto nuevo se
              muestra una sola vez.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <TicketButton variant="secondary" disabled={busy} onClick={onRotate}>
                {busy ? 'Rotando' : 'Rotar ahora'}
              </TicketButton>
              <TicketButton variant="ghost" disabled={busy} onClick={onCancel}>
                Cancelar
              </TicketButton>
            </div>
          </div>
        ) : asking === 'revoke' ? (
          <div className={styles.stack}>
            <p className={styles.quiet}>
              «{keyRow.name}» ({keyRow.keyPrefix}…) deja de aceptar tráfico de inmediato. No se
              puede deshacer; rota si solo necesitas renovar el secreto.
            </p>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
              <TicketButton variant="danger" disabled={busy} onClick={onRevoke}>
                {busy ? 'Revocando' : 'Revocar'}
              </TicketButton>
              <TicketButton variant="ghost" disabled={busy} onClick={onCancel}>
                Cancelar
              </TicketButton>
            </div>
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            <TicketButton variant="secondary" disabled={busy} onClick={() => onAsk('rotate')}>
              Rotar
            </TicketButton>
            <TicketButton variant="ghost" disabled={busy} onClick={() => onAsk('revoke')}>
              Revocar
            </TicketButton>
          </div>
        )
      ) : null}
    </div>
  );
}
