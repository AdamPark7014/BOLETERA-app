'use client';

/**
 * Facturación CFDI 4.0.
 *
 * La pantalla anterior guardaba silencio en todos los caminos malos: `.catch(()
 * => {})` en el perfil fiscal y `.catch(() => setInvoices([]))` en la lista, así
 * que "aún no facturas nada", "tu sesión venció" y "tu rol no puede ver
 * facturación" se veían igual — una tabla vacía. Además el timbrado sin `await`
 * de errores dejaba al usuario sin saber por qué no aparecía el CFDI.
 *
 * Aquí se reutiliza el patrón de estados de `orders/_ui` y se hace explícito lo
 * que el SAT exige mirar: RFC del receptor, uso de CFDI, estado del timbre y —
 * cuando falla — qué hacer para corregirlo.
 */

import { FormEvent, useCallback, useMemo, useState } from 'react';
import { ApiError } from '@/lib/api';
import {
  getFiscalProfile,
  listCfdiInvoices,
  stampCfdi,
  upsertFiscalProfile,
  type CfdiInvoice,
  type CfdiStatus,
  type FiscalProfile,
} from '@/lib/platform-api';
import { Notice, ResourceView } from '../../orders/_ui/States';
import { useResource } from '../../orders/_ui/useResource';
import { formatDateTime, formatMoney } from '../../orders/_ui/format';
import platform from '../../_styles/platform.module.scss';
import styles from './cfdi.module.scss';

/* ── Catálogos del SAT ───────────────────────────────────────────────────────
 * Solo el subconjunto que aplica a venta de boletos. Se muestran con clave y
 * descripción porque en una factura la clave sola ("G03") no es auditable por
 * quien atiende al cliente.
 */
const USO_CFDI: Record<string, string> = {
  G01: 'Adquisición de mercancías',
  G03: 'Gastos en general',
  D10: 'Pagos por servicios educativos',
  I08: 'Otra maquinaria y equipo',
  S01: 'Sin efectos fiscales',
  CP01: 'Pagos',
};

const REGIMEN_FISCAL: Record<string, string> = {
  '601': 'General de Ley Personas Morales',
  '603': 'Personas Morales con Fines no Lucrativos',
  '605': 'Sueldos y Salarios e Ingresos Asimilados a Salarios',
  '612': 'Personas Físicas con Actividades Empresariales y Profesionales',
  '616': 'Sin obligaciones fiscales',
  '621': 'Incorporación Fiscal',
  '626': 'Régimen Simplificado de Confianza',
};

/** RFC del SAT: 3 letras (moral) o 4 (física) + fecha + homoclave. */
const RFC_PATTERN = /^([A-ZÑ&]{3,4})\d{6}[A-Z\d]{3}$/;
/** RFC genérico para el público que no pide factura a su nombre. */
const RFC_PUBLICO = 'XAXX010101000';

const STATUS_LABEL: Record<CfdiStatus, string> = {
  STAMPED: 'Timbrada',
  DRAFT: 'Pendiente',
  CANCELLED: 'Cancelada',
  ERROR: 'Con error',
};

const STATUS_CLASS: Record<CfdiStatus, string> = {
  STAMPED: styles.stamped,
  DRAFT: styles.draft,
  CANCELLED: styles.cancelled,
  ERROR: styles.errored,
};

/** Qué significa el estado en términos de operación, no de base de datos. */
const STATUS_MEANING: Record<CfdiStatus, string> = {
  STAMPED: 'El PAC devolvió UUID: la factura ya es válida ante el SAT.',
  DRAFT: 'Se generó el comprobante pero aún no tiene timbre. Vuelve a timbrarla.',
  CANCELLED: 'Se canceló ante el SAT. Si el cliente sigue necesitando factura, timbra una nueva.',
  ERROR: 'El PAC rechazó el timbrado. Revisa el motivo y corrige antes de reintentar.',
};

function StatusBadge({ status }: { status: CfdiStatus }) {
  return (
    <span className={`${styles.badge} ${STATUS_CLASS[status] ?? styles.cancelled}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

/**
 * Traduce el fallo del timbrado a una instrucción. El API responde con textos en
 * inglés pensados para el log (`Configure fiscal profile before stamping CFDI`,
 * `Completed order not found`); tal cual no le sirven a quien factura.
 */
function stampErrorMessage(error: unknown): string {
  if (!(error instanceof ApiError)) {
    return 'No se pudo contactar al servicio de facturación. Revisa tu conexión e inténtalo de nuevo.';
  }
  const raw = String(error.message ?? '');
  if (/fiscal profile/i.test(raw)) {
    return 'Falta el perfil fiscal del emisor, o está desactivado. Guárdalo arriba antes de timbrar.';
  }
  if (/completed order not found/i.test(raw)) {
    return 'Esa orden no existe en tu organización o todavía no está pagada. Solo se timbran órdenes completadas.';
  }
  if (error.isUnauthorized) return 'Tu sesión expiró. Vuelve a iniciar sesión y reintenta el timbrado.';
  if (error.isForbidden) return 'Tu rol no puede timbrar CFDI. Pide el permiso a un administrador.';
  return error.userMessage;
}

type BillingData = { profile: FiscalProfile | null; invoices: CfdiInvoice[] };

export default function CfdiBillingPage() {
  const loader = useCallback(async ({ token, orgId }: { token: string; orgId: string }) => {
    // En paralelo: un perfil ausente (null) no debe impedir listar lo ya timbrado.
    const [profile, invoices] = await Promise.all([
      getFiscalProfile(token, orgId),
      listCfdiInvoices(token, orgId),
    ]);
    return { profile, invoices } satisfies BillingData;
  }, []);

  const resource = useResource<BillingData>(loader, { requiresOrg: true });

  return (
    <div>
      <header className={platform.pageHeader}>
        <div>
          <h1>Facturación CFDI 4.0</h1>
          <p>Perfil fiscal del emisor, timbrado por orden y estado de cada comprobante</p>
        </div>
      </header>

      <ResourceView resource={resource} context="las facturas" loadingRows={5}>
        {(data) => <CfdiContent data={data} onChanged={resource.reload} />}
      </ResourceView>
    </div>
  );
}

function CfdiContent({ data, onChanged }: { data: BillingData; onChanged: () => void }) {
  const { profile, invoices } = data;

  return (
    <>
      {!profile ? (
        <Notice tone="warn" title="Todavía no hay perfil fiscal">
          <p>
            Sin RFC, razón social, régimen y código postal del emisor el PAC rechaza cualquier
            timbrado. Configúralo abajo para habilitar la facturación.
          </p>
        </Notice>
      ) : profile.pacMode !== 'production' ? (
        <Notice tone="info" title="Modo sandbox">
          <p>
            Los timbres que emitas ahora <strong>no tienen validez ante el SAT</strong>: el UUID es
            simulado y sirve solo para probar el flujo. Cambia el perfil a modo producción con un
            PAC contratado para facturar de verdad.
          </p>
        </Notice>
      ) : null}

      <FiscalProfileForm profile={profile} onSaved={onChanged} />
      <StampForm profileReady={Boolean(profile?.active)} onStamped={onChanged} />
      <InvoiceTable invoices={invoices} />
    </>
  );
}

/* ── Perfil fiscal del emisor ────────────────────────────────────────────── */

function FiscalProfileForm({
  profile,
  onSaved,
}: {
  profile: FiscalProfile | null;
  onSaved: () => void;
}) {
  const [rfc, setRfc] = useState(profile?.rfc ?? '');
  const [legalName, setLegalName] = useState(profile?.legalName ?? '');
  const [regimen, setRegimen] = useState(profile?.regimenFiscal ?? '601');
  const [cp, setCp] = useState(profile?.codigoPostal ?? '');
  const [serie, setSerie] = useState(profile?.serie ?? 'A');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  const rfcInvalid = rfc.length > 0 && !RFC_PATTERN.test(rfc.toUpperCase());

  async function submit(e: FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem('boletera_token');
    const orgId = localStorage.getItem('boletera_org');
    if (!token || !orgId) {
      setError('Tu sesión ya no tiene organización activa. Vuelve a iniciar sesión.');
      return;
    }
    if (rfcInvalid) return;
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      await upsertFiscalProfile(token, orgId, {
        rfc: rfc.toUpperCase(),
        legalName,
        regimenFiscal: regimen,
        codigoPostal: cp,
        serie: serie || 'A',
        // El modo PAC no se cambia desde aquí: requiere credenciales del PAC,
        // que se cargan por configuración y no deben viajar en un formulario.
        pacMode: profile?.pacMode ?? 'sandbox',
      });
      setSaved(true);
      onSaved();
    } catch (err) {
      setError(err instanceof ApiError ? err.userMessage : 'No se pudo guardar el perfil fiscal.');
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className={platform.panel} aria-labelledby="cfdi-emisor">
      <h2 id="cfdi-emisor">Perfil fiscal del emisor</h2>

      <form onSubmit={submit} noValidate>
        <div className={styles.grid}>
          <label className={styles.field} htmlFor="fp-rfc">
            RFC del emisor
            <input
              id="fp-rfc"
              value={rfc}
              onChange={(e) => setRfc(e.target.value.toUpperCase())}
              autoComplete="off"
              spellCheck={false}
              maxLength={13}
              required
              aria-invalid={rfcInvalid}
              aria-describedby={rfcInvalid ? 'fp-rfc-error' : 'fp-rfc-hint'}
            />
            {rfcInvalid ? (
              <span className={styles.fieldError} id="fp-rfc-error">
                Formato inválido. Son 12 caracteres para persona moral y 13 para persona física.
              </span>
            ) : (
              <span className={styles.hint} id="fp-rfc-hint">
                12 o 13 caracteres, como aparece en tu constancia de situación fiscal.
              </span>
            )}
          </label>

          <label className={styles.field} htmlFor="fp-legal">
            Razón social
            <input
              id="fp-legal"
              value={legalName}
              onChange={(e) => setLegalName(e.target.value)}
              required
              aria-describedby="fp-legal-hint"
            />
            <span className={styles.hint} id="fp-legal-hint">
              Sin régimen societario si tu constancia no lo incluye (CFDI 4.0 lo valida).
            </span>
          </label>

          <label className={styles.field} htmlFor="fp-regimen">
            Régimen fiscal
            <select id="fp-regimen" value={regimen} onChange={(e) => setRegimen(e.target.value)}>
              {Object.entries(REGIMEN_FISCAL).map(([code, label]) => (
                <option key={code} value={code}>
                  {code} · {label}
                </option>
              ))}
            </select>
          </label>

          <label className={styles.field} htmlFor="fp-cp">
            Código postal del domicilio fiscal
            <input
              id="fp-cp"
              value={cp}
              onChange={(e) => setCp(e.target.value.replace(/\D/g, '').slice(0, 5))}
              inputMode="numeric"
              maxLength={5}
              required
              aria-describedby="fp-cp-hint"
            />
            <span className={styles.hint} id="fp-cp-hint">
              Es el lugar de expedición del comprobante.
            </span>
          </label>

          <label className={styles.field} htmlFor="fp-serie">
            Serie
            <input
              id="fp-serie"
              value={serie}
              onChange={(e) => setSerie(e.target.value.toUpperCase().slice(0, 10))}
              aria-describedby="fp-serie-hint"
            />
            <span className={styles.hint} id="fp-serie-hint">
              {profile
                ? `Siguiente folio: ${profile.nextFolio}. Lo asigna el servidor al timbrar.`
                : 'El folio lo asigna el servidor de forma consecutiva.'}
            </span>
          </label>
        </div>

        {error && (
          <p className={styles.fieldError} role="alert">
            {error}
          </p>
        )}
        {saved && !error && (
          <p className={styles.sandboxNote} role="status">
            Perfil fiscal guardado.
          </p>
        )}

        <div className={styles.formActions}>
          <button type="submit" className={platform.primaryBtn} disabled={saving || rfcInvalid}>
            {saving ? 'Guardando…' : 'Guardar perfil'}
          </button>
        </div>
      </form>
    </section>
  );
}

/* ── Timbrado ────────────────────────────────────────────────────────────── */

function StampForm({
  profileReady,
  onStamped,
}: {
  profileReady: boolean;
  onStamped: () => void;
}) {
  const [orderId, setOrderId] = useState('');
  const [receptorRfc, setReceptorRfc] = useState(RFC_PUBLICO);
  const [receptorNombre, setReceptorNombre] = useState('PUBLICO EN GENERAL');
  const [uso, setUso] = useState('G03');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [ok, setOk] = useState<string | null>(null);

  const rfcInvalid = receptorRfc.length > 0 && !RFC_PATTERN.test(receptorRfc.toUpperCase());

  async function submit(e: FormEvent) {
    e.preventDefault();
    const token = localStorage.getItem('boletera_token');
    const orgId = localStorage.getItem('boletera_org');
    if (!token || !orgId) {
      setError('Tu sesión ya no tiene organización activa. Vuelve a iniciar sesión.');
      return;
    }
    if (rfcInvalid) return;
    setBusy(true);
    setError(null);
    setOk(null);
    try {
      const res = await stampCfdi(token, orgId, {
        orderId: orderId.trim(),
        receptorRfc: receptorRfc.toUpperCase(),
        receptorNombre,
        receptorUsoCfdi: uso,
      });
      setOk(
        res.uuid
          ? `Timbrada ${res.serie}-${res.folio}. UUID ${res.uuid}.`
          : `Comprobante ${res.serie}-${res.folio} creado, pendiente de timbre.`,
      );
      setOrderId('');
      onStamped();
    } catch (err) {
      setError(stampErrorMessage(err));
    } finally {
      setBusy(false);
    }
  }

  const publico = receptorRfc.toUpperCase() === RFC_PUBLICO;

  return (
    <section className={platform.panel} aria-labelledby="cfdi-timbrar">
      <h2 id="cfdi-timbrar">Timbrar una orden</h2>

      {!profileReady && (
        <Notice tone="warn" title="Timbrado deshabilitado">
          <p>Guarda primero el perfil fiscal del emisor: sin él el PAC rechaza la petición.</p>
        </Notice>
      )}

      <form onSubmit={submit} noValidate>
        <div className={styles.grid}>
          <label className={styles.field} htmlFor="st-order">
            Orden a facturar
            <input
              id="st-order"
              value={orderId}
              onChange={(e) => setOrderId(e.target.value.trim())}
              autoComplete="off"
              spellCheck={false}
              required
              aria-describedby="st-order-hint"
            />
            <span className={styles.hint} id="st-order-hint">
              Identificador interno de la orden. Solo se pueden timbrar órdenes completadas.
            </span>
          </label>

          <label className={styles.field} htmlFor="st-rfc">
            RFC del receptor
            <input
              id="st-rfc"
              value={receptorRfc}
              onChange={(e) => setReceptorRfc(e.target.value.toUpperCase())}
              autoComplete="off"
              spellCheck={false}
              maxLength={13}
              required
              aria-invalid={rfcInvalid}
              aria-describedby={rfcInvalid ? 'st-rfc-error' : 'st-rfc-hint'}
            />
            {rfcInvalid ? (
              <span className={styles.fieldError} id="st-rfc-error">
                Formato inválido. Revisa la constancia del cliente antes de timbrar.
              </span>
            ) : (
              <span className={styles.hint} id="st-rfc-hint">
                {publico
                  ? `${RFC_PUBLICO} es el RFC genérico de público en general.`
                  : 'Debe coincidir exactamente con la constancia del cliente; el SAT no lo corrige.'}
              </span>
            )}
          </label>

          <label className={styles.field} htmlFor="st-nombre">
            Nombre o razón social del receptor
            <input
              id="st-nombre"
              value={receptorNombre}
              onChange={(e) => setReceptorNombre(e.target.value)}
              required
            />
          </label>

          <label className={styles.field} htmlFor="st-uso">
            Uso de CFDI
            <select id="st-uso" value={uso} onChange={(e) => setUso(e.target.value)}>
              {Object.entries(USO_CFDI).map(([code, label]) => (
                <option key={code} value={code}>
                  {code} · {label}
                </option>
              ))}
            </select>
            <span className={styles.hint}>
              {publico
                ? 'Con el RFC genérico el SAT solo acepta S01 (sin efectos fiscales).'
                : 'Lo elige el cliente según cómo vaya a deducir el gasto.'}
            </span>
          </label>
        </div>

        {error && (
          <p className={styles.fieldError} role="alert">
            {error}
          </p>
        )}
        {ok && !error && (
          <p className={styles.sandboxNote} role="status">
            {ok}
          </p>
        )}

        <div className={styles.formActions}>
          <button
            type="submit"
            className={platform.primaryBtn}
            disabled={busy || rfcInvalid || !profileReady}
          >
            {busy ? 'Timbrando…' : 'Timbrar CFDI'}
          </button>
        </div>
      </form>
    </section>
  );
}

/* ── Listado ─────────────────────────────────────────────────────────────── */

function InvoiceTable({ invoices }: { invoices: CfdiInvoice[] }) {
  const counts = useMemo(() => {
    const acc: Record<string, number> = { STAMPED: 0, DRAFT: 0, CANCELLED: 0, ERROR: 0 };
    for (const inv of invoices) acc[inv.status] = (acc[inv.status] ?? 0) + 1;
    return acc;
  }, [invoices]);

  const failed = counts.ERROR ?? 0;

  return (
    <section className={platform.panel} aria-labelledby="cfdi-lista">
      <h2 id="cfdi-lista">Comprobantes emitidos</h2>

      {invoices.length === 0 ? (
        <p className={styles.sandboxNote}>
          Todavía no se ha timbrado ningún CFDI en esta organización. En cuanto factures una orden
          aparecerá aquí con su UUID y su estado.
        </p>
      ) : (
        <>
          <div className={styles.totalsRow}>
            {(['STAMPED', 'DRAFT', 'CANCELLED', 'ERROR'] as CfdiStatus[]).map((s) => (
              <div key={s} className={platform.kpi}>
                <span>{STATUS_LABEL[s]}</span>
                <strong>{counts[s] ?? 0}</strong>
              </div>
            ))}
          </div>

          {failed > 0 && (
            <Notice tone="danger" title={`${failed} comprobante(s) con error de timbrado`}>
              <p>
                El PAC rechazó el timbre. El motivo va debajo de cada fila; los rechazos más comunes
                son RFC del receptor que no existe en el padrón, uso de CFDI incompatible con el
                régimen del receptor, o un código postal de expedición que no coincide con la
                constancia del emisor. Corrige el dato y vuelve a timbrar la misma orden.
              </p>
            </Notice>
          )}

          <div className={styles.tableWrap}>
            <table className={platform.table}>
              <caption className={styles.sandboxNote} style={{ textAlign: 'left' }}>
                Últimos {invoices.length} comprobantes, del más reciente al más antiguo.
              </caption>
              <thead>
                <tr>
                  <th scope="col">Estado</th>
                  <th scope="col">Folio</th>
                  <th scope="col">Receptor</th>
                  <th scope="col">Uso CFDI</th>
                  <th scope="col">Total</th>
                  <th scope="col">UUID / timbrado</th>
                </tr>
              </thead>
              <tbody>
                {invoices.map((inv) => (
                  <tr key={inv.id}>
                    <td>
                      <StatusBadge status={inv.status} />
                      <span className={styles.secondary}>{STATUS_MEANING[inv.status]}</span>
                      {inv.status === 'ERROR' && (
                        <div className={styles.errorDetail}>
                          <strong>Motivo del PAC: </strong>
                          <code>{inv.errorMessage ?? 'el PAC no devolvió detalle'}</code>
                        </div>
                      )}
                    </td>
                    <td>
                      <strong>
                        {inv.serie}-{inv.folio}
                      </strong>
                      <span className={styles.secondary}>
                        {inv.tipo === 'E' ? 'Egreso (nota de crédito)' : 'Ingreso'}
                      </span>
                    </td>
                    <td>
                      <span className={styles.rfc}>{inv.receptorRfc}</span>
                      <span className={styles.secondary}>{inv.receptorNombre}</span>
                    </td>
                    <td>
                      <span className={styles.rfc}>{inv.receptorUsoCfdi}</span>
                      <span className={styles.secondary}>
                        {USO_CFDI[inv.receptorUsoCfdi] ?? 'clave fuera del catálogo cargado'}
                      </span>
                    </td>
                    <td className={styles.money}>
                      {formatMoney(inv.total, inv.currency)}
                      <span className={styles.secondary}>
                        Subtotal {formatMoney(inv.subtotal, inv.currency)} · IVA{' '}
                        {formatMoney(inv.iva, inv.currency)}
                      </span>
                    </td>
                    <td>
                      {inv.uuid ? (
                        <>
                          <span className={styles.uuid}>{inv.uuid}</span>
                          <span className={styles.secondary}>
                            {inv.stampedAt
                              ? `Timbrada el ${formatDateTime(inv.stampedAt)}`
                              : `Creada el ${formatDateTime(inv.createdAt)}`}
                          </span>
                        </>
                      ) : (
                        <>
                          <span className={styles.secondary}>Sin UUID: no llegó a timbrarse.</span>
                          <span className={styles.secondary}>
                            Creada el {formatDateTime(inv.createdAt)}
                          </span>
                        </>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/*
           * El API no expone cancelación de CFDI ni descarga de XML/PDF: los
           * campos `xmlUrl`/`pdfUrl` existen en el modelo pero el sandbox nunca
           * los llena y no hay endpoint de cancelación. Se dice en pantalla en
           * lugar de pintar botones que no harían nada.
           */}
          <p className={styles.sandboxNote}>
            La cancelación ante el SAT y la descarga del XML/PDF todavía no están expuestas por el
            API; hoy se hacen desde el portal del PAC.
          </p>
        </>
      )}
    </section>
  );
}
