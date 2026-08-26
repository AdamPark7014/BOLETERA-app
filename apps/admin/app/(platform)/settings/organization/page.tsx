'use client';

/**
 * Perfil de organización, equipo, roles e invitaciones.
 *
 * Tras el cambio de SSO, un usuario nuevo entra como CUSTOMER y solo se eleva si
 * existe una invitación viva. Esta pantalla es el único camino del producto para
 * dar de alta a un promotor: sin ella, la alta de personal exigía tocar la base
 * de datos a mano.
 */

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import {
  ActivityFeed,
  Badge,
  Button,
  DataTable,
  DonutChart,
  EmptyState,
  FilterBar,
  Input,
  KpiCard,
  PageHeader,
  Section,
  SegmentedControl,
  Tabs,
  type DataTableColumn,
  type FilterDefinition,
} from '@boletera/ui';
import { QueryError } from '@/components/QueryStates';
import { useToast } from '@/components/Toast/ToastProvider';
import { ApiError } from '@/lib/api';
import { useAuditLog } from '@/lib/queries/audit';
import {
  useOrganization,
  useTeam,
  useUpdateOrganization,
  type TeamMember,
} from '@/lib/queries/organization';
import { ROLE_LABELS, invitableRolesFor, type Role } from '@/lib/permissions';
import {
  createInvitation,
  listInvitations,
  revokeInvitation,
  type Invitation,
} from '@/lib/platform-api';
import { useSession } from '@/lib/use-session';
import { toActivityItems } from './_lib/audit';
import { formatCommission, formatCount, relativeLogin } from './_lib/format';
import { TEAM_ROLES, roleLabel, rolePermissions, roleTone } from './_lib/roles';
import { computeTeamKpis, filterTeam, roleSlices } from './_lib/team';
import {
  isOrganizationProfile,
  profileFromOrg,
  type ProfileForm,
} from './_lib/types';
import { useOrgUrlState } from './_lib/use-org-url-state';
import styles from './organization.module.scss';

const INVITATION_STATUS_LABELS: Record<Invitation['status'], string> = {
  PENDING: 'Pendiente',
  ACCEPTED: 'Aceptada',
  EXPIRED: 'Vencida',
};

const EXPIRES_OPTIONS = [
  { value: '1', label: '1 día' },
  { value: '7', label: '7 días' },
  { value: '14', label: '14 días' },
  { value: '30', label: '30 días' },
  { value: '90', label: '90 días' },
] as const;

type InvitationTab = 'pending' | 'all';

function formatDate(iso: string | null): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('es-MX', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
  });
}

function daysUntil(iso: string): number {
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

function invitationTone(status: Invitation['status']) {
  if (status === 'PENDING') return 'warning' as const;
  if (status === 'ACCEPTED') return 'success' as const;
  return 'neutral' as const;
}

export default function OrganizationSettingsPage() {
  const { token, organizationId, role, can } = useSession();
  const toast = useToast();
  const url = useOrgUrlState();

  const orgQuery = useOrganization(organizationId);
  const teamQuery = useTeam(organizationId);
  const auditQuery = useAuditLog(organizationId, 40);
  const updateOrg = useUpdateOrganization(organizationId ?? '');

  const [profileForm, setProfileForm] = useState<ProfileForm | null>(null);
  const [invitations, setInvitations] = useState<Invitation[]>([]);
  const [invitesLoading, setInvitesLoading] = useState(true);
  const [inviteBusy, setInviteBusy] = useState(false);
  const [inviteTab, setInviteTab] = useState<InvitationTab>('pending');
  const [inviteForm, setInviteForm] = useState({
    email: '',
    role: 'TAQUILLA' as Role,
    expiresInDays: 7,
  });
  const [now, setNow] = useState(() => Date.now());

  const allowedRoles = useMemo(() => invitableRolesFor(role), [role]);

  useEffect(() => {
    if (allowedRoles.length && !allowedRoles.includes(inviteForm.role)) {
      setInviteForm((current) => ({
        ...current,
        role: allowedRoles[allowedRoles.length - 1],
      }));
    }
  }, [allowedRoles, inviteForm.role]);

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const org = useMemo(() => {
    const data = orgQuery.data;
    return isOrganizationProfile(data) ? data : null;
  }, [orgQuery.data]);

  useEffect(() => {
    if (!org) return;
    setProfileForm(profileFromOrg(org));
  }, [org]);

  const reloadInvitations = useCallback(async () => {
    if (!token || !organizationId) return;
    setInvitesLoading(true);
    try {
      const rows = await listInvitations(token, organizationId);
      setInvitations(rows);
    } catch (err) {
      toast.error(
        err instanceof ApiError ? err.userMessage : 'No se pudieron cargar las invitaciones.',
      );
    } finally {
      setInvitesLoading(false);
    }
  }, [organizationId, toast, token]);

  useEffect(() => {
    void reloadInvitations();
  }, [reloadInvitations]);

  const team = teamQuery.data ?? [];
  const kpis = useMemo(() => computeTeamKpis(team), [team]);
  const slices = useMemo(() => roleSlices(team), [team]);

  const pendingInvitations = useMemo(
    () => invitations.filter((inv) => inv.status === 'PENDING'),
    [invitations],
  );
  const shownInvitations = inviteTab === 'pending' ? pendingInvitations : invitations;

  const filterDefs = useMemo<FilterDefinition[]>(
    () => [
      {
        id: 'status',
        label: 'Estado',
        multiple: false,
        options: [
          { value: 'active', label: 'Activos', count: kpis.active },
          { value: 'inactive', label: 'Inactivos', count: kpis.inactive },
        ],
      },
      {
        id: 'role',
        label: 'Rol',
        multiple: false,
        options: TEAM_ROLES.map((teamRole) => ({
          value: teamRole.value,
          label: teamRole.label,
          count: kpis.byRole.find((row) => row.role === teamRole.value)?.count ?? 0,
        })),
      },
    ],
    [kpis],
  );

  const filteredTeam = useMemo(
    () =>
      filterTeam(team, {
        query: url.q,
        status: url.status,
        role: url.role,
      }),
    [team, url.q, url.role, url.status],
  );

  const activityItems = useMemo(
    () => toActivityItems(auditQuery.data ?? [], 24),
    [auditQuery.data],
  );

  const onRevoke = useCallback(
    async (inv: Invitation) => {
      if (!token) return;
      if (!window.confirm(`¿Revocar la invitación de ${inv.email}?`)) return;
      setInviteBusy(true);
      try {
        await revokeInvitation(token, inv.id);
        toast.success(`Invitación de ${inv.email} revocada.`);
        await reloadInvitations();
      } catch (err) {
        toast.error(err instanceof ApiError ? err.userMessage : 'No se pudo revocar.');
      } finally {
        setInviteBusy(false);
      }
    },
    [reloadInvitations, toast, token],
  );

  const memberColumns = useMemo<DataTableColumn<TeamMember>[]>(
    () => [
      {
        key: 'member',
        header: 'Miembro',
        width: 260,
        sortValue: (row) => `${row.firstName} ${row.lastName}`,
        render: (row) => (
          <div className={styles.memberCell}>
            <div className={styles.memberMeta}>
              <strong>
                {row.firstName} {row.lastName}
              </strong>
              <span>{row.email}</span>
            </div>
          </div>
        ),
      },
      {
        key: 'role',
        header: 'Rol',
        width: 140,
        sortValue: (row) => row.role,
        render: (row) => (
          <Badge tone={roleTone(row.role)} variant="soft" size="sm">
            {roleLabel(row.role)}
          </Badge>
        ),
      },
      {
        key: 'lastLogin',
        header: 'Último acceso',
        width: 150,
        sortValue: (row) => (row.lastLogin ? new Date(row.lastLogin).getTime() : 0),
        render: (row) =>
          row.lastLogin ? (
            relativeLogin(row.lastLogin, now)
          ) : (
            <span className={styles.muted}>Sin acceso</span>
          ),
      },
      {
        key: 'status',
        header: 'Estado',
        width: 120,
        sortValue: (row) => (row.active ? 1 : 0),
        render: (row) => (
          <Badge tone={row.active ? 'success' : 'neutral'} variant="soft" size="sm" dot>
            {row.active ? 'Activo' : 'Inactivo'}
          </Badge>
        ),
      },
    ],
    [now],
  );

  const invitationColumns = useMemo<DataTableColumn<Invitation>[]>(
    () => [
      {
        key: 'email',
        header: 'Correo',
        width: 220,
        sortValue: (row) => row.email,
        render: (row) => row.email,
      },
      {
        key: 'role',
        header: 'Rol',
        width: 140,
        sortValue: (row) => row.role,
        render: (row) => (
          <Badge tone={roleTone(row.role)} variant="outline" size="sm">
            {ROLE_LABELS[row.role as Role] ?? row.role}
          </Badge>
        ),
      },
      {
        key: 'status',
        header: 'Estado',
        width: 120,
        sortValue: (row) => row.status,
        render: (row) => (
          <Badge tone={invitationTone(row.status)} variant="soft" size="sm">
            {INVITATION_STATUS_LABELS[row.status]}
          </Badge>
        ),
      },
      {
        key: 'expiresAt',
        header: 'Vence',
        width: 150,
        sortValue: (row) => new Date(row.expiresAt).getTime(),
        render: (row) => {
          const days = daysUntil(row.expiresAt);
          return (
            <>
              {formatDate(row.expiresAt)}
              {row.status === 'PENDING' && days <= 2 ? (
                <span className={styles.expirySoon}>
                  {days <= 0 ? '· vence hoy' : `· en ${days} d`}
                </span>
              ) : null}
            </>
          );
        },
      },
      {
        key: 'actions',
        header: '',
        width: 110,
        align: 'right',
        render: (row) =>
          row.status !== 'ACCEPTED' ? (
            <Button
              type="button"
              variant="ghost"
              size="sm"
              disabled={inviteBusy}
              onClick={() => void onRevoke(row)}
            >
              Revocar
            </Button>
          ) : null,
      },
    ],
    [inviteBusy, onRevoke],
  );

  async function onSaveProfile(event: FormEvent) {
    event.preventDefault();
    if (!profileForm || !organizationId) return;
    try {
      await updateOrg.mutateAsync({
        name: profileForm.name.trim(),
        description: profileForm.description.trim() || undefined,
        website: profileForm.website.trim() || undefined,
        email: profileForm.email.trim() || undefined,
        phone: profileForm.phone.trim() || undefined,
        allowResale: profileForm.allowResale,
      });
      toast.success('Perfil de organización actualizado.');
    } catch (err) {
      toast.error(err instanceof ApiError ? err.userMessage : 'No se pudo guardar el perfil.');
    }
  }

  async function onInvite(event: FormEvent) {
    event.preventDefault();
    if (!token || !organizationId) return;
    setInviteBusy(true);
    try {
      const created = await createInvitation(token, {
        organizationId,
        email: inviteForm.email.trim().toLowerCase(),
        role: inviteForm.role,
        expiresInDays: inviteForm.expiresInDays,
      });
      toast.success(
        `Invitación enviada a ${created.email} como ${ROLE_LABELS[created.role as Role] ?? created.role}.`,
      );
      setInviteForm((current) => ({ ...current, email: '' }));
      await reloadInvitations();
      void teamQuery.refetch();
    } catch (err) {
      toast.error(err instanceof ApiError ? err.userMessage : 'No se pudo crear la invitación.');
    } finally {
      setInviteBusy(false);
    }
  }

  const error = orgQuery.error ?? teamQuery.error ?? auditQuery.error;
  const loadingTeam = teamQuery.isPending;

  if (!can('org.manage')) {
    return (
      <div className={styles.page}>
        <PageHeader
          eyebrow="Configuración"
          title="Organización"
          description="Perfil, equipo, roles e invitaciones de la cuenta."
        />
        <EmptyState
          title="Sin permisos"
          description="Tu rol no permite administrar la organización ni el equipo."
        />
      </div>
    );
  }

  if (!organizationId) {
    return (
      <div className={styles.page}>
        <EmptyState
          title="Sin organización"
          description="Inicia sesión con una cuenta vinculada a una organización."
        />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Configuración"
        title="Organización"
        description={
          org?.name
            ? `Perfil, equipo e invitaciones de ${org.name}.`
            : 'Perfil de la cuenta, invitaciones por correo y miembros activos.'
        }
      />

      <Section columns={4} gap="sm" aria-label="Indicadores del equipo">
        <KpiCard
          label="Miembros"
          value={formatCount(kpis.total)}
          loading={loadingTeam}
          hint={`${formatCount(kpis.active)} activos`}
          tone="accent"
        />
        <KpiCard
          label="Invitaciones pendientes"
          value={formatCount(pendingInvitations.length)}
          loading={invitesLoading}
          hint="Por correo, sin aceptar"
          tone={pendingInvitations.length > 0 ? 'warning' : 'success'}
        />
        <KpiCard
          label="Sin primer acceso"
          value={formatCount(kpis.neverLoggedIn)}
          loading={loadingTeam}
          hint="Cuentas sin login"
          tone={kpis.neverLoggedIn > 0 ? 'warning' : 'neutral'}
        />
        <KpiCard
          label="Eventos"
          value={formatCount(org?._count?.events ?? 0)}
          loading={orgQuery.isPending}
          hint={`${formatCount(org?._count?.venues ?? 0)} venues`}
          tone="info"
        />
      </Section>

      <div className={styles.tabsSlot}>
        <Tabs
          label="Secciones de organización"
          value={url.tab}
          onValueChange={(id) => {
            if (id === 'profile' || id === 'team' || id === 'roles' || id === 'audit') {
              url.setTab(id);
            }
          }}
          items={[
            { id: 'profile', label: 'Perfil' },
            { id: 'team', label: 'Equipo', badge: formatCount(kpis.total) },
            { id: 'roles', label: 'Roles' },
            {
              id: 'audit',
              label: 'Auditoría',
              badge: can('audit.view') ? formatCount(activityItems.length) : undefined,
            },
          ]}
        />
      </div>

      {error ? (
        <QueryError
          error={error}
          onRetry={() => {
            void orgQuery.refetch();
            void teamQuery.refetch();
            void auditQuery.refetch();
            void reloadInvitations();
          }}
        />
      ) : null}

      {!error && url.tab === 'profile' ? (
        <div className={styles.profileGrid}>
          <section className={styles.card}>
            <div className={styles.cardHead}>
              <div>
                <h2>Perfil público</h2>
                <p>Datos visibles en la ficha de la organización y en comunicaciones.</p>
              </div>
              {org?.verified ? (
                <span className={styles.verifiedPill}>
                  <Badge tone="success" variant="soft" size="sm" dot>
                    Verificada
                  </Badge>
                </span>
              ) : null}
            </div>

            {profileForm ? (
              <form className={styles.formGrid} onSubmit={(e) => void onSaveProfile(e)}>
                <Input
                  label="Nombre"
                  requiredMark
                  required
                  value={profileForm.name}
                  onChange={(e) =>
                    setProfileForm((current) =>
                      current ? { ...current, name: e.target.value } : current,
                    )
                  }
                />
                <Input
                  label="Descripción"
                  value={profileForm.description}
                  onChange={(e) =>
                    setProfileForm((current) =>
                      current ? { ...current, description: e.target.value } : current,
                    )
                  }
                />
                <div className={styles.fieldRow}>
                  <Input
                    label="Sitio web"
                    type="url"
                    value={profileForm.website}
                    onChange={(e) =>
                      setProfileForm((current) =>
                        current ? { ...current, website: e.target.value } : current,
                      )
                    }
                  />
                  <Input
                    label="Correo de contacto"
                    type="email"
                    value={profileForm.email}
                    onChange={(e) =>
                      setProfileForm((current) =>
                        current ? { ...current, email: e.target.value } : current,
                      )
                    }
                  />
                </div>
                <div className={styles.fieldRow}>
                  <Input
                    label="Teléfono"
                    type="tel"
                    value={profileForm.phone}
                    onChange={(e) =>
                      setProfileForm((current) =>
                        current ? { ...current, phone: e.target.value } : current,
                      )
                    }
                  />
                  <label className={styles.checkRow}>
                    <input
                      type="checkbox"
                      checked={profileForm.allowResale}
                      onChange={(e) =>
                        setProfileForm((current) =>
                          current ? { ...current, allowResale: e.target.checked } : current,
                        )
                      }
                    />
                    Permitir reventa en el marketplace
                  </label>
                </div>
                <div>
                  <Button
                    type="submit"
                    loading={updateOrg.isPending}
                    loadingLabel="Guardando…"
                  >
                    Guardar cambios
                  </Button>
                </div>
              </form>
            ) : (
              <p className={styles.muted}>Cargando perfil…</p>
            )}
          </section>

          <aside className={styles.card}>
            <div className={styles.cardHead}>
              <div>
                <h2>Resumen</h2>
                <p>Identificadores y métricas de la cuenta.</p>
              </div>
            </div>
            <ul className={styles.statsList}>
              <li className={styles.statRow}>
                <span>Slug</span>
                <strong>{org?.slug ?? '—'}</strong>
              </li>
              <li className={styles.statRow}>
                <span>Comisión plataforma</span>
                <strong>{formatCommission(org?.commissionRate)}</strong>
              </li>
              <li className={styles.statRow}>
                <span>Órdenes</span>
                <strong>{formatCount(org?._count?.orders ?? 0)}</strong>
              </li>
              <li className={styles.statRow}>
                <span>Usuarios</span>
                <strong>{formatCount(org?._count?.users ?? 0)}</strong>
              </li>
              <li className={styles.statRow}>
                <span>Venues</span>
                <strong>{formatCount(org?._count?.venues ?? 0)}</strong>
              </li>
            </ul>
          </aside>
        </div>
      ) : null}

      {!error && url.tab === 'team' ? (
        <div className={styles.layout}>
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <div>
                <h2>Invitar al equipo</h2>
                <p>
                  Invita por correo con un rol. El usuario se eleva al aceptar; sin invitación
                  viva, quien entra por SSO queda como cliente sin acceso.
                </p>
              </div>
            </div>
            <form className={styles.inviteRow} onSubmit={(e) => void onInvite(e)}>
              <Input
                label="Correo"
                type="email"
                requiredMark
                required
                placeholder="persona@empresa.com"
                value={inviteForm.email}
                onChange={(e) => setInviteForm({ ...inviteForm, email: e.target.value })}
              />
              <label className={styles.selectField}>
                <span>Rol</span>
                <select
                  className={styles.roleSelect}
                  value={inviteForm.role}
                  onChange={(e) =>
                    setInviteForm({ ...inviteForm, role: e.target.value as Role })
                  }
                >
                  {allowedRoles.map((teamRole) => (
                    <option key={teamRole} value={teamRole}>
                      {ROLE_LABELS[teamRole]}
                    </option>
                  ))}
                </select>
              </label>
              <label className={styles.selectField}>
                <span>Vence en</span>
                <select
                  className={styles.roleSelect}
                  value={String(inviteForm.expiresInDays)}
                  onChange={(e) =>
                    setInviteForm({ ...inviteForm, expiresInDays: Number(e.target.value) })
                  }
                >
                  {EXPIRES_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              <Button
                type="submit"
                loading={inviteBusy}
                loadingLabel="Enviando…"
                disabled={!inviteForm.email}
              >
                Enviar invitación
              </Button>
            </form>
            <p className={styles.inviteHint}>
              El rol determina qué ve la persona en el backoffice. No puedes otorgar un rol por
              encima del tuyo.
            </p>
          </div>

          <div className={styles.card}>
            <div className={styles.panelToolbar}>
              <div className={styles.cardHead}>
                <div>
                  <h2>Invitaciones</h2>
                  <p>Seguimiento de enlaces enviados por correo.</p>
                </div>
              </div>
              <SegmentedControl
                label="Filtro de invitaciones"
                size="sm"
                options={[
                  { value: 'pending', label: `Pendientes (${pendingInvitations.length})` },
                  { value: 'all', label: `Todas (${invitations.length})` },
                ]}
                value={inviteTab}
                onValueChange={(value) => setInviteTab(value as InvitationTab)}
              />
            </div>
            <DataTable
              label="Invitaciones del equipo"
              columns={invitationColumns}
              data={shownInvitations}
              rowKey={(row) => row.id}
              loading={invitesLoading && invitations.length === 0}
              maxHeight={320}
              empty={
                <EmptyState
                  title={
                    inviteTab === 'pending'
                      ? 'No hay invitaciones pendientes'
                      : 'Sin invitaciones enviadas'
                  }
                  description="Cuando invites a alguien por correo, aparecerá aquí."
                  size="sm"
                />
              }
            />
          </div>

          <div className={styles.card}>
            <div className={styles.cardHead}>
              <div>
                <h2>Miembros activos</h2>
                <p>Usuarios con rol en la organización.</p>
              </div>
            </div>
            <div className={styles.filters}>
              <FilterBar
                filters={filterDefs}
                value={{
                  status: url.status === 'all' ? [] : [url.status],
                  role: url.role === 'all' ? [] : [url.role],
                }}
                onChange={(selection) => {
                  url.setStatus(
                    (selection.status?.[0] as 'active' | 'inactive' | undefined) ?? 'all',
                  );
                  url.setRole(selection.role?.[0] ?? 'all');
                }}
                search={{
                  value: url.q,
                  onChange: url.setSearch,
                  placeholder: 'Buscar por nombre, email o rol',
                }}
              />
            </div>
            <DataTable
              label="Miembros del equipo"
              columns={memberColumns}
              data={filteredTeam}
              rowKey={(row) => row.id}
              loading={loadingTeam && team.length === 0}
              maxHeight={420}
              empty={
                <EmptyState
                  title="Sin miembros en el filtro"
                  description="Ajusta la búsqueda o envía una invitación."
                  size="sm"
                />
              }
            />
          </div>

          <aside className={styles.card}>
            <div className={styles.cardHead}>
              <div>
                <h2>Distribución por rol</h2>
                <p>Composición actual del equipo.</p>
              </div>
            </div>
            {slices.length === 0 ? (
              <EmptyState
                title="Sin roles asignados"
                description="Invita personal para ver la composición."
                size="sm"
              />
            ) : (
              <DonutChart
                label="Miembros por rol"
                slices={slices}
                centerLabel="Total"
                height={220}
              />
            )}
          </aside>
        </div>
      ) : null}

      {!error && url.tab === 'roles' ? (
        <section className={styles.card}>
          <div className={styles.cardHead}>
            <div>
              <h2>Matriz de roles</h2>
              <p>Permisos efectivos por rol en el backoffice.</p>
            </div>
          </div>
          <div className={styles.matrix}>
            {TEAM_ROLES.map((teamRole) => {
              const count = kpis.byRole.find((row) => row.role === teamRole.value)?.count ?? 0;
              return (
                <article key={teamRole.value} className={styles.matrixRow}>
                  <div className={styles.matrixRole}>
                    <Badge tone={teamRole.tone} variant="soft" size="sm">
                      {teamRole.label}
                    </Badge>
                    <p className={styles.muted}>{formatCount(count)} en equipo</p>
                  </div>
                  <div className={styles.permChips}>
                    {rolePermissions(teamRole.value).map((perm) => (
                      <Badge key={perm} tone="neutral" variant="outline" size="sm">
                        {perm}
                      </Badge>
                    ))}
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      ) : null}

      {!error && url.tab === 'audit' ? (
        can('audit.view') ? (
          <section className={styles.card}>
            <div className={styles.cardHead}>
              <div>
                <h2>Bitácora</h2>
                <p>Eventos recientes de la organización.</p>
              </div>
            </div>
            {activityItems.length === 0 ? (
              <div className={styles.emptyPad}>
                <EmptyState
                  title="Sin actividad reciente"
                  description="Los cambios de perfil, invitaciones y equipo aparecerán aquí."
                  size="sm"
                />
              </div>
            ) : (
              <ActivityFeed items={activityItems} />
            )}
          </section>
        ) : (
          <EmptyState
            title="Sin acceso a auditoría"
            description="Tu rol no incluye la bitácora de la organización."
          />
        )
      ) : null}
    </div>
  );
}
