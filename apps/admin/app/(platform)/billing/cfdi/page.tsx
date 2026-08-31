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
import {
  Badge,
  Button,
  DataTable,
  EmptyState,
  FilterBar,
  Input,
  KpiCard,
  PageHeader,
  Section,
  formatNumber,
  type DataTableColumn,
  type FilterDefinition,
} from '@boletera/ui';
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
import { formatMoney } from '../../orders/_ui/format';
import { formatDateTime } from './_lib/format';
import {
  FILTER_OPTIONS,
  STATUS_MEANING,
  invoiceMatchesQuery,
  invoiceStatusMeta,
  matchesInvoiceFilter,
  summarizeInvoices,
} from './_lib/invoices';
import { useCfdiUrlState } from './_lib/use-cfdi-url-state';
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
    const [profile, invoices] = await Promise.all([
      getFiscalProfile(token, orgId),
      listCfdiInvoices(token, orgId),
    ]);
    return { profile, invoices } satisfies BillingData;
  }, []);

  const resource = useResource<BillingData>(loader, { requiresOrg: true });

  return (
    <div className={styles.page}>
      <PageHeader
        eyebrow="Finanzas"
        title="Facturación CFDI 4.0"
        description="Perfil fiscal del emisor, timbrado por orden y estado de cada comprobante"
        actions={
          <Button
            type="button"
            variant="outline"
            loading={resource.refreshing}
            loadingLabel="Actualizando…"
            onClick={() => resource.reload()}
          >
            Actualizar
          </Button>
        }
      />

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
        <Notice tone="warn" title="Sandbox / sin validez fiscal">
          <p>
            Todavía no hay perfil fiscal. Cualquier timbre en este entorno es{' '}
            <strong>sandbox</strong> y <strong>no es válido ante el SAT</strong>. Configura el
            emisor abajo solo para probar el flujo; para facturar de verdad necesitas un PAC en
            modo producción.
          </p>
        </Notice>
      ) : profile.pacMode !== 'production' ? (
        <Notice tone="warn" title="Modo sandbox — no válido fiscalmente">
          <p>
            Los timbres que emitas ahora <strong>no tienen validez ante el SAT</strong>: el UUID es
            simulado y sirve solo para probar el flujo. Cambia el perfil a modo producción con un
            PAC contratado para facturar de verdad.
          </p>
        </Notice>
      ) : null}

      <FiscalProfileForm profile={profile} onSaved={onChanged} />
      <StampForm profileReady={Boolean(profile?.active)} onStamped={onChanged} />
      <InvoiceSection invoices={invoices} />
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
    <Section
      title="Perfil fiscal del emisor"
      description="RFC, razón social y domicilio fiscal que el PAC valida al timbrar."
    >
      <form onSubmit={submit} noValidate>
        <div className={styles.formGrid}>
          <Input
            label="RFC del emisor"
            value={rfc}
            onChange={(e) => setRfc(e.target.value.toUpperCase())}
            autoComplete="off"
            spellCheck={false}
            maxLength={13}
            requiredMark
            required
            error={
              rfcInvalid
                ? 'Formato inválido. Son 12 caracteres para persona moral y 13 para persona física.'
                : undefined
            }
            hint={
              rfcInvalid
                ? undefined
                : '12 o 13 caracteres, como aparece en tu constancia de situación fiscal.'
            }
          />

          <Input
            label="Razón social"
            value={legalName}
            onChange={(e) => setLegalName(e.target.value)}
            requiredMark
            required
            hint="Sin régimen societario si tu constancia no lo incluye (CFDI 4.0 lo valida)."
          />

          <label className={styles.selectField}>
            <span>Régimen fiscal</span>
            <select
              className={styles.select}
              value={regimen}
              onChange={(e) => setRegimen(e.target.value)}
            >
              {Object.entries(REGIMEN_FISCAL).map(([code, label]) => (
                <option key={code} value={code}>
                  {code} · {label}
                </option>
              ))}
            </select>
          </label>

          <Input
            label="Código postal del domicilio fiscal"
            value={cp}
            onChange={(e) => setCp(e.target.value.replace(/\D/g, '').slice(0, 5))}
            inputMode="numeric"
            maxLength={5}
            requiredMark
            required
            hint="Es el lugar de expedición del comprobante."
          />

          <Input
            label="Serie"
            value={serie}
            onChange={(e) => setSerie(e.target.value.toUpperCase().slice(0, 10))}
            hint={
              profile
                ? `Siguiente folio: ${profile.nextFolio}. Lo asigna el servidor al timbrar.`
                : 'El folio lo asigna el servidor de forma consecutiva.'
            }
          />
        </div>

        {error ? (
          <p className={styles.formError} role="alert">
            {error}
          </p>
        ) : null}
        {saved && !error ? (
          <p className={styles.formSuccess} role="status">
            Perfil fiscal guardado.
          </p>
        ) : null}

        <div className={styles.formActions}>
          <Button type="submit" loading={saving} loadingLabel="Guardando…" disabled={rfcInvalid}>
            Guardar perfil
          </Button>
        </div>
      </form>
    </Section>
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
  const publico = receptorRfc.toUpperCase() === RFC_PUBLICO;

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

  return (
    <Section
      title="Timbrar una orden"
      description="Solo órdenes completadas. El RFC y uso de CFDI deben coincidir con la constancia del cliente."
    >
      {!profileReady ? (
        <Notice tone="warn" title="Timbrado deshabilitado">
          <p>Guarda primero el perfil fiscal del emisor: sin él el PAC rechaza la petición.</p>
        </Notice>
      ) : null}

      <form onSubmit={submit} noValidate>
        <div className={styles.formGrid}>
          <Input
            label="Orden a facturar"
            value={orderId}
            onChange={(e) => setOrderId(e.target.value.trim())}
            autoComplete="off"
            spellCheck={false}
            requiredMark
            required
            hint="Identificador interno de la orden. Solo se pueden timbrar órdenes completadas."
          />

          <Input
            label="RFC del receptor"
            value={receptorRfc}
            onChange={(e) => setReceptorRfc(e.target.value.toUpperCase())}
            autoComplete="off"
            spellCheck={false}
            maxLength={13}
            requiredMark
            required
            error={
              rfcInvalid
                ? 'Formato inválido. Revisa la constancia del cliente antes de timbrar.'
                : undefined
            }
            hint={
              rfcInvalid
                ? undefined
                : publico
                  ? `${RFC_PUBLICO} es el RFC genérico de público en general.`
                  : 'Debe coincidir exactamente con la constancia del cliente; el SAT no lo corrige.'
            }
          />

          <Input
            label="Nombre o razón social del receptor"
            value={receptorNombre}
            onChange={(e) => setReceptorNombre(e.target.value)}
            requiredMark
            required
          />

          <label className={styles.selectField}>
            <span>Uso de CFDI</span>
            <select className={styles.select} value={uso} onChange={(e) => setUso(e.target.value)}>
              {Object.entries(USO_CFDI).map(([code, label]) => (
                <option key={code} value={code}>
                  {code} · {label}
                </option>
              ))}
            </select>
            <span className={styles.subtle}>
              {publico
                ? 'Con el RFC genérico el SAT solo acepta S01 (sin efectos fiscales).'
                : 'Lo elige el cliente según cómo vaya a deducir el gasto.'}
            </span>
          </label>
        </div>

        {error ? (
          <p className={styles.formError} role="alert">
            {error}
          </p>
        ) : null}
        {ok && !error ? (
          <p className={styles.formSuccess} role="status">
            {ok}
          </p>
        ) : null}

        <div className={styles.formActions}>
          <Button
            type="submit"
            loading={busy}
            loadingLabel="Timbrando…"
            disabled={rfcInvalid || !profileReady}
          >
            Timbrar CFDI
          </Button>
        </div>
      </form>
    </Section>
  );
}

/* ── Listado ─────────────────────────────────────────────────────────────── */

function InvoiceSection({ invoices }: { invoices: CfdiInvoice[] }) {
  const url = useCfdiUrlState();
  const totals = useMemo(() => summarizeInvoices(invoices), [invoices]);

  const filterDefs = useMemo<FilterDefinition[]>(() => {
    const counts = {
      OK: invoices.filter((inv) => matchesInvoiceFilter(inv, 'OK')).length,
      PENDING: invoices.filter((inv) => matchesInvoiceFilter(inv, 'PENDING')).length,
      ERROR: invoices.filter((inv) => matchesInvoiceFilter(inv, 'ERROR')).length,
    };
    return [
      {
        id: 'status',
        label: 'Estado',
        multiple: false,
        options: FILTER_OPTIONS.filter((o) => o.value !== 'ALL').map((o) => ({
          value: o.value,
          label: o.label,
          count: counts[o.value as keyof typeof counts] ?? 0,
        })),
      },
    ];
  }, [invoices]);

  const filtered = useMemo(() => {
    const needle = url.q.trim().toLowerCase();
    return invoices.filter((inv) => {
      if (!matchesInvoiceFilter(inv, url.filter)) return false;
      return invoiceMatchesQuery(inv, needle);
    });
  }, [invoices, url.filter, url.q]);

  const anyFilter = url.filter !== 'ALL' || Boolean(url.q.trim());

  const columns = useMemo<readonly DataTableColumn<CfdiInvoice>[]>(
    () => [
      {
        key: 'status',
        header: 'Estado',
        width: 220,
        sortValue: (row) => row.status,
        render: (row) => {
          const meta = invoiceStatusMeta(row);
          return (
            <div className={styles.statusCell}>
              <Badge tone={meta.tone} variant="soft" size="sm">
                {meta.label}
              </Badge>
              <span className={styles.statusHint}>{STATUS_MEANING[row.status as CfdiStatus]}</span>
            </div>
          );
        },
      },
      {
        key: 'folio',
        header: 'Folio',
        width: 140,
        sortValue: (row) => `${row.serie}-${String(row.folio).padStart(6, '0')}`,
        render: (row) => (
          <div className={styles.folioCell}>
            <strong>
              {row.serie}-{row.folio}
            </strong>
            <span className={styles.subtle}>
              {row.tipo === 'E' ? 'Egreso (nota de crédito)' : 'Ingreso'}
            </span>
          </div>
        ),
      },
      {
        key: 'receptor',
        header: 'Receptor',
        width: 200,
        sortValue: (row) => row.receptorRfc,
        render: (row) => (
          <div className={styles.receptorCell}>
            <span className={styles.rfc}>{row.receptorRfc}</span>
            <span className={styles.subtle}>{row.receptorNombre}</span>
          </div>
        ),
      },
      {
        key: 'uso',
        header: 'Uso CFDI',
        width: 180,
        sortValue: (row) => row.receptorUsoCfdi,
        render: (row) => (
          <div className={styles.receptorCell}>
            <span className={styles.rfc}>{row.receptorUsoCfdi}</span>
            <span className={styles.subtle}>
              {USO_CFDI[row.receptorUsoCfdi] ?? 'clave fuera del catálogo cargado'}
            </span>
          </div>
        ),
      },
      {
        key: 'total',
        header: 'Total',
        width: 160,
        align: 'right',
        sortValue: (row) => Number(row.total),
        render: (row) => (
          <div className={styles.money}>
            <div>{formatMoney(row.total, row.currency)}</div>
            <span className={styles.subtle}>
              Subtotal {formatMoney(row.subtotal, row.currency)} · IVA{' '}
              {formatMoney(row.iva, row.currency)}
            </span>
          </div>
        ),
      },
      {
        key: 'uuid',
        header: 'UUID / timbrado',
        width: 260,
        sortValue: (row) => row.stampedAt ?? row.createdAt,
        render: (row) =>
          row.uuid ? (
            <div className={styles.receptorCell}>
              <span className={styles.uuid}>{row.uuid}</span>
              <span className={styles.when}>
                {row.stampedAt
                  ? `Timbrada el ${formatDateTime(row.stampedAt)}`
                  : `Creada el ${formatDateTime(row.createdAt)}`}
              </span>
            </div>
          ) : (
            <div className={styles.receptorCell}>
              <span className={styles.subtle}>Sin UUID: no llegó a timbrarse.</span>
              <span className={styles.when}>Creada el {formatDateTime(row.createdAt)}</span>
            </div>
          ),
      },
    ],
    [],
  );

  function clearFilters() {
    url.setSearch('');
    url.setFilterSelection({});
  }

  return (
    <Section
      title="Comprobantes emitidos"
      description="Últimos comprobantes de la organización, del más reciente al más antiguo."
    >
      {invoices.length > 0 ? (
        <>
          <Section columns={4} gap="md" className={styles.kpiStrip}>
            <KpiCard
              label="Timbradas"
              value={formatNumber(totals.stampedCount)}
              tone="success"
            />
            <KpiCard
              label="Pendientes"
              value={formatNumber(totals.draftCount)}
              tone={totals.draftCount > 0 ? 'warning' : 'neutral'}
              invertDelta
            />
            <KpiCard label="Canceladas" value={formatNumber(totals.cancelledCount)} />
            <KpiCard
              label="Con error"
              value={formatNumber(totals.errorCount)}
              tone={totals.errorCount > 0 ? 'danger' : 'neutral'}
              invertDelta
            />
          </Section>

          {totals.errorCount > 0 ? (
            <Notice tone="danger" title={`${totals.errorCount} comprobante(s) con error de timbrado`}>
              <p>
                El PAC rechazó el timbre. El motivo va debajo de cada fila; los rechazos más comunes
                son RFC del receptor que no existe en el padrón, uso de CFDI incompatible con el
                régimen del receptor, o un código postal de expedición que no coincide con la
                constancia del emisor. Corrige el dato y vuelve a timbrar la misma orden.
              </p>
            </Notice>
          ) : null}

          <div className={styles.toolbar}>
            <FilterBar
              className={styles.filterBar}
              filters={filterDefs}
              value={url.filterSelection}
              onChange={url.setFilterSelection}
              search={{
                value: url.q,
                onChange: url.setSearch,
                placeholder: 'UUID, RFC, folio u orden…',
              }}
            />
            <div className={styles.filterMeta}>
              <span>
                {filtered.length} de {invoices.length} comprobantes
                {anyFilter ? ' coinciden con los filtros' : ''}.
              </span>
              {anyFilter ? (
                <button type="button" className={styles.clearBtn} onClick={clearFilters}>
                  Limpiar filtros
                </button>
              ) : null}
            </div>
          </div>

          <DataTable
            label="Comprobantes CFDI de la organización"
            columns={columns}
            data={filtered}
            rowKey={(row) => row.id}
            defaultSort={{ key: 'uuid', direction: 'desc' }}
            rowHeight={48}
            renderExpanded={(row) =>
              row.status === 'ERROR' ? (
                <div className={styles.errorDetail}>
                  <strong>Motivo del PAC: </strong>
                  <code>{row.errorMessage ?? 'el PAC no devolvió detalle'}</code>
                </div>
              ) : (
                <span className={styles.subtle}>Sin detalle adicional para este comprobante.</span>
              )
            }
            empty={
              <EmptyState
                title="Ningún comprobante coincide con los filtros"
                description="Prueba otra búsqueda o quita algún filtro de estado."
                action={
                  anyFilter ? (
                    <Button type="button" variant="outline" onClick={clearFilters}>
                      Limpiar filtros
                    </Button>
                  ) : undefined
                }
              />
            }
          />

          <p className={styles.footnote}>
            La cancelación ante el SAT y la descarga del XML/PDF todavía no están expuestas por el
            API; hoy se hacen desde el portal del PAC.
          </p>
        </>
      ) : (
        <EmptyState
          title="Sin comprobantes timbrados"
          description="En cuanto factures una orden aparecerá aquí con su UUID y su estado."
        />
      )}
    </Section>
  );
}
