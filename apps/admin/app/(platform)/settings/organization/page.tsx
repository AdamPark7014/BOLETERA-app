'use client';

/**
 * Equipo, roles e invitaciones.
 *
 * Tras el cambio de SSO, un usuario nuevo entra como CUSTOMER y solo se eleva si
 * existe una invitación viva. Esta pantalla es el único camino del producto para
 * dar de alta a un promotor: sin ella, la alta de personal exigía tocar la base
 * de datos a mano.
 */

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  createInvitation,
  listInvitations,
  listTeam,
  revokeInvitation,
  type Invitation,
} from '@/lib/platform-api';
import { ApiError } from '@/lib/api';
import { ROLE_LABELS, invitableRolesFor, type Role } from '@/lib/permissions';
import { useSession } from '@/components/Session/SessionProvider';
import platform from '../../_styles/platform.module.scss';
import styles from './team.module.scss';

type Member = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
  active: boolean;
  lastLogin: string | null;
};

const STATUS_LABELS: Record<Invitation['status'], string> = {
  PENDING: 'Pendiente',
  ACCEPTED: 'Aceptada',
  EXPIRED: 'Vencida',
};

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

/** Días restantes hasta el vencimiento (negativo = ya venció). */
function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

export default function OrganizationTeamPage() {
  const { token, organizationId, role, can } = useSession();
  const [team, setTeam] = useState<Member[]>([]);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [tab, setTab] = useState<'pending' | 'all'>('pending');

  const [form, setForm] = useState({ email: '', role: 'TAQUILLA' as Role, expiresInDays: 7 });

  /** Solo se ofrecen roles que el API aceptará de este invitador. */
  const allowedRoles = useMemo(() => invitableRolesFor(role), [role]);

  useEffect(() => {
    if (allowedRoles.length && !allowedRoles.includes(form.role)) {
      setForm((f) => ({ ...f, role: allowedRoles[allowedRoles.length - 1] }));
    }
  }, [allowedRoles, form.role]);

  const reload = useCallback(async () => {
    if (!token || !organizationId) return;
    setLoading(true);
    setError(null);
    try {
      const [teamRows, inviteRows] = await Promise.all([
        listTeam(token, organizationId).catch(() => [] as Member[]),
        listInvitations(token, organizationId),
      ]);
      setTeam(teamRows as Member[]);
      setInvitations(inviteRows);
    } catch (err) {
      setError(err instanceof ApiError ? err.userMessage : 'No se pudo cargar el equipo.');
    } finally {
      setLoading(false);
    }
  }, [token, organizationId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  async function onInvite(e: FormEvent) {
    e.preventDefault();
    if (!token || !organizationId) return;
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const created = await createInvitation(token, {
        organizationId,
        email: form.email.trim().toLowerCase(),
        role: form.role,
        expiresInDays: form.expiresInDays,
      });
      setNotice(
        `Invitación enviada a ${created.email} como ${ROLE_LABELS[created.role as Role] ?? created.role}. Vence el ${formatDate(created.expiresAt)}.`,
      );
      setForm((f) => ({ ...f, email: '' }));
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.userMessage : 'No se pudo crear la invitación.');
    } finally {
      setBusy(false);
    }
  }

  async function onRevoke(inv: Invitation) {
    if (!token) return;
    if (!window.confirm(`¿Revocar la invitación de ${inv.email}?`)) return;
    setBusy(true);
    setError(null);
    try {
      await revokeInvitation(token, inv.id);
      setNotice(`Invitación de ${inv.email} revocada.`);
      await reload();
    } catch (err) {
      setError(err instanceof ApiError ? err.userMessage : 'No se pudo revocar.');
    } finally {
      setBusy(false);
    }
  }

  const pending = invitations.filter((i) => i.status === 'PENDING');
  const shown = tab === 'pending' ? pending : invitations;

  if (!can('org.manage')) {
    return (
      <div>
        <header className={platform.pageHeader}>
          <div>
            <h1>Equipo y roles</h1>
          </div>
        </header>
        <section className={platform.panel}>
          <p>Tu rol no permite administrar el equipo de la organización.</p>
        </section>
      </div>
    );
  }

  return (
    <div>
      <header className={platform.pageHeader}>
        <div>
          <h1>Equipo y roles</h1>
          <p>
            Invita por correo con un rol. El usuario se eleva al aceptar; sin invitación viva,
            quien entra por SSO queda como cliente sin acceso.
          </p>
        </div>
      </header>

      {error && (
        <div className={styles.alertError} role="alert">
          {error}
        </div>
      )}
      {notice && (
        <div className={styles.alertOk} role="status">
          {notice}
        </div>
      )}

      <section className={platform.panel}>
        <h2 className={platform.panelTitle}>Invitar al equipo</h2>
        <form onSubmit={onInvite} className={styles.inviteForm}>
          <div className={styles.field}>
            <label htmlFor="inv-email">Correo</label>
            <input
              id="inv-email"
              type="email"
              placeholder="persona@empresa.com"
              value={form.email}
              onChange={(e) => setForm({ ...form, email: e.target.value })}
              required
            />
          </div>

          <div className={styles.field}>
            <label htmlFor="inv-role">Rol</label>
            <select
              id="inv-role"
              value={form.role}
              onChange={(e) => setForm({ ...form, role: e.target.value as Role })}
            >
              {allowedRoles.map((r) => (
                <option key={r} value={r}>
                  {ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </div>

          <div className={styles.field}>
            <label htmlFor="inv-days">Vence en</label>
            <select
              id="inv-days"
              value={form.expiresInDays}
              onChange={(e) => setForm({ ...form, expiresInDays: Number(e.target.value) })}
            >
              <option value={1}>1 día</option>
              <option value={7}>7 días</option>
              <option value={14}>14 días</option>
              <option value={30}>30 días</option>
              <option value={90}>90 días</option>
            </select>
          </div>

          <button type="submit" className={platform.primaryBtn} disabled={busy || !form.email}>
            {busy ? 'Enviando…' : 'Enviar invitación'}
          </button>
        </form>
        <p className={styles.hint}>
          El rol determina qué ve la persona en el backoffice. No puedes otorgar un rol por encima
          del tuyo.
        </p>
      </section>

      <section className={platform.panel}>
        <div className={styles.panelHead}>
          <h2 className={platform.panelTitle}>Invitaciones</h2>
          <div className={styles.tabs}>
            <button
              type="button"
              className={tab === 'pending' ? styles.tabOn : styles.tab}
              onClick={() => setTab('pending')}
            >
              Pendientes ({pending.length})
            </button>
            <button
              type="button"
              className={tab === 'all' ? styles.tabOn : styles.tab}
              onClick={() => setTab('all')}
            >
              Todas ({invitations.length})
            </button>
          </div>
        </div>

        {loading ? (
          <p className={styles.empty}>Cargando…</p>
        ) : shown.length === 0 ? (
          <p className={styles.empty}>
            {tab === 'pending'
              ? 'No hay invitaciones pendientes.'
              : 'Aún no se ha enviado ninguna invitación.'}
          </p>
        ) : (
          <table className={platform.table}>
            <thead>
              <tr>
                <th>Correo</th>
                <th>Rol</th>
                <th>Estado</th>
                <th>Vence</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {shown.map((inv) => {
                const days = daysUntil(inv.expiresAt);
                return (
                  <tr key={inv.id}>
                    <td>{inv.email}</td>
                    <td>{ROLE_LABELS[inv.role as Role] ?? inv.role}</td>
                    <td>
                      <span className={`${styles.badge} ${styles[inv.status.toLowerCase()]}`}>
                        {STATUS_LABELS[inv.status]}
                      </span>
                    </td>
                    <td>
                      {formatDate(inv.expiresAt)}
                      {inv.status === 'PENDING' && days <= 2 && (
                        <small className={styles.soon}>
                          {days <= 0 ? ' · vence hoy' : ` · en ${days} d`}
                        </small>
                      )}
                    </td>
                    <td style={{ textAlign: 'right' }}>
                      {inv.status !== 'ACCEPTED' && (
                        <button
                          type="button"
                          className={styles.revokeBtn}
                          onClick={() => void onRevoke(inv)}
                          disabled={busy}
                        >
                          Revocar
                        </button>
                      )}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </section>

      <section className={platform.panel}>
        <h2 className={platform.panelTitle}>Miembros activos</h2>
        {team.length === 0 ? (
          <p className={styles.empty}>Sin miembros registrados.</p>
        ) : (
          <table className={platform.table}>
            <thead>
              <tr>
                <th>Usuario</th>
                <th>Rol</th>
                <th>Último acceso</th>
                <th>Estado</th>
              </tr>
            </thead>
            <tbody>
              {team.map((m) => (
                <tr key={m.id}>
                  <td>
                    {m.firstName} {m.lastName}
                    <br />
                    <small>{m.email}</small>
                  </td>
                  <td>{ROLE_LABELS[m.role as Role] ?? m.role}</td>
                  <td>{formatDate(m.lastLogin)}</td>
                  <td>{m.active ? 'Activo' : 'Inactivo'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>
    </div>
  );
}
