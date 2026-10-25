'use client';

import { Suspense } from 'react';
import {
  CORE_PERMISSION_KEYS,
  PermissionKey,
  USER_ROLE_VALUES,
  type PermissionKeyValue,
  type UserRoleValue,
} from '@boletera/shared';
import { ParameterCard } from '@boletera/ui';
import {
  CAPABILITY_LABELS,
  INVITABLE_ROLES,
  capabilitiesFor,
  isKnownRole,
} from '@/lib/permissions';
import { AdminFrame } from '../events/_ticket/AdminFrame';
import { Param } from '../events/_ticket/controls';
import frame from '../events/_ticket/frame.module.scss';

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
  const menu = USER_ROLE_VALUES.filter((role) => isKnownRole(role));
  const hidden = USER_ROLE_VALUES.filter((role) => !isKnownRole(role));
  const invitable = USER_ROLE_VALUES.filter((role) => INVITE.has(role));

  return (
    <section>
      <header className={frame.sectionHead}>
        <h1 className={frame.sectionTitle}>Equipo</h1>
        <p className={frame.quiet}>
          Prisma define {USER_ROLE_VALUES.length} roles. El menú reconoce {menu.length}.{' '}
          {hidden.length} quedan en Sin secciones. Se invitan {invitable.length}. Las llaves se
          leen.
        </p>
      </header>
      <div className={frame.stack}>
        <p className={frame.rowTitle}>Con menú</p>
        {menu.map((role) => (
          <Param key={role} name={ROLE_NAME[role]}>
            <ParameterCard name={ROLE_NAME[role]} value={roleValue(role)} effect={roleEffect(role)} />
          </Param>
        ))}
        <p className={frame.rowTitle}>En Prisma, sin menú</p>
        {hidden.map((role) => (
          <Param key={role} name={ROLE_NAME[role]}>
            <ParameterCard name={ROLE_NAME[role]} value={roleValue(role)} effect={roleEffect(role)} />
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
    </section>
  );
}
