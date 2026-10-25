'use client';

import { useEffect, useState } from 'react';
import { Field, ParameterCard, TicketButton } from '@boletera/ui';
import { ApiError, adminApi } from '@/lib/api';
import { hasCapability } from '@/lib/permissions';
import { AnonymousView, ApiErrorView, NoOrgView, useSession } from '../../events/_shared/api-state';
import { Param } from '../../events/_ticket/controls';
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
          <p className={styles.quiet}>Sin secciones.</p>
        </header>
      </section>
    );
  }
  if (error) {
    return (
      <ApiErrorView error={error} context="abrir la organización" onRetry={() => setNonce((current) => current + 1)} />
    );
  }
  if (loading || !org || !draft) return <p className={styles.quiet}>Cargando organización.</p>;

  function setField(key: keyof Profile, value: string) {
    setDraft((current) => (current ? { ...current, [key]: value } : current));
    setNotice(null);
  }

  return (
    <section>
      <header className={styles.sectionHead}>
        <h1 className={styles.sectionTitle}>Organización</h1>
        <p className={styles.quiet}>
          Se guardan nombre, descripción, sitio, correo y teléfono. El resto de esta ficha se lee.
          Comisión y reventa viven en Comisiones.
        </p>
      </header>
      <div className={styles.stack}>
        <Param name="Nombre de la organización">
          <ParameterCard name="Nombre de la organización" value={draft.name} effect="Razón visible.">
            {canSave ? (
              <Field label="Nombre de la organización" value={draft.name} onChange={(event) => setField('name', event.target.value)} />
            ) : null}
          </ParameterCard>
        </Param>
        <Param name="Descripción de la organización">
          <ParameterCard name="Descripción de la organización" value={draft.description || '—'} effect="Texto corto.">
            {canSave ? (
              <Field
                label="Descripción de la organización"
                value={draft.description}
                onChange={(event) => setField('description', event.target.value)}
              />
            ) : null}
          </ParameterCard>
        </Param>
        <Param name="Sitio">
          <ParameterCard name="Sitio" value={draft.website || '—'} effect="Web de la organización.">
            {canSave ? (
              <Field label="Sitio" value={draft.website} onChange={(event) => setField('website', event.target.value)} />
            ) : null}
          </ParameterCard>
        </Param>
        <Param name="Correo de la organización">
          <ParameterCard name="Correo de la organización" value={draft.email} effect="Contacto.">
            {canSave ? (
              <Field label="Correo de la organización" value={draft.email} onChange={(event) => setField('email', event.target.value)} />
            ) : null}
          </ParameterCard>
        </Param>
        <Param name="Teléfono de la organización">
          <ParameterCard name="Teléfono de la organización" value={draft.phone || '—'} effect="Contacto.">
            {canSave ? (
              <Field label="Teléfono de la organización" value={draft.phone} onChange={(event) => setField('phone', event.target.value)} />
            ) : null}
          </ParameterCard>
        </Param>
        <Read name="Slug de la organización" value={text(org.slug)} mono effect="Único. Esta ruta no lo cambia." />
        <Read name="Tipo" value={word(ORG_TYPE, org.type)} effect="Esta ruta no lo cambia." />
        <Read name="País" value={text(org.country)} effect="País de la organización." />
        <Read name="Zona horaria de la org" value={text(org.timezone)} effect="Default de altas. Aquí se lee." />
        <Read name="Moneda de la org" value={text(org.currency)} effect="Default de altas. Aquí se lee." />
        <Read name="Dirección de la org" value={text(org.address)} effect="Calle. Esta ruta no la guarda." />
        <Read name="Ciudad de la org" value={text(org.city)} effect="Ciudad. Esta ruta no la guarda." />
        <Read name="Estado de la org" value={text(org.state)} effect="Entidad. Esta ruta no la guarda." />
        <Read name="CP de la org" value={text(org.postalCode)} effect="Código postal. Esta ruta no lo guarda." />
        <Read name="Logo de la org" value={org.logoUrl ?? 'Sin imagen'} effect="La cartelera lee el logo de Marca." />
        <Read name="Banner de la org" value={org.bannerUrl ?? 'Sin imagen'} effect="La cartelera lee Marca." />
        <Read name="Titular de la cuenta" value={text(org.bankAccountName)} effect="Dato bancario. Esta ruta no lo guarda." />
        <Read name="Código de banco" value={text(org.bankCode)} effect="Dato bancario. Esta ruta no lo guarda." />
        <Read name="Routing" value={text(org.bankRoutingNumber)} effect="Dato bancario. Esta ruta no lo guarda." />
        <Read name="Número de cuenta" value={maskAccount(org.bankAccountNumber)} mono effect="Enmascarado. No se copia a liquidaciones." />
        <Read name="PayPal" value={text(org.paypalEmail)} effect="No hay cobro PayPal al comprador." />
        <Read
          name="Stripe"
          value="No usar"
          effect={org.stripeAccountId ? 'Hay un identificador legado. No se usa.' : 'Legado. Sin control.'}
        />
        <Read name="RFC en la org" value={text(org.taxId)} effect="El fiscal que factura es el perfil de Facturación." />
        <Read name="Verificada" value={yesNo(org.verified)} effect="Esta ruta no la cambia." />
        <Read name="KYC" value={word(CHECK, org.kycStatus)} effect="Esta ruta no lo cambia." />
        <Read name="AML" value={word(CHECK, org.amlStatus)} effect="Esta ruta no lo cambia." />
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
            Guardar sección
          </TicketButton>
        </div>
      ) : null}
    </section>
  );
}

function Read({
  name,
  value,
  effect,
  mono,
}: {
  name: string;
  value: string;
  effect: string;
  mono?: boolean;
}) {
  return (
    <Param name={name}>
      <ParameterCard name={name} value={value} valueStyle={mono ? 'mono' : 'text'} effect={effect} />
    </Param>
  );
}
