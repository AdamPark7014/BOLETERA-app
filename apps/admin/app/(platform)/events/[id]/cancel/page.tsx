'use client';

/**
 * Cancelación de evento.
 *
 * El servicio existía y estaba probado, pero solo se podía invocar por API. Esta
 * pantalla es la que permite ejecutarlo sin curl — y, sobre todo, la que obliga
 * a mirar el impacto antes de moverlo.
 *
 * DOS DECISIONES DE DISEÑO, ambas por la misma razón: cancelar mueve el dinero
 * de un aforo completo y es irreversible.
 *
 *  1. NO HAY BOTÓN DIRECTO DE CANCELAR. Primero se calcula el impacto
 *     (`dryRun`), y solo entonces aparece la confirmación con las cifras reales
 *     delante. Un operador cansado no debe poder vaciar un evento de un clic.
 *  2. LA CONFIRMACIÓN PIDE ESCRIBIR EL NOMBRE DEL EVENTO. Es la única fricción
 *     que distingue «quería cancelar éste» de «me equivoqué de pestaña».
 *
 * La bonificación del 20% no es una preferencia de la interfaz: es el art. 92
 * Bis de la LFPC. Por eso la pregunta de imputabilidad es obligatoria y se
 * presenta como lo que es —una determinación con consecuencia legal— y no como
 * una casilla más.
 */

import Link from 'next/link';
import { useParams, useRouter } from 'next/navigation';
import { useCallback, useMemo, useState } from 'react';
import {
  Badge,
  Button,
  KpiCard,
  Modal,
  PageHeader,
  Section,
} from '@boletera/ui';
import { ApiError, adminApi, getStoredToken } from '@/lib/api';
import styles from './cancel.module.scss';

/** Proyección que devuelve el API en modo `dryRun`. */
type Projection = {
  dryRun: true;
  eventId: string;
  eventTitle: string;
  ordersAffected: number;
  refundableTotal: string;
  compensationTotal: string;
  grandTotal: string;
  compensationRate: number;
};

/** Resultado de la ejecución real. */
type Outcome = {
  dryRun: false;
  eventTitle: string;
  ordersAffected: number;
  ordersRefunded: number;
  refundedTotal: string;
  compensationTotal: string;
  failed: { publicId: string; error: string }[];
};

const money = (value: string | number) =>
  `$${Number(value).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })} MXN`;

export default function CancelEventPage() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const eventId = params?.id ?? '';

  const [reason, setReason] = useState('');
  const [attributable, setAttributable] = useState<boolean | null>(null);
  const [justification, setJustification] = useState('');
  const [projection, setProjection] = useState<Projection | null>(null);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const [typedTitle, setTypedTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  /** El motivo lo lee el comprador en el correo: no puede ir vacío ni ser «x». */
  const reasonValid = reason.trim().length >= 10;
  const attributionAnswered = attributable !== null;
  const justificationValid = attributable !== false || justification.trim().length >= 10;
  const canProject = reasonValid && attributionAnswered && justificationValid && !busy;

  const call = useCallback(
    async (dryRun: boolean) => {
      const token = getStoredToken();
      if (!token) throw new ApiError(401, 'Sin sesión', null, '');
      return adminApi<Projection | Outcome>(`/payments/events/${eventId}/cancel`, token, {
        method: 'POST',
        body: JSON.stringify({
          reason: reason.trim(),
          attributable,
          justification: justification.trim() || undefined,
          dryRun,
        }),
      });
    },
    [eventId, reason, attributable, justification],
  );

  async function project() {
    setBusy(true);
    setError(null);
    setOutcome(null);
    try {
      const result = (await call(true)) as Projection;
      setProjection(result);
    } catch (e) {
      setError(e instanceof ApiError ? e.userMessage : 'No se pudo calcular el impacto.');
    } finally {
      setBusy(false);
    }
  }

  async function execute() {
    setBusy(true);
    setError(null);
    try {
      const result = (await call(false)) as Outcome;
      setOutcome(result);
      setConfirmOpen(false);
      setProjection(null);
    } catch (e) {
      setError(e instanceof ApiError ? e.userMessage : 'No se pudo cancelar el evento.');
      setConfirmOpen(false);
    } finally {
      setBusy(false);
    }
  }

  const titleMatches = useMemo(
    () => typedTitle.trim().toLowerCase() === (projection?.eventTitle ?? '').trim().toLowerCase(),
    [typedTitle, projection],
  );

  // --- Resultado -----------------------------------------------------------
  if (outcome) {
    const partial = outcome.failed.length > 0;
    return (
      <>
        <PageHeader
          eyebrow="Evento cancelado"
          title={outcome.eventTitle}
          breadcrumbs={[
            { label: 'Eventos', href: '/events' },
            { label: 'Cancelación' },
          ]}
          description={
            partial
              ? 'La cancelación se asentó, pero algunas devoluciones quedaron pendientes de reintentar.'
              : 'El evento quedó cancelado y todas las devoluciones se asentaron.'
          }
          actions={
            <Button variant="secondary" onClick={() => router.push('/events')}>
              Volver a eventos
            </Button>
          }
          bordered
        />

        <Section columns={3} gap="md">
          <KpiCard label="Órdenes devueltas" value={`${outcome.ordersRefunded} / ${outcome.ordersAffected}`} />
          <KpiCard label="Devuelto" value={money(outcome.refundedTotal)} />
          <KpiCard
            label="Bonificación"
            value={money(outcome.compensationTotal)}
            hint="Art. 92 Bis LFPC"
          />
        </Section>

        {partial && (
          <Section
            title="Devoluciones pendientes"
            description="Estas órdenes no se pudieron devolver. Revísalas y reintenta desde la cola de reembolsos."
          >
            <ul className={styles.failedList}>
              {outcome.failed.map((f) => (
                <li key={f.publicId}>
                  <Link href={`/orders/${f.publicId}`}>{f.publicId}</Link>
                  <span>{f.error}</span>
                </li>
              ))}
            </ul>
          </Section>
        )}
      </>
    );
  }

  // --- Formulario ----------------------------------------------------------
  return (
    <>
      <PageHeader
        eyebrow="Operación irreversible"
        title="Cancelar evento"
        breadcrumbs={[
          { label: 'Eventos', href: '/events' },
          { label: 'Cancelación' },
        ]}
        description="Se cierra la venta, se devuelve el dinero de todas las órdenes pagadas y se avisa a cada comprador."
        bordered
      />

      {error && (
        <p className={styles.error} role="alert">
          {error}
        </p>
      )}

      <Section
        title="Motivo"
        description="Este texto se envía tal cual en el correo a cada comprador. Escríbelo pensando en quien lo va a leer."
      >
        <label className={styles.field}>
          <span>Motivo de la cancelación</span>
          <textarea
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="El artista canceló la gira por motivos de salud"
            aria-describedby="reason-hint"
          />
          <small id="reason-hint" className={reasonValid ? styles.hint : styles.hintWarn}>
            {reasonValid ? 'Se enviará a los compradores.' : 'Al menos 10 caracteres.'}
          </small>
        </label>
      </Section>

      <Section
        title="¿La causa es imputable al promotor?"
        description="De esta respuesta depende una obligación legal: si la cancelación es imputable, además del reembolso completo procede una bonificación mínima del 20% de lo pagado (LFPC art. 92 Bis)."
      >
        <div className={styles.choices} role="radiogroup" aria-label="Imputabilidad">
          <button
            type="button"
            role="radio"
            aria-checked={attributable === true}
            className={attributable === true ? styles.choiceOn : styles.choice}
            onClick={() => setAttributable(true)}
          >
            <strong>Sí, es imputable</strong>
            <span>Decisión del promotor, artista o vendedor.</span>
            <Badge tone="warning">Bonificación 20%</Badge>
          </button>

          <button
            type="button"
            role="radio"
            aria-checked={attributable === false}
            className={attributable === false ? styles.choiceOn : styles.choice}
            onClick={() => setAttributable(false)}
          >
            <strong>No es imputable</strong>
            <span>Causa externa respaldada por autoridad competente.</span>
            <Badge tone="neutral">Solo reembolso</Badge>
          </button>
        </div>

        {attributable === false && (
          <label className={styles.field}>
            <span>Justificación (queda en la bitácora)</span>
            <textarea
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              rows={2}
              placeholder="Aviso de Protección Civil del 16 de agosto de 2026"
              aria-describedby="justification-hint"
            />
            <small id="justification-hint" className={justificationValid ? styles.hint : styles.hintWarn}>
              {justificationValid
                ? 'Se auditará junto con la cancelación.'
                : 'Obligatoria: es lo que sustenta no pagar la bonificación.'}
            </small>
          </label>
        )}
      </Section>

      <Section
        title="Impacto"
        description="Antes de mover un peso, calcula cuánto sale. Este paso no modifica nada."
        actions={
          <Button onClick={project} disabled={!canProject} loading={busy && !confirmOpen}>
            Calcular impacto
          </Button>
        }
      >
        {projection ? (
          <>
            <div className={styles.kpis}>
              <KpiCard label="Órdenes afectadas" value={String(projection.ordersAffected)} />
              <KpiCard label="A devolver" value={money(projection.refundableTotal)} />
              <KpiCard
                label="Bonificación"
                value={money(projection.compensationTotal)}
                hint={
                  projection.compensationRate > 0
                    ? `${Math.round(projection.compensationRate * 100)}% del art. 92 Bis`
                    : 'No aplica: causa no imputable'
                }
              />
              <KpiCard label="Salida total" value={money(projection.grandTotal)} tone="danger" />
            </div>
            <div className={styles.execute}>
              <Button variant="danger" onClick={() => setConfirmOpen(true)}>
                Cancelar evento y devolver {money(projection.grandTotal)}
              </Button>
            </div>
          </>
        ) : (
          <p className={styles.placeholder}>
            Completa el motivo y la imputabilidad para calcular el impacto.
          </p>
        )}
      </Section>

      <Modal
        open={confirmOpen}
        onClose={() => setConfirmOpen(false)}
        title="Confirmar cancelación"
        description="Esta acción no se puede deshacer."
        footer={
          <>
            <Button variant="ghost" onClick={() => setConfirmOpen(false)} disabled={busy}>
              No cancelar
            </Button>
            <Button variant="danger" onClick={execute} disabled={!titleMatches || busy} loading={busy}>
              Cancelar definitivamente
            </Button>
          </>
        }
      >
        <p>
          Se devolverán <strong>{money(projection?.grandTotal ?? 0)}</strong> a{' '}
          <strong>{projection?.ordersAffected ?? 0}</strong> órdenes, se cerrará la venta y se
          avisará a cada comprador.
        </p>
        <label className={styles.field}>
          {/* Escribir el nombre es la fricción que distingue una decisión de un
              clic equivocado en la pestaña de al lado. */}
          <span>
            Escribe <strong>{projection?.eventTitle}</strong> para confirmar
          </span>
          <input
            value={typedTitle}
            onChange={(e) => setTypedTitle(e.target.value)}
            autoComplete="off"
            aria-invalid={typedTitle.length > 0 && !titleMatches}
          />
        </label>
      </Modal>
    </>
  );
}
