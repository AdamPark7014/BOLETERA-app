'use client';

import { Suspense, useEffect, useState } from 'react';
import { Field, Money, ParameterCard, TicketButton, formatTicketAmount } from '@boletera/ui';
import { ApiError, adminApi } from '@/lib/api';
import { hasCapability } from '@/lib/permissions';
import { AnonymousView, ApiErrorView, NoOrgView, useSession } from '../../events/_shared/api-state';
import { AdminFrame } from '../../events/_ticket/AdminFrame';
import { Param, Segment } from '../../events/_ticket/controls';
import styles from '../../events/_ticket/frame.module.scss';
import { asRecord, readNumber, readString } from '../../events/_ticket/read';

type Profile = {
  rfc: string;
  legalName: string;
  regimen: string;
  cp: string;
  serie: string;
  nextFolio: number;
  pacMode: 'sandbox' | 'production';
  provider: string;
  hasKey: boolean;
};

type Invoice = {
  id: string;
  serie: string;
  folio: number;
  tipo: string;
  uso: string;
  subtotal: number;
  iva: number;
  total: number;
  currency: string;
  uuid: string | null;
};

const EMPTY: Profile = {
  rfc: '',
  legalName: '',
  regimen: '601',
  cp: '',
  serie: 'A',
  nextFolio: 1,
  pacMode: 'sandbox',
  provider: '',
  hasKey: false,
};

function readProfile(raw: unknown): Profile | null {
  if (raw == null) return null;
  const row = asRecord(raw);
  if (!readString(row.id) && !readString(row.rfc)) return null;
  const mode = readString(row.pacMode);
  return {
    rfc: readString(row.rfc) ?? '',
    legalName: readString(row.legalName) ?? '',
    regimen: readString(row.regimenFiscal) ?? '601',
    cp: readString(row.codigoPostal) ?? '',
    serie: readString(row.serie) ?? 'A',
    nextFolio: readNumber(row.nextFolio) ?? 1,
    pacMode: mode === 'production' ? 'production' : 'sandbox',
    provider: readString(row.pacProvider) ?? '',
    hasKey: Boolean(readString(row.pacApiKey)),
  };
}

function readInvoice(raw: unknown): Invoice | null {
  const row = asRecord(raw);
  const id = readString(row.id);
  const subtotal = readNumber(row.subtotal);
  const iva = readNumber(row.iva);
  const total = readNumber(row.total);
  const folio = readNumber(row.folio);
  if (!id || subtotal == null || iva == null || total == null || folio == null) return null;
  return {
    id,
    serie: readString(row.serie) ?? '—',
    folio,
    tipo: readString(row.tipo) ?? 'I',
    uso: readString(row.receptorUsoCfdi) ?? 'G03',
    subtotal,
    iva,
    total,
    currency: readString(row.currency) ?? 'MXN',
    uuid: readString(row.uuid),
  };
}

function tipoLabel(tipo: string): string {
  if (tipo === 'I') return 'Ingreso';
  if (tipo === 'E') return 'Egreso';
  return tipo;
}

function modeLabel(mode: Profile['pacMode']): string {
  return mode === 'production' ? 'Producción' : 'Sandbox';
}

function sameProfile(left: Profile, right: Profile): boolean {
  return (
    left.rfc === right.rfc &&
    left.legalName === right.legalName &&
    left.regimen === right.regimen &&
    left.cp === right.cp &&
    left.serie === right.serie &&
    left.pacMode === right.pacMode &&
    left.provider === right.provider
  );
}

function failMessage(cause: unknown): string {
  if (cause instanceof ApiError) return cause.userMessage;
  return 'No se guardó. Revisa la conexión.';
}

export default function CfdiPage() {
  return (
    <Suspense fallback={null}>
      <AdminFrame>
        <FacturacionBody />
      </AdminFrame>
    </Suspense>
  );
}

function FacturacionBody() {
  const session = useSession();
  const [saved, setSaved] = useState<Profile | null>(null);
  const [draft, setDraft] = useState<Profile>(EMPTY);
  const [key, setKey] = useState('');
  const [invoices, setInvoices] = useState<Invoice[]>([]);
  const [invoiceNote, setInvoiceNote] = useState<string | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [nonce, setNonce] = useState(0);
  const token = session.token;
  const orgId = session.status === 'ready' ? session.orgId : null;
  const canSee = hasCapability(session.role, 'finance.view');

  useEffect(() => {
    if (!token || !orgId || !canSee) {
      if (session.status !== 'loading') setLoading(false);
      return;
    }
    const bearer = token;
    const id = orgId;
    let alive = true;
    setError(null);
    async function load() {
      const profilePayload = await adminApi<unknown>(`/billing/${id}/fiscal-profile`, bearer);
      const profile = readProfile(profilePayload);
      let note: string | null = null;
      let rows: Invoice[] = [];
      try {
        const invoicePayload = await adminApi<unknown>(`/billing/${id}/cfdi`, bearer);
        const list = Array.isArray(invoicePayload) ? invoicePayload : [];
        rows = list.flatMap((item) => {
          const invoice = readInvoice(item);
          return invoice ? [invoice] : [];
        });
      } catch {
        note = 'No se leyeron los comprobantes.';
      }
      if (!alive) return;
      setSaved(profile);
      setDraft(profile ?? EMPTY);
      setKey('');
      setInvoices(rows);
      setInvoiceNote(note);
      setOpenId((current) => (current && rows.some((item) => item.id === current) ? current : (rows[0]?.id ?? null)));
    }
    void load()
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
  }, [token, orgId, canSee, session.status, nonce]);

  const baseline = saved ?? EMPTY;
  const dirty =
    !sameProfile(draft, baseline) ||
    key.trim() !== '' ||
    (saved == null && (draft.rfc.trim() !== '' || draft.legalName.trim() !== '' || draft.cp.trim() !== ''));
  const ready = dirty && draft.rfc.trim() !== '' && draft.legalName.trim() !== '' && draft.cp.trim() !== '';

  function patch(partial: Partial<Profile>) {
    setDraft((current) => ({ ...current, ...partial }));
    setNotice(null);
    setSaveError(null);
  }

  async function save() {
    if (!token || !orgId || !ready || saving) return;
    setSaving(true);
    setSaveError(null);
    const body: Record<string, unknown> = {
      rfc: draft.rfc.trim(),
      legalName: draft.legalName.trim(),
      regimenFiscal: draft.regimen.trim() || '601',
      codigoPostal: draft.cp.trim(),
      serie: draft.serie.trim() || 'A',
      pacMode: draft.pacMode,
      pacProvider: draft.provider.trim() || null,
    };
    if (key.trim()) body.pacApiKey = key.trim();
    const lines = [
      draft.rfc.trim() !== baseline.rfc ? `RFC: ${baseline.rfc || '—'} → ${draft.rfc.trim()}` : null,
      draft.legalName.trim() !== baseline.legalName
        ? `Razón social: ${baseline.legalName || '—'} → ${draft.legalName.trim()}`
        : null,
      (draft.regimen.trim() || '601') !== (baseline.regimen || '601')
        ? `Régimen: ${baseline.regimen || '601'} → ${draft.regimen.trim() || '601'}`
        : null,
      draft.cp.trim() !== baseline.cp ? `CP fiscal: ${baseline.cp || '—'} → ${draft.cp.trim()}` : null,
      (draft.serie.trim() || 'A') !== (baseline.serie || 'A')
        ? `Serie: ${baseline.serie || 'A'} → ${draft.serie.trim() || 'A'}`
        : null,
      draft.pacMode !== baseline.pacMode
        ? `Modo PAC: ${modeLabel(baseline.pacMode)} → ${modeLabel(draft.pacMode)}`
        : null,
      draft.provider.trim() !== baseline.provider ? 'Proveedor PAC' : null,
      key.trim() ? 'Clave PAC' : null,
      saved == null ? 'Perfil fiscal creado' : null,
    ].filter((line): line is string => line != null);
    try {
      await adminApi(`/billing/${orgId}/fiscal-profile`, token, {
        method: 'POST',
        body: JSON.stringify(body),
      });
      setNotice(lines.join(' · ') || 'Perfil fiscal guardado');
      setNonce((current) => current + 1);
    } catch (cause) {
      setSaveError(failMessage(cause));
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
          <h1 className={styles.sectionTitle}>Facturación</h1>
          <p className={styles.quiet}>Sin secciones.</p>
        </header>
      </section>
    );
  }
  if (error) {
    return (
      <ApiErrorView error={error} context="abrir facturación" onRetry={() => setNonce((current) => current + 1)} />
    );
  }
  if (loading || !token || !orgId) return <p className={styles.quiet}>Cargando facturación.</p>;

  const keyValue = key.trim() ? 'Nueva clave' : draft.hasKey ? 'Enmascarada' : 'Sin clave';

  return (
    <section>
      <header className={styles.sectionHead}>
        <h1 className={styles.sectionTitle}>Facturación</h1>
        <p className={styles.quiet}>
          {saved ? 'Perfil fiscal y comprobantes.' : 'Sin perfil guardado.'} Producción no timbra.
        </p>
      </header>
      <div className={styles.stack}>
        <Param name="RFC">
          <ParameterCard name="RFC" value={draft.rfc.trim() || '—'} valueStyle="mono" effect="Del perfil, no el RFC suelto de la organización.">
            <Field label="RFC" value={draft.rfc} onChange={(event) => patch({ rfc: event.target.value })} />
          </ParameterCard>
        </Param>
        <Param name="Razón social">
          <ParameterCard name="Razón social" value={draft.legalName.trim() || '—'} effect="Nombre legal del emisor.">
            <Field
              label="Razón social"
              value={draft.legalName}
              onChange={(event) => patch({ legalName: event.target.value })}
            />
          </ParameterCard>
        </Param>
        <Param name="Régimen">
          <ParameterCard name="Régimen" value={draft.regimen.trim() || '601'} valueStyle="mono" effect="Régimen fiscal del perfil.">
            <Field label="Régimen" value={draft.regimen} onChange={(event) => patch({ regimen: event.target.value })} />
          </ParameterCard>
        </Param>
        <Param name="CP fiscal">
          <ParameterCard name="CP fiscal" value={draft.cp.trim() || '—'} valueStyle="mono" effect="Código postal del domicilio fiscal.">
            <Field label="CP fiscal" value={draft.cp} onChange={(event) => patch({ cp: event.target.value })} />
          </ParameterCard>
        </Param>
        <Param name="Serie">
          <ParameterCard name="Serie" value={draft.serie.trim() || 'A'} valueStyle="mono" effect="Serie del folio.">
            <Field label="Serie" value={draft.serie} onChange={(event) => patch({ serie: event.target.value })} />
          </ParameterCard>
        </Param>
        <Param name="Siguiente folio">
          <ParameterCard
            name="Siguiente folio"
            value={String(draft.nextFolio)}
            valueStyle="tabular"
            effect="Lo avanza el timbrado. Esta ficha no lo escribe."
          />
        </Param>
        <Param name="Modo PAC">
          <ParameterCard
            name="Modo PAC"
            value={modeLabel(draft.pacMode)}
            effect="Producción no timbra. El valor se guarda y el timbre sigue en hueco."
          >
            <Segment
              label="Modo PAC"
              value={draft.pacMode}
              options={[
                { value: 'sandbox', label: 'Sandbox' },
                { value: 'production', label: 'Producción' },
              ]}
              onChange={(next) => patch({ pacMode: next })}
            />
          </ParameterCard>
        </Param>
        <Param name="Proveedor PAC">
          <ParameterCard name="Proveedor PAC" value={draft.provider.trim() || '—'} effect="Nombre del PAC.">
            <Field
              label="Proveedor PAC"
              value={draft.provider}
              onChange={(event) => patch({ provider: event.target.value })}
            />
          </ParameterCard>
        </Param>
        <Param name="Clave PAC">
          <ParameterCard name="Clave PAC" value={keyValue} effect="No se muestra completa.">
            <Field
              label="Clave PAC"
              type="password"
              autoComplete="new-password"
              value={key}
              placeholder={draft.hasKey ? 'Clave guardada' : 'Sin clave'}
              onChange={(event) => {
                setKey(event.target.value);
                setNotice(null);
              }}
            />
          </ParameterCard>
        </Param>
      </div>
      {saveError ? (
        <p className={styles.danger} role="alert">
          {saveError}
        </p>
      ) : null}
      <div className={styles.saveBar}>
        <p className={styles.quiet} aria-live="polite">
          {dirty && !ready ? 'Faltan RFC, razón social o CP fiscal.' : dirty ? 'Sin guardar' : (notice ?? '')}
        </p>
        <TicketButton disabled={!ready || saving} onClick={() => void save()}>
          Guardar sección
        </TicketButton>
      </div>
      <header className={styles.sectionHead}>
        <p className={styles.rowTitle}>Comprobantes</p>
        {invoiceNote ? <p className={styles.tertiary}>{invoiceNote}</p> : null}
      </header>
      {invoices.length === 0 && !invoiceNote ? <p className={styles.quiet}>No hay comprobantes.</p> : null}
      <div className={styles.stack}>
        {invoices.map((invoice) => {
          const open = openId === invoice.id;
          return (
            <div key={invoice.id} className={styles.stack}>
              <button
                type="button"
                className={open ? `${styles.zoneButton} ${styles.zoneOpen}` : styles.zoneButton}
                aria-expanded={open}
                onClick={() => setOpenId(open ? null : invoice.id)}
              >
                <span>
                  {invoice.serie} {invoice.folio} · {tipoLabel(invoice.tipo)}
                </span>
                <span className={styles.figure}>{formatTicketAmount(invoice.total)}</span>
              </button>
              {open ? (
                <>
                  {invoice.uuid ? <p className={styles.mono}>{invoice.uuid}</p> : null}
                  <Param name="Tipo de CFDI">
                    <ParameterCard name="Tipo de CFDI" value={tipoLabel(invoice.tipo)} effect="I ingreso, E egreso." />
                  </Param>
                  <Param name="Uso CFDI">
                    <ParameterCard name="Uso CFDI" value={invoice.uso} valueStyle="mono" effect="Uso del receptor." />
                  </Param>
                  <Param name="Subtotal">
                    <ParameterCard
                      name="Subtotal"
                      value={formatTicketAmount(invoice.subtotal)}
                      valueStyle="tabular"
                      effect="Del comprobante."
                    />
                  </Param>
                  <Param name="IVA del CFDI">
                    <ParameterCard
                      name="IVA del CFDI"
                      value={formatTicketAmount(invoice.iva)}
                      valueStyle="tabular"
                      effect="Calculado. No se captura aparte."
                    />
                  </Param>
                  <Param name="Total del CFDI">
                    <ParameterCard
                      name="Total del CFDI"
                      value={formatTicketAmount(invoice.total)}
                      valueStyle="tabular"
                      effect="Total del comprobante."
                    >
                      <Money label="Total" amount={invoice.total} currency={invoice.currency === 'MXN'} />
                    </ParameterCard>
                  </Param>
                  <Param name="Moneda del CFDI">
                    <ParameterCard name="Moneda del CFDI" value={invoice.currency} effect="Moneda del comprobante." />
                  </Param>
                </>
              ) : null}
            </div>
          );
        })}
      </div>
    </section>
  );
}
