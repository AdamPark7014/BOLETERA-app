'use client';

import { Suspense, useEffect, useState } from 'react';
import {
  CORE_PERMISSION_KEYS,
  PermissionKey,
  USER_ROLE_VALUES,
  type PermissionKeyValue,
  type UserRoleValue,
} from '@boletera/shared';
import { ParameterCard, TicketButton } from '@boletera/ui';
import { ApiError, adminApi } from '@/lib/api';
import {
  CAPABILITY_LABELS,
  INVITABLE_ROLES,
  capabilitiesFor,
  hasCapability,
  isKnownRole,
} from '@/lib/permissions';
import { useSession } from '../events/_shared/api-state';
import { AdminFrame } from '../events/_ticket/AdminFrame';
import { Param, SheetSelect } from '../events/_ticket/controls';
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

/** Las ocho llaves de `PermissionKey`. El menú no las pinta. */
const KEY_NAME: Record<PermissionKeyValue, string> = {
  [PermissionKey.EVENTS_READ]: 'Ver eventos',
  [PermissionKey.EVENTS_PUBLISH]: 'Publicar eventos',
  [PermissionKey.ORDERS_REFUND]: 'Reembolsar',
  [PermissionKey.TICKETS_SCAN]: 'Escanear',
  [PermissionKey.VENUES_EDIT]: 'Editar recintos',
  [PermissionKey.REPORTS_READ]: 'Ver reportes',
  [PermissionKey.FINANCE_EXPORT]: 'Exportar finanzas',
  [PermissionKey.PLATFORM_ADMIN]: 'Administrar plataforma',
};

const INVITE = new Set<string>(INVITABLE_ROLES);
const ROLE_OPTIONS = USER_ROLE_VALUES.map((role) => ({ value: role, label: ROLE_NAME[role] }));

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

function roleValue(role: UserRoleValue): string {
  const invite = INVITE.has(role) ? 'Se invita' : 'No se invita';
  if (!isKnownRole(role)) return `Sin secciones · ${invite}`;
  if (capabilitiesFor(role).length === 0) return `Sin acceso · ${invite}`;
  return `Con menú · ${invite}`;
}

function roleEffect(role: UserRoleValue): string {
  if (!isKnownRole(role)) return 'Está en Prisma. El menú no lo reconoce.';
  const caps = capabilitiesFor(role);
  if (caps.length === 0) return 'Está en el menú. No pinta secciones.';
  return caps.map((cap) => CAPABILITY_LABELS[cap]).join(', ');
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
  const menu = USER_ROLE_VALUES.filter((role) => isKnownRole(role));
  const hidden = USER_ROLE_VALUES.filter((role) => !isKnownRole(role));
  const invitable = USER_ROLE_VALUES.filter((role) => INVITE.has(role));

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
        <h1 className={frame.sectionTitle}>Equipo</h1>
        <p className={frame.quiet}>
          Prisma define {USER_ROLE_VALUES.length} roles. El menú reconoce {menu.length}.{' '}
          {hidden.length} quedan en Sin secciones. Se invitan {invitable.length}. Las llaves se
          leen.{' '}
          {session.status === 'loading'
            ? null
            : canAssign
              ? 'Guardar asigna uno de esos roles a una persona del personal.'
              : 'Asignar pide super administrador o quien ya administra el personal.'}
        </p>
      </header>
      <div className={frame.stack}>
        {canAssign ? (
          <>
            <p className={frame.rowTitle}>Personal</p>
            {session.status === 'no-org' ? (
              <p className={frame.quiet}>Sin organización no hay personal que asignar.</p>
            ) : null}
            {loadingPeople ? <p className={frame.quiet}>Cargando personal.</p> : null}
            {peopleError ? (
              <p className={frame.danger} role="alert">
                {peopleError}
              </p>
            ) : null}
            {people && people.length === 0 ? (
              <p className={frame.quiet}>No hay personal en la organización.</p>
            ) : null}
            {people?.map((person) => {
              const draft = drafts[person.id] ?? person.role;
              return (
                <Param key={person.id} name={`${person.firstName} ${person.lastName}`}>
                  <ParameterCard
                    name={`${person.firstName} ${person.lastName}`}
                    value={roleName(draft)}
                    effect={`${person.email}. Se guarda en su rol.`}
                  >
                    <SheetSelect
                      label={`Rol de ${person.firstName} ${person.lastName}`}
                      value={isCatalogRole(draft) ? draft : ''}
                      placeholder={roleName(person.role)}
                      options={ROLE_OPTIONS}
                      onChange={(next) => {
                        if (!isCatalogRole(next)) return;
                        setDrafts((current) => ({ ...current, [person.id]: next }));
                        setNotice(null);
                      }}
                    />
                  </ParameterCard>
                </Param>
              );
            })}
          </>
        ) : null}
        <p className={frame.rowTitle}>Con menú</p>
        {menu.map((role) => (
          <Param key={role} name={ROLE_NAME[role]}>
            <ParameterCard
              name={ROLE_NAME[role]}
              value={roleValue(role)}
              effect={roleEffect(role)}
            />
          </Param>
        ))}
        <p className={frame.rowTitle}>En Prisma, sin menú</p>
        {hidden.map((role) => (
          <Param key={role} name={ROLE_NAME[role]}>
            <ParameterCard
              name={ROLE_NAME[role]}
              value={roleValue(role)}
              effect={roleEffect(role)}
            />
          </Param>
        ))}
        <p className={frame.rowTitle}>Llaves persistidas</p>
        {CORE_PERMISSION_KEYS.map((key) => (
          <Param key={key} name={KEY_NAME[key]}>
            <ParameterCard
              name={KEY_NAME[key]}
              value={key}
              valueStyle="mono"
              effect="Se lee. El API no escribe esta llave."
            />
          </Param>
        ))}
      </div>
      {saveError ? (
        <p className={frame.danger} role="alert">
          {saveError}
        </p>
      ) : null}
      {canAssign ? (
        <div className={frame.saveBar}>
          <p className={frame.quiet} aria-live="polite">
            {changed.length > 0 ? 'Sin guardar' : (notice ?? '')}
          </p>
          <TicketButton disabled={changed.length === 0 || saving} onClick={() => void save()}>
            Guardar sección
          </TicketButton>
        </div>
      ) : null}
    </section>
  );
}
