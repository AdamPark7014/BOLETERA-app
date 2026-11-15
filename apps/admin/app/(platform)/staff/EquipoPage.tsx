'use client';

import Link from 'next/link';
import { Suspense, useEffect, useState } from 'react';
import { USER_ROLE_VALUES, type UserRoleValue } from '@boletera/shared';
import { TicketButton } from '@boletera/ui';
import { ApiError, adminApi, decodeToken } from '@/lib/api';
import {
  CAPABILITY_LABELS,
  INVITABLE_ROLES,
  capabilitiesFor,
  hasCapability,
  isKnownRole,
} from '@/lib/permissions';
import { useSession } from '../events/_shared/api-state';
import { AdminFrame } from '../events/_ticket/AdminFrame';
import { SheetSelect } from '../events/_ticket/controls';
import frame from '../events/_ticket/frame.module.scss';
import { asRecord, readString } from '../events/_ticket/read';

/** Nombres de `UserRole`. No añade roles. */
const ROLE_NAME: Record<UserRoleValue, string> = {
  CUSTOMER: 'Cliente',
  PROMOTER: 'Promotor',
  VENUE_MANAGER: 'Gestor de recinto',
  ARTIST: 'Artista',
  ADMIN: 'Administrador',
  SUPER_ADMIN: 'Super administrador',
  TAQUILLA: 'Taquilla',
  TAQUILLA_SUPERVISOR: 'Supervisor de taquilla',
  TAQUILLA_ADMIN: 'Admin de taquilla',
  SCANNER: 'Escáner',
  FINANCE: 'Finanzas',
  MARKETING: 'Marketing',
  SUPPORT: 'Soporte',
  AUDITOR: 'Auditor',
  AFFILIATE: 'Afiliado',
};

const INVITE = new Set<string>(INVITABLE_ROLES);

/**
 * Espejo de `ROLE_RANK` en apps/api/src/modules/organization/team-role.ts.
 * El API responde 403 a lo que esta tabla no ofrece: nadie concede por encima
 * de su rango, nadie toca a alguien de su rango o mayor, solo SUPER_ADMIN
 * concede o toca SUPER_ADMIN, y nadie se cambia su propio rol.
 */
const ROLE_RANK: Record<UserRoleValue, number> = {
  CUSTOMER: 0,
  AFFILIATE: 1,
  SCANNER: 1,
  TAQUILLA: 2,
  ARTIST: 2,
  SUPPORT: 2,
  TAQUILLA_SUPERVISOR: 3,
  TAQUILLA_ADMIN: 3,
  MARKETING: 3,
  AUDITOR: 3,
  VENUE_MANAGER: 3,
  FINANCE: 4,
  PROMOTER: 4,
  ADMIN: 5,
  SUPER_ADMIN: 6,
};

function rankOf(role: string | null | undefined): number {
  return role && role in ROLE_RANK ? ROLE_RANK[role as UserRoleValue] : 0;
}

function grantableOptions(actorRole: string | null) {
  const isSuper = actorRole === 'SUPER_ADMIN';
  return USER_ROLE_VALUES.filter(
    (role) => isSuper || (role !== 'SUPER_ADMIN' && rankOf(role) <= rankOf(actorRole))
  ).map((role) => ({ value: role, label: ROLE_NAME[role] }));
}

function canModify(actorRole: string | null, actorId: string | null, person: Person): boolean {
  if (actorId && actorId === person.id) return false;
  if (actorRole === 'SUPER_ADMIN') return true;
  if (person.role === 'SUPER_ADMIN') return false;
  return rankOf(person.role) < rankOf(actorRole);
}

type Person = {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
  role: string;
};

function isCatalogRole(role: string): role is UserRoleValue {
  return (USER_ROLE_VALUES as readonly string[]).includes(role);
}

function roleName(role: string): string {
  return isCatalogRole(role) ? ROLE_NAME[role] : role;
}

function readPeople(payload: unknown): Person[] {
  if (!Array.isArray(payload)) return [];
  return payload.flatMap((row) => {
    const record = asRecord(row);
    const id = readString(record.id);
    const email = readString(record.email);
    const firstName = readString(record.firstName);
    const lastName = readString(record.lastName);
    const role = readString(record.role);
    if (!id || !email || !firstName || !lastName || !role) return [];
    return [{ id, email, firstName, lastName, role }];
  });
}

export function EquipoPage() {
  return (
    <Suspense fallback={null}>
      <AdminFrame>
        <EquipoBody />
      </AdminFrame>
    </Suspense>
  );
}

function EquipoBody() {
  const session = useSession();
  // SUPER_ADMIN tiene todas las capacidades. ADMIN es quien ya tiene `org.manage`.
  const canAssign = session.status !== 'loading' && hasCapability(session.role, 'org.manage');
  const [people, setPeople] = useState<Person[] | null>(null);
  const [drafts, setDrafts] = useState<Record<string, string>>({});
  const [loadingPeople, setLoadingPeople] = useState(false);
  const [peopleError, setPeopleError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const token = session.token;
  const orgId = session.orgId;
  const actorId = token ? (decodeToken(token)?.sub ?? null) : null;
  const roleOptions = grantableOptions(session.role);
  const menu = USER_ROLE_VALUES.filter((role) => isKnownRole(role) && role !== 'CUSTOMER');

  useEffect(() => {
    if (!canAssign || !token || !orgId) {
      setPeople(null);
      setDrafts({});
      setLoadingPeople(false);
      return;
    }
    let alive = true;
    setLoadingPeople(true);
    setPeopleError(null);
    adminApi<unknown>(`/organization/${orgId}/team`, token)
      .then((payload) => {
        if (!alive) return;
        const next = readPeople(payload);
        setPeople(next);
        setDrafts(Object.fromEntries(next.map((person) => [person.id, person.role])));
      })
      .catch((cause: unknown) => {
        if (!alive) return;
        setPeople(null);
        setPeopleError(
          cause instanceof ApiError ? cause.userMessage : 'No se pudo leer el personal.'
        );
      })
      .finally(() => {
        if (alive) setLoadingPeople(false);
      });
    return () => {
      alive = false;
    };
  }, [canAssign, token, orgId, nonce]);

  const changed = (people ?? []).filter(
    (person) => isCatalogRole(drafts[person.id] ?? '') && drafts[person.id] !== person.role
  );

  async function save() {
    if (!token || !orgId || changed.length === 0 || saving) return;
    setSaving(true);
    setSaveError(null);
    try {
      for (const person of changed) {
        await adminApi(`/organization/${orgId}/team/${person.id}`, token, {
          method: 'PATCH',
          body: JSON.stringify({ role: drafts[person.id] }),
        });
      }
      setNotice(
        changed
          .map(
            (person) =>
              `${person.firstName} ${person.lastName}: ${roleName(drafts[person.id] ?? '')}`
          )
          .join(' · ')
      );
      setNonce((current) => current + 1);
    } catch (cause) {
      setSaveError(
        cause instanceof ApiError ? cause.userMessage : 'No se guardó. Revisa la conexión.'
      );
      setNonce((current) => current + 1);
    } finally {
      setSaving(false);
    }
  }

  return (
    <section>
      <header className={frame.sectionHead}>
        <h1 className={frame.sectionTitle}>Equipo y permisos</h1>
        <p className={frame.quiet}>
          {people
            ? `${people.length} ${people.length === 1 ? 'persona' : 'personas'} en tu organización. `
            : 'Quién entra al panel y qué puede hacer cada rol. '}
          {session.status === 'loading'
            ? null
            : canAssign
              ? 'Cambia el rol de alguien y guarda.'
              : 'Cambiar roles lo hace quien administra tu organización.'}
        </p>
      </header>
      <div className={frame.stack}>
        {canAssign ? (
          <>
            {session.status === 'no-org' ? (
              <p className={frame.quiet}>Tu cuenta no tiene organización asignada todavía.</p>
            ) : null}
            {peopleError ? (
              <p className={frame.danger} role="alert">
                {peopleError}
              </p>
            ) : null}
            {loadingPeople && !people ? (
              <div
                className={frame.skeleton}
                style={{ height: 240 }}
                aria-label="Cargando equipo"
              />
            ) : null}
            {people && people.length === 0 ? (
              <div className={frame.empty}>
                <p className={frame.emptyTitle}>Aún no hay nadie más en tu equipo</p>
                <p className={frame.quiet}>Invita a tu equipo desde Organización.</p>
                <Link href="/settings/organization" className={frame.goldLink}>
                  Ir a Organización
                </Link>
              </div>
            ) : null}
            {people && people.length > 0 ? (
              <div className={frame.tableWrap}>
                <table className={frame.table}>
                  <thead>
                    <tr>
                      <th scope="col">Persona</th>
                      <th scope="col">Rol</th>
                      <th scope="col">Acceso</th>
                    </tr>
                  </thead>
                  <tbody>
                    {people.map((person) => {
                      const draft = drafts[person.id] ?? person.role;
                      const caps = isKnownRole(draft) ? capabilitiesFor(draft) : [];
                      const dirty = draft !== person.role;
                      return (
                        <tr key={person.id} data-param={`${person.firstName} ${person.lastName}`}>
                          <td>
                            <p className={frame.rowTitle}>
                              {person.firstName} {person.lastName}
                            </p>
                            <p className={frame.rowMeta}>{person.email}</p>
                          </td>
                          <td style={{ minWidth: 220 }}>
                            {canModify(session.role, actorId, person) ? (
                              <SheetSelect
                                label={`Rol de ${person.firstName} ${person.lastName}`}
                                value={isCatalogRole(draft) ? draft : ''}
                                placeholder={roleName(person.role)}
                                options={roleOptions}
                                onChange={(next) => {
                                  if (!isCatalogRole(next)) return;
                                  setDrafts((current) => ({ ...current, [person.id]: next }));
                                  setNotice(null);
                                }}
                              />
                            ) : (
                              <>
                                <p className={frame.rowTitle}>{roleName(person.role)}</p>
                                <p className={frame.rowMeta}>
                                  {actorId === person.id
                                    ? 'Tu propio rol lo cambia otra persona.'
                                    : 'Su rango es igual o mayor que el tuyo.'}
                                </p>
                              </>
                            )}
                          </td>
                          <td>
                            {dirty ? (
                              <span className={frame.chipGold}>Sin guardar</span>
                            ) : caps.length === 0 ? (
                              <span className={frame.chip}>Sin acceso al panel</span>
                            ) : (
                              <span className={frame.chipOk}>
                                {caps.length} {caps.length === 1 ? 'permiso' : 'permisos'}
                              </span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            ) : null}
          </>
        ) : null}

        <h2 className={frame.panelTitle} style={{ marginTop: 12 }}>
          Qué puede hacer cada rol
        </h2>
        <div className={frame.tableWrap}>
          <table className={frame.table}>
            <thead>
              <tr>
                <th scope="col">Rol</th>
                <th scope="col">Puede</th>
              </tr>
            </thead>
            <tbody>
              {menu.map((role) => {
                const caps = capabilitiesFor(role);
                return (
                  <tr key={role} data-param={ROLE_NAME[role]}>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      <p className={frame.rowTitle}>{ROLE_NAME[role]}</p>
                      <p className={frame.rowMeta}>
                        {INVITE.has(role) ? 'Se puede invitar' : 'Lo asigna administración'}
                      </p>
                    </td>
                    <td className={frame.quiet}>
                      {role === 'SUPER_ADMIN'
                        ? 'Todo el panel, en todas las organizaciones.'
                        : caps.length === 0
                          ? 'No entra al panel.'
                          : caps.map((cap) => CAPABILITY_LABELS[cap]).join(' · ')}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
      {saveError ? (
        <p className={frame.danger} role="alert">
          {saveError}
        </p>
      ) : null}
      {canAssign ? (
        <div className={frame.saveBar}>
          <p className={frame.quiet} aria-live="polite">
            {changed.length > 0
              ? `${changed.length} ${changed.length === 1 ? 'cambio' : 'cambios'} sin guardar`
              : (notice ?? '')}
          </p>
          <TicketButton disabled={changed.length === 0 || saving} onClick={() => void save()}>
            {saving ? 'Guardando' : 'Guardar cambios'}
          </TicketButton>
        </div>
      ) : null}
    </section>
  );
}
