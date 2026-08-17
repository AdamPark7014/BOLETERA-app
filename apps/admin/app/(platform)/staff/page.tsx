'use client';

import { useEffect, useMemo, useState } from 'react';
import {
  ActivityFeed,
  Badge,
  Button,
  DataTable,
  DonutChart,
  EmptyState,
  FilterBar,
  formatNumber,
  initialsOf,
  KpiCard,
  PageHeader,
  Section,
  Tabs,
  type ActivityItem,
  type DataTableColumn,
  type FilterDefinition,
  type FilterSelection,
} from '@boletera/ui';
import { QueryError } from '@/components/QueryStates';
import { useToast } from '@/components/Toast/ToastProvider';
import { useAuditLog } from '@/lib/queries/audit';
import {
  useInviteTeamMember,
  useOrganization,
  useTeam,
  type TeamMember,
} from '@/lib/queries/organization';
import { useSession } from '@/lib/use-session';
import { InviteMemberModal, type InvitePayload } from './_components/InviteMemberModal';
import { auditToActivity, loginToActivity, mergeActivity } from './_lib/activity';
import { formatCount, memberDisplayName, relativeLogin } from './_lib/format';
import {
  computeStaffKpis,
  filterTeam,
  roleSlices,
  sortByRecentLogin,
  type MemberStatusFilter,
  type StaffTab,
} from './_lib/roster';
import {
  roleLabel,
  rolePermissions,
  roleSummary,
  roleTone,
  TEAM_ROLES,
} from './_lib/roles';
import styles from './staff.module.scss';

function orgName(data: Record<string, unknown> | undefined): string | null {
  const name = data?.name;
  return typeof name === 'string' && name.trim() ? name : null;
}

function asStatusFilter(values: readonly string[] | undefined): MemberStatusFilter {
  const value = values?.[0];
  if (value === 'active' || value === 'inactive' || value === 'pending') return value;
  return 'all';
}

export default function StaffPage() {
  const { organizationId } = useSession();
  const toast = useToast();

  const orgQuery = useOrganization(organizationId);
  const teamQuery = useTeam(organizationId);
  const auditQuery = useAuditLog(organizationId, 60);
  const inviteMember = useInviteTeamMember(organizationId ?? '');

  const [tab, setTab] = useState<StaffTab>('roster');
  const [inviteOpen, setInviteOpen] = useState(false);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<FilterSelection>({});
  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    const id = window.setInterval(() => setNow(Date.now()), 30_000);
    return () => window.clearInterval(id);
  }, []);

  const team = teamQuery.data ?? [];
  const kpis = useMemo(() => computeStaffKpis(team), [team]);
  const slices = useMemo(() => roleSlices(team), [team]);
  const organizationLabel = orgName(orgQuery.data);

  const filterDefs = useMemo<FilterDefinition[]>(
    () => [
      {
        id: 'status',
        label: 'Estado',
        multiple: false,
        options: [
          { value: 'active', label: 'Activos', count: kpis.active },
          { value: 'inactive', label: 'Inactivos', count: kpis.inactive },
          { value: 'pending', label: 'Sin primer acceso', count: kpis.neverLoggedIn },
        ],
      },
      {
        id: 'role',
        label: 'Rol',
        multiple: false,
        options: TEAM_ROLES.map((role) => ({
          value: role.value,
          label: role.label,
          count: kpis.byRole.find((row) => row.role === role.value)?.count ?? 0,
        })),
      },
    ],
    [kpis],
  );

  const filtered = useMemo(() => {
    const status = asStatusFilter(filters.status);
    const role = filters.role?.[0] ?? 'all';
    return filterTeam(team, { query: search, status, role });
  }, [filters.role, filters.status, search, team]);

  const recentLogins = useMemo(() => sortByRecentLogin(team).slice(0, 8), [team]);

  const activityItems = useMemo<ActivityItem[]>(() => {
    const fromAudit = auditToActivity(auditQuery.data ?? [], 24);
    const fromLogins = loginToActivity(team, 12);
    return mergeActivity(fromAudit, fromLogins, 24);
  }, [auditQuery.data, team]);

  const columns = useMemo<DataTableColumn<TeamMember>[]>(
    () => [
      {
        key: 'member',
        header: 'Miembro',
        width: 260,
        sortValue: (row) => memberDisplayName(row.firstName, row.lastName),
        render: (row) => (
          <div className={styles.memberCell}>
            <span className={styles.avatar} aria-hidden="true">
              {initialsOf(`${row.firstName} ${row.lastName}`)}
            </span>
            <div>
              <strong>{memberDisplayName(row.firstName, row.lastName)}</strong>
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
            {row.active ? (row.lastLogin ? 'Activo' : 'Pendiente') : 'Inactivo'}
          </Badge>
        ),
      },
    ],
    [now],
  );

  const assignmentColumns = useMemo<DataTableColumn<TeamMember>[]>(
    () => [
      {
        key: 'member',
        header: 'Asignación',
        width: 240,
        sortValue: (row) => memberDisplayName(row.firstName, row.lastName),
        render: (row) => (
          <div className={styles.memberCell}>
            <span className={styles.avatar} aria-hidden="true">
              {initialsOf(`${row.firstName} ${row.lastName}`)}
            </span>
            <div>
              <strong>{memberDisplayName(row.firstName, row.lastName)}</strong>
              <span>{row.email}</span>
            </div>
          </div>
        ),
      },
      {
        key: 'role',
        header: 'Rol efectivo',
        width: 140,
        sortValue: (row) => row.role,
        render: (row) => (
          <Badge tone={roleTone(row.role)} variant="outline" size="sm">
            {roleLabel(row.role)}
          </Badge>
        ),
      },
      {
        key: 'permissions',
        header: 'Permisos del rol',
        render: (row) => (
          <ul className={styles.permList}>
            {rolePermissions(row.role).map((perm) => (
              <li key={perm}>
                <Badge tone="neutral" variant="outline" size="sm">
                  {perm}
                </Badge>
              </li>
            ))}
          </ul>
        ),
      },
      {
        key: 'active',
        header: 'Vigente',
        width: 110,
        sortValue: (row) => (row.active ? 1 : 0),
        render: (row) => (
          <Badge tone={row.active ? 'success' : 'danger'} variant="soft" size="sm" dot>
            {row.active ? 'Sí' : 'No'}
          </Badge>
        ),
      },
    ],
    [],
  );

  async function onInvite(payload: InvitePayload) {
    if (!organizationId) return;
    const member = await inviteMember.mutateAsync({
      ...payload,
      email: payload.email.trim().toLowerCase(),
      firstName: payload.firstName.trim(),
      lastName: payload.lastName.trim(),
    });
    toast.success(
      `${member.firstName} ${member.lastName} invitado como ${roleLabel(member.role)}`,
    );
    setInviteOpen(false);
    setTab('roster');
  }

  const error = teamQuery.error ?? orgQuery.error;
  const loading = teamQuery.isPending;

  if (!organizationId) {
    return (
      <div className={styles.page}>
        <EmptyState
          title="Sin organización"
          description="Inicia sesión con una cuenta vinculada a una organización para gestionar personal."
        />
      </div>
    );
  }

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Operaciones · Personal"
        title="Staff"
        description={
          organizationLabel
            ? `Roster, roles y asignaciones de ${organizationLabel}.`
            : 'Roster, roles, asignaciones, actividad e invitaciones del equipo.'
        }
        actions={
          <Button type="button" onClick={() => setInviteOpen(true)}>
            Invitar miembro
          </Button>
        }
      />

      <Section columns={4} gap="sm" aria-label="Indicadores de staff">
        <KpiCard
          label="Miembros"
          value={formatCount(kpis.total)}
          loading={loading}
          hint={`${formatCount(kpis.active)} activos`}
          tone="accent"
        />
        <KpiCard
          label="Roles en uso"
          value={formatCount(kpis.rolesInUse)}
          loading={loading}
          hint={`${formatCount(TEAM_ROLES.length)} en catálogo`}
          tone="info"
        />
        <KpiCard
          label="Sin primer acceso"
          value={formatCount(kpis.neverLoggedIn)}
          loading={loading}
          hint="Invitaciones pendientes"
          tone={kpis.neverLoggedIn > 0 ? 'warning' : 'success'}
        />
        <KpiCard
          label="Inactivos"
          value={formatCount(kpis.inactive)}
          loading={loading}
          hint="Cuentas deshabilitadas"
          tone={kpis.inactive > 0 ? 'danger' : 'neutral'}
        />
      </Section>

      {(kpis.inactive > 0 || kpis.neverLoggedIn > 0) && (
        <div className={styles.alerts} aria-label="Alertas de personal">
          {kpis.neverLoggedIn > 0 ? (
            <div className={`${styles.alert} ${styles.alertInfo}`} role="status">
              {formatNumber(kpis.neverLoggedIn)} invitación
              {kpis.neverLoggedIn === 1 ? '' : 'es'} sin primer inicio de sesión.
            </div>
          ) : null}
          {kpis.inactive > 0 ? (
            <div className={`${styles.alert} ${styles.alertWarning}`} role="status">
              {formatNumber(kpis.inactive)} miembro
              {kpis.inactive === 1 ? '' : 's'} inactivo
              {kpis.inactive === 1 ? '' : 's'}. Revisa asignaciones de acceso.
            </div>
          ) : null}
        </div>
      )}

      <Tabs
        label="Secciones de staff"
        value={tab}
        onValueChange={(id) => {
          if (id === 'roster' || id === 'roles' || id === 'assignments' || id === 'activity') {
            setTab(id);
          }
        }}
        items={[
          { id: 'roster', label: 'Roster', badge: formatCount(kpis.total) },
          { id: 'roles', label: 'Roles' },
          { id: 'assignments', label: 'Asignaciones', badge: formatCount(kpis.active) },
          { id: 'activity', label: 'Actividad' },
        ]}
      />

      {error ? (
        <QueryError
          error={error}
          onRetry={() => {
            void teamQuery.refetch();
            void orgQuery.refetch();
            void auditQuery.refetch();
          }}
        />
      ) : null}

      {!error && tab === 'roster' ? (
        <div className={styles.layout}>
          <div className={styles.stack}>
            <FilterBar
              filters={filterDefs}
              value={filters}
              onChange={setFilters}
              search={{
                value: search,
                onChange: setSearch,
                placeholder: 'Buscar por nombre, email o rol',
              }}
            />
            {filtered.length === 0 && !loading ? (
              <div className={styles.card}>
                <EmptyState
                  title="Sin miembros en el filtro"
                  description="Ajusta la búsqueda o invita a alguien al equipo."
                  illustration="inbox"
                  action={
                    <Button type="button" onClick={() => setInviteOpen(true)}>
                      Invitar miembro
                    </Button>
                  }
                />
              </div>
            ) : (
              <DataTable
                label="Roster de personal"
                columns={columns}
                data={filtered}
                rowKey={(row) => row.id}
                loading={loading && team.length === 0}
                maxHeight={480}
                empty={
                  <EmptyState
                    title="Sin personal"
                    description="Cuando invites miembros aparecerán en el roster."
                    illustration="inbox"
                  />
                }
              />
            )}
          </div>

          <aside className={styles.stack}>
            <div className={styles.card}>
              <div className={styles.cardHead}>
                <div>
                  <h2>Distribución por rol</h2>
                  <p>Asignaciones reales del equipo.</p>
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
            </div>

            <div className={styles.card}>
              <div className={styles.cardHead}>
                <div>
                  <h2>Accesos recientes</h2>
                  <p>Últimos inicios de sesión del roster.</p>
                </div>
              </div>
              {recentLogins.length === 0 ? (
                <p className={styles.muted}>Aún no hay accesos registrados.</p>
              ) : (
                <ul className={styles.sideList}>
                  {recentLogins.map((member) => (
                    <li key={member.id} className={styles.sideRow}>
                      <div className={styles.sideMeta}>
                        <strong>{memberDisplayName(member.firstName, member.lastName)}</strong>
                        <span>{roleLabel(member.role)}</span>
                      </div>
                      <Badge
                        tone={member.lastLogin ? 'success' : 'warning'}
                        variant="outline"
                        size="sm"
                      >
                        {relativeLogin(member.lastLogin, now)}
                      </Badge>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </aside>
        </div>
      ) : null}

      {!error && tab === 'roles' ? (
        <div className={styles.stack}>
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <div>
                <h2>Catálogo de roles</h2>
                <p>Permisos efectivos por rol y cobertura actual en el equipo.</p>
              </div>
            </div>
            <div className={styles.roleGrid}>
              {TEAM_ROLES.map((role) => {
                const count = kpis.byRole.find((row) => row.role === role.value)?.count ?? 0;
                return (
                  <article key={role.value} className={styles.roleCard}>
                    <div className={styles.roleCardHead}>
                      <div>
                        <h3 className={styles.roleCardTitle}>{role.label}</h3>
                        <p className={styles.roleCardSummary}>{role.summary}</p>
                      </div>
                      <Badge tone={role.tone} variant="soft" size="sm">
                        {formatCount(count)}
                      </Badge>
                    </div>
                    <ul className={styles.permList}>
                      {role.permissions.map((perm) => (
                        <li key={perm}>
                          <Badge tone="neutral" variant="outline" size="sm">
                            {perm}
                          </Badge>
                        </li>
                      ))}
                    </ul>
                  </article>
                );
              })}
            </div>
          </div>
        </div>
      ) : null}

      {!error && tab === 'assignments' ? (
        <div className={styles.stack}>
          <FilterBar
            filters={filterDefs}
            value={filters}
            onChange={setFilters}
            search={{
              value: search,
              onChange: setSearch,
              placeholder: 'Filtrar asignaciones',
            }}
          />
          {filtered.length === 0 && !loading ? (
            <div className={styles.card}>
              <EmptyState
                title="Sin asignaciones"
                description="No hay miembros que coincidan con el filtro."
                illustration="inbox"
              />
            </div>
          ) : (
            <DataTable
              label="Asignaciones de rol"
              columns={assignmentColumns}
              data={filtered}
              rowKey={(row) => row.id}
              loading={loading && team.length === 0}
              maxHeight={480}
              empty={
                <EmptyState
                  title="Sin asignaciones"
                  description="Las asignaciones de rol aparecen cuando hay miembros en el equipo."
                  illustration="inbox"
                />
              }
            />
          )}
          <p className={styles.muted}>
            Cada fila refleja el rol efectivo del miembro y el paquete de permisos del catálogo
            ({roleSummary('ADMIN').toLowerCase()} para admin, etc.).
          </p>
        </div>
      ) : null}

      {!error && tab === 'activity' ? (
        <div className={styles.layout}>
          <div className={styles.card}>
            <div className={styles.cardHead}>
              <div>
                <h2>Actividad del equipo</h2>
                <p>Inicios de sesión y eventos de auditoría relacionados con personal.</p>
              </div>
            </div>
            {activityItems.length === 0 ? (
              <div className={styles.emptyPad}>
                <EmptyState
                  title="Sin actividad reciente"
                  description="Cuando el equipo inicie sesión o se invite a alguien, verás la bitácora aquí."
                  size="sm"
                />
              </div>
            ) : (
              <ActivityFeed items={activityItems} />
            )}
          </div>
          <aside className={styles.card}>
            <div className={styles.cardHead}>
              <div>
                <h2>Resumen</h2>
                <p>Estado operativo del roster.</p>
              </div>
            </div>
            <ul className={styles.sideList}>
              <li className={styles.sideRow}>
                <span>Activos</span>
                <strong>{formatCount(kpis.active)}</strong>
              </li>
              <li className={styles.sideRow}>
                <span>Pendientes de acceso</span>
                <strong>{formatCount(kpis.neverLoggedIn)}</strong>
              </li>
              <li className={styles.sideRow}>
                <span>Inactivos</span>
                <strong>{formatCount(kpis.inactive)}</strong>
              </li>
              <li className={styles.sideRow}>
                <span>Roles ocupados</span>
                <strong>{formatCount(kpis.rolesInUse)}</strong>
              </li>
            </ul>
          </aside>
        </div>
      ) : null}

      <InviteMemberModal
        open={inviteOpen}
        busy={inviteMember.isPending}
        onClose={() => setInviteOpen(false)}
        onSubmit={onInvite}
      />
    </div>
  );
}
