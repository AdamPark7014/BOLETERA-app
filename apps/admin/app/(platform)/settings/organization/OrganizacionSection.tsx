'use client';

import { NoAccess } from '@/app/(platform)/events/_ticket/NoAccess';
import { useEffect, useState } from 'react';
import { Field, TicketButton } from '@boletera/ui';
import { ApiError, adminApi } from '@/lib/api';
import { hasCapability } from '@/lib/permissions';
import { AnonymousView, ApiErrorView, NoOrgView, useSession } from '../../events/_shared/api-state';
import styles from '../../events/_ticket/frame.module.scss';
import { asRecord, readString, yesNo } from '../../events/_ticket/read';

const ORG_TYPE: Record<string, string> = {
  PROMOTER: 'Promotor',
  VENUE: 'Recinto',
  BOLETERA: 'Boletera',
  ARTIST: 'Artista',
  DISTRIBUTOR: 'Distribuidor',
};

const CHECK: Record<string, string> = {
  PENDING: 'Pendiente',
  VERIFIED: 'Verificado',
  REJECTED: 'Rechazado',
  EXPIRED: 'Caducado',
  WATCHLIST: 'En lista',
};

const SEE = ['ADMIN', 'SUPER_ADMIN', 'PROMOTER', 'VENUE_MANAGER'];

type Org = {
  name: string;
  description: string;
  website: string;
  email: string;
  phone: string;
  slug: string | null;
  type: string | null;
  country: string | null;
  timezone: string | null;
  currency: string | null;
  address: string | null;
  city: string | null;
  state: string | null;
  postalCode: string | null;
  logoUrl: string | null;
  bannerUrl: string | null;
  bankAccountName: string | null;
  bankCode: string | null;
  bankRoutingNumber: string | null;
  bankAccountNumber: string | null;
  paypalEmail: string | null;
  stripeAccountId: string | null;
  taxId: string | null;
  verified: boolean;
  kycStatus: string | null;
  amlStatus: string | null;
};

type Profile = {
  name: string;
  description: string;
  website: string;
  email: string;
  phone: string;
};

function text(value: string | null): string {
  return value ?? '—';
}

function maskAccount(value: string | null): string {
  if (!value) return '—';
  if (value.length <= 4) return '••••';
  return `••••${value.slice(-4)}`;
}

function word(map: Record<string, string>, value: string | null): string {
  if (!value) return '—';
  return map[value] ?? value;
}

function readOrg(payload: unknown): Org | null {
  const row = asRecord(payload);
  const name = readString(row.name);
  const email = readString(row.email);
  if (!name || !email) return null;
  return {
    name,
    description: readString(row.description) ?? '',
    website: readString(row.website) ?? '',
    email,
    phone: readString(row.phone) ?? '',
    slug: readString(row.slug),
    type: readString(row.type),
    country: readString(row.country),
    timezone: readString(row.timezone),
    currency: readString(row.currency),
    address: readString(row.address),
    city: readString(row.city),
    state: readString(row.state),
    postalCode: readString(row.postalCode),
    logoUrl: readString(row.logoUrl),
    bannerUrl: readString(row.bannerUrl),
    bankAccountName: readString(row.bankAccountName),
    bankCode: readString(row.bankCode),
    bankRoutingNumber: readString(row.bankRoutingNumber),
    bankAccountNumber: readString(row.bankAccountNumber),
    paypalEmail: readString(row.paypalEmail),
    stripeAccountId: readString(row.stripeAccountId),
    taxId: readString(row.taxId),
    verified: row.verified === true,
    kycStatus: readString(row.kycStatus),
    amlStatus: readString(row.amlStatus),
  };
}

function profileOf(org: Org): Profile {
  return {
    name: org.name,
    description: org.description,
    website: org.website,
    email: org.email,
    phone: org.phone,
  };
}

const ZONES: Record<string, string> = {
  'America/Mexico_City': 'Ciudad de México',
  'America/Monterrey': 'Monterrey',
  'America/Tijuana': 'Tijuana',
  'America/Cancun': 'Cancún',
  'America/Hermosillo': 'Hermosillo',
  'America/Mazatlan': 'Mazatlán',
  'America/Merida': 'Mérida',
  'America/Chihuahua': 'Chihuahua',
};

function zoneName(value: string | null): string {
  if (!value) return '—';
  return ZONES[value] ?? value.split('/').pop()?.replace(/_/g, ' ') ?? value;
}

function countryName(value: string | null): string {
  if (!value) return '—';
  if (value.toUpperCase() === 'MX') return 'México';
  if (value.toUpperCase() === 'US') return 'Estados Unidos';
  return value;
}

function currencyName(value: string | null): string {
  if (!value) return '—';
  if (value.toUpperCase() === 'MXN') return 'Pesos mexicanos';
  if (value.toUpperCase() === 'USD') return 'Dólares';
  return value;
}

/** Lista de datos de solo lectura: etiqueta a la izquierda, valor a la derecha. */
function InfoList({
  title,
  items,
}: {
  title?: string;
  items: { label: string; value: string; mono?: boolean }[];
}) {
  return (
    <div>
      {title ? <h2 className={styles.panelTitle}>{title}</h2> : null}
      <ul className={styles.rows}>
        {items.map((item) => (
          <li key={item.label} className={styles.row}>
            <p className={styles.rowTitle}>{item.label}</p>
            <span />
            <p
              className={styles.tertiary}
              style={item.mono ? { fontVariantNumeric: 'tabular-nums' } : undefined}
            >
              {item.value}
            </p>
          </li>
        ))}
      </ul>
    </div>
  );
}

function failMessage(cause: unknown): string {
  if (cause instanceof ApiError) return cause.userMessage;
  return 'No se guardó. Revisa la conexión.';
}

export function OrganizacionBody() {
  const session = useSession();
  const [org, setOrg] = useState<Org | null>(null);
  const [draft, setDraft] = useState<Profile | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<unknown>(null);
  const [actionError, setActionError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [nonce, setNonce] = useState(0);
  const token = session.token;
  const role = session.role;
  const canSee = role === 'SUPER_ADMIN' || (role != null && SEE.includes(role));
  const canSave = hasCapability(role, 'org.manage');

  useEffect(() => {
    if (!token || !session.orgId || !canSee) {
      if (session.status !== 'loading') setLoading(false);
      return;
    }
    let alive = true;
    setError(null);
    adminApi<unknown>(`/organization/${session.orgId}`, token)
      .then((payload) => {
        if (!alive) return;
        const next = readOrg(payload);
        setOrg(next);
        setDraft(next ? profileOf(next) : null);
      })
      .catch((cause: unknown) => {
        if (!alive) return;
        setError(cause);
      })
      .finally(() => {
        if (alive) setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, [token, session.orgId, canSee, session.status, nonce]);

  const dirty =
    org != null &&
    draft != null &&
    (draft.name !== org.name ||
      draft.description !== org.description ||
      draft.website !== org.website ||
      draft.email !== org.email ||
      draft.phone !== org.phone);

  async function save() {
    if (!token || !session.orgId || !org || !draft || !dirty || saving || !canSave) return;
    if (!draft.name.trim() || !draft.email.trim()) {
      setActionError('El nombre y el correo no pueden quedar vacíos.');
      return;
    }
    const body: Record<string, string> = {};
    if (draft.name !== org.name) body.name = draft.name.trim();
    if (draft.description !== org.description) body.description = draft.description.trim();
    if (draft.website !== org.website) body.website = draft.website.trim();
    if (draft.email !== org.email) body.email = draft.email.trim();
    if (draft.phone !== org.phone) body.phone = draft.phone.trim();
    setSaving(true);
    setActionError(null);
    try {
      await adminApi(`/organization/${session.orgId}`, token, {
        method: 'PATCH',
        body: JSON.stringify(body),
      });
      const lines = Object.keys(body).map((key) => {
        const label =
          key === 'name'
            ? 'Nombre'
            : key === 'description'
              ? 'Descripción'
              : key === 'website'
                ? 'Sitio'
                : key === 'email'
                  ? 'Correo'
                  : 'Teléfono';
        return `${label} actualizado`;
      });
      setNotice(lines.join(' · '));
      setNonce((current) => current + 1);
    } catch (cause) {
      setActionError(failMessage(cause));
    } finally {
      setSaving(false);
    }
  }

  if (session.status === 'anonymous') return <AnonymousView />;
  if (session.status === 'no-org') return <NoOrgView />;
  if (!canSee && session.status !== 'loading') {
    return (
      <section>
        <header className={styles.sectionHead}>
          <h1 className={styles.sectionTitle}>Organización</h1>
          <NoAccess />
        </header>
      </section>
    );
  }
  if (error) {
    return (
      <ApiErrorView
        error={error}
        context="abrir la organización"
        onRetry={() => setNonce((current) => current + 1)}
      />
    );
  }
  if (loading || !org || !draft) return <p className={styles.quiet}>Cargando organización.</p>;

  function setField(key: keyof Profile, value: string) {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
    setNotice(null);
  }

  const ubicacion = [org.address, org.city, org.state, org.postalCode].filter(Boolean).join(', ');
  const datos: { label: string; value: string; mono?: boolean }[] = [
    { label: 'Dirección del sitio', value: text(org.slug), mono: true },
    { label: 'Tipo', value: word(ORG_TYPE, org.type) },
    { label: 'País', value: countryName(org.country) },
    { label: 'Zona horaria', value: zoneName(org.timezone) },
    { label: 'Moneda', value: currencyName(org.currency) },
    { label: 'Domicilio', value: ubicacion || '—' },
    { label: 'RFC', value: text(org.taxId) },
  ];
  const deposito: { label: string; value: string; mono?: boolean }[] = [
    { label: 'Titular', value: text(org.bankAccountName) },
    { label: 'Banco', value: text(org.bankCode) },
    { label: 'Cuenta', value: maskAccount(org.bankAccountNumber), mono: true },
  ];
  const verificacion: { label: string; value: string }[] = [
    { label: 'Organización verificada', value: yesNo(org.verified) },
    { label: 'Identidad', value: word(CHECK, org.kycStatus) },
    { label: 'Prevención de lavado', value: word(CHECK, org.amlStatus) },
  ];

  return (
    <section>
      <header className={styles.sectionHead}>
        <h1 className={styles.sectionTitle}>Organización</h1>
      </header>
      <div className={styles.stack}>
        {canSave ? (
          <div className={styles.stack}>
            <Field
              label="Nombre"
              value={draft.name}
              onChange={(event) => setField('name', event.target.value)}
            />
            <Field
              label="Descripción"
              value={draft.description}
              onChange={(event) => setField('description', event.target.value)}
            />
            <Field
              label="Sitio web"
              value={draft.website}
              onChange={(event) => setField('website', event.target.value)}
            />
            <Field
              label="Correo de contacto"
              value={draft.email}
              onChange={(event) => setField('email', event.target.value)}
            />
            <Field
              label="Teléfono"
              value={draft.phone}
              onChange={(event) => setField('phone', event.target.value)}
            />
          </div>
        ) : (
          <InfoList
            items={[
              { label: 'Nombre', value: draft.name },
              { label: 'Descripción', value: draft.description || '—' },
              { label: 'Sitio web', value: draft.website || '—' },
              { label: 'Correo de contacto', value: draft.email },
              { label: 'Teléfono', value: draft.phone || '—' },
            ]}
          />
        )}
        <InfoList title="Datos de la cuenta" items={datos} />
        <InfoList title="Cuenta de depósito" items={deposito} />
        <InfoList title="Verificación" items={verificacion} />
      </div>
      {actionError ? (
        <p className={styles.danger} role="alert">
          {actionError}
        </p>
      ) : null}
      {canSave ? (
        <div className={styles.saveBar}>
          <p className={styles.quiet} aria-live="polite">
            {dirty ? 'Sin guardar' : (notice ?? '')}
          </p>
          <TicketButton disabled={!dirty || saving} onClick={() => void save()}>
            Guardar cambios
          </TicketButton>
        </div>
      ) : null}
    </section>
  );
}
