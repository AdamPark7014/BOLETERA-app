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
import { Suspense, useCallback, useMemo, useState } from 'react';
import { Field, Money, ParameterCard, TicketButton, formatTicketAmount } from '@boletera/ui';
import { ApiError, adminApi } from '@/lib/api';
import { AnonymousView, NoOrgView, useSession } from '../../_shared/api-state';
import { AdminFrame } from '../../_ticket/AdminFrame';
import { Param } from '../../_ticket/controls';
import frame from '../../_ticket/frame.module.scss';
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

const amount = (value: string | number) => Number(value) || 0;

export default function CancelEventPage() {
  return (
    <Suspense fallback={null}>
      <AdminFrame>
        <CancelBody />
      </AdminFrame>
    </Suspense>
  );
}

function CancelBody() {
  const params = useParams<{ id: string }>();
  const router = useRouter();
  const session = useSession();
  const eventId = params?.id ?? '';
  const token = session.token;

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
    [token, eventId, reason, attributable, justification]
  );

  async function project() {
    setBusy(true);
    setError(null);
    setOutcome(null);
    setConfirmOpen(false);
    setTypedTitle('');
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
    [typedTitle, projection]
  );

  if (session.status === 'anonymous') return <AnonymousView />;
  if (session.status === 'no-org') return <NoOrgView />;
  if (session.status === 'loading' || !token)
    return <p className={frame.quiet}>Cargando cancelación.</p>;

  // --- Resultado -----------------------------------------------------------
  if (outcome) {
    const partial = outcome.failed.length > 0;
    return (
      <section>
        <header className={frame.sectionHead}>
          <h1 className={frame.sectionTitle}>Evento cancelado · {outcome.eventTitle}</h1>
          <p className={frame.quiet}>
            {partial
              ? 'La cancelación se asentó, pero algunas devoluciones quedaron pendientes de reintentar.'
              : 'El evento quedó cancelado y todas las devoluciones se asentaron.'}
          </p>
        </header>
        <div className={styles.section}>
          <Param name="Órdenes devueltas">
            <ParameterCard
              name="Órdenes devueltas"
              value={`${outcome.ordersRefunded} de ${outcome.ordersAffected}`}
              valueStyle="tabular"
              effect="Órdenes pagadas con devolución asentada."
            />
          </Param>
          <div className={styles.figures}>
            <Money
              label="Devuelto"
              amount={amount(outcome.refundedTotal)}
              currency
              direction="out"
            />
            <Money
              label="Bonificación · art. 92 Bis LFPC"
              amount={amount(outcome.compensationTotal)}
              currency
              direction="out"
            />
          </div>
        </div>

        {partial ? (
          <div className={styles.section}>
            <h2 className={styles.subTitle}>Devoluciones pendientes</h2>
            <p className={frame.quiet}>
              Estas órdenes no se pudieron devolver. Revísalas y reintenta desde la cola de
              reembolsos.
            </p>
            <ul className={frame.rows}>
              {outcome.failed.map((f) => (
                <li key={f.publicId} className={frame.row}>
                  <div className={frame.rowMain}>
                    <p className={frame.rowTitle}>
                      <Link href={`/orders/${f.publicId}`} className={frame.mono}>
                        {f.publicId}
                      </Link>
                    </p>
                    <p className={frame.rowMeta}>{f.error}</p>
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ) : null}

        <TicketButton variant="secondary" onClick={() => router.push('/events')}>
          Volver a eventos
        </TicketButton>
      </section>
    );
  }

  // --- Formulario ----------------------------------------------------------
  return (
    <section>
      <header className={frame.sectionHead}>
        <h1 className={frame.sectionTitle}>Cancelar evento</h1>
        <p className={frame.quiet}>
          Operación irreversible. Se cierra la venta, se devuelve el dinero de todas las órdenes
          pagadas y se avisa a cada comprador.
        </p>
      </header>

      {error ? (
        <p className={frame.danger} role="alert">
          {error}
        </p>
      ) : null}

      <div className={styles.section}>
        <h2 className={styles.subTitle}>Motivo</h2>
        <label className={styles.area}>
          <span className={styles.label}>Motivo de la cancelación</span>
          <textarea
            className={styles.textarea}
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            rows={3}
            placeholder="El artista canceló la gira por motivos de salud"
            aria-describedby="reason-hint"
          />
          <span id="reason-hint" className={reasonValid ? frame.tertiary : frame.quiet}>
            {reasonValid
              ? 'Se enviará tal cual a los compradores.'
              : 'Al menos 10 caracteres. Lo lee cada comprador.'}
          </span>
        </label>
      </div>

      <div className={styles.section}>
        <h2 className={styles.subTitle}>¿La causa es imputable al promotor?</h2>
        <p className={frame.quiet}>
          De esta respuesta depende una obligación legal: si la cancelación es imputable, además del
          reembolso completo procede una bonificación mínima del 20% de lo pagado (LFPC art. 92
          Bis).
        </p>
        <div className={styles.choices} role="radiogroup" aria-label="Imputabilidad">
          <button
            type="button"
            role="radio"
            aria-checked={attributable === true}
            className={
              attributable === true ? `${styles.choice} ${styles.choiceOn}` : styles.choice
            }
            onClick={() => setAttributable(true)}
          >
            <span className={styles.choiceTitle}>Sí, es imputable</span>
            <span className={frame.quiet}>Decisión del promotor, artista o vendedor.</span>
            <span className={frame.tertiary}>Reembolso y bonificación del 20%</span>
          </button>
          <button
            type="button"
            role="radio"
            aria-checked={attributable === false}
            className={
              attributable === false ? `${styles.choice} ${styles.choiceOn}` : styles.choice
            }
            onClick={() => setAttributable(false)}
          >
            <span className={styles.choiceTitle}>No es imputable</span>
            <span className={frame.quiet}>Causa externa respaldada por autoridad competente.</span>
            <span className={frame.tertiary}>Solo reembolso</span>
          </button>
        </div>

        {attributable === false ? (
          <label className={styles.area}>
            <span className={styles.label}>Justificación (queda en la bitácora)</span>
            <textarea
              className={styles.textarea}
              value={justification}
              onChange={(e) => setJustification(e.target.value)}
              rows={2}
              placeholder="Aviso de Protección Civil del 16 de agosto de 2026"
              aria-describedby="justification-hint"
            />
            <span
              id="justification-hint"
              className={justificationValid ? frame.tertiary : frame.quiet}
            >
              {justificationValid
                ? 'Se auditará junto con la cancelación.'
                : 'Obligatoria: es lo que sustenta no pagar la bonificación.'}
            </span>
          </label>
        ) : null}
      </div>

      <div className={styles.section}>
        <h2 className={styles.subTitle}>Impacto</h2>
        <p className={frame.quiet}>
          Antes de mover un peso, calcula cuánto sale. Este paso no modifica nada.
        </p>
        <div className={styles.actions}>
          <TicketButton onClick={() => void project()} disabled={!canProject}>
            {busy && !confirmOpen
              ? 'Calculando'
              : projection
                ? 'Recalcular impacto'
                : 'Calcular impacto'}
          </TicketButton>
        </div>

        {projection ? (
          <>
            <Param name="Órdenes afectadas">
              <ParameterCard
                name="Órdenes afectadas"
                value={String(projection.ordersAffected)}
                valueStyle="tabular"
                effect="Órdenes pagadas que se devolverán."
              />
            </Param>
            <div className={styles.figures}>
              <Money label="A devolver" amount={amount(projection.refundableTotal)} currency />
              <Money
                label={
                  projection.compensationRate > 0
                    ? `Bonificación · ${Math.round(projection.compensationRate * 100)}% art. 92 Bis`
                    : 'Bonificación · no aplica'
                }
                amount={amount(projection.compensationTotal)}
                currency
              />
              <Money
                label="Salida total"
                amount={amount(projection.grandTotal)}
                currency
                direction="out"
              />
            </div>

            {confirmOpen ? (
              <div className={styles.confirm} role="group" aria-label="Confirmar cancelación">
                <p className={styles.subTitle}>Confirmar cancelación</p>
                <p className={frame.quiet}>
                  Esta acción no se puede deshacer. Se devolverán{' '}
                  <span className={frame.out}>
                    {formatTicketAmount(amount(projection.grandTotal))} MXN
                  </span>{' '}
                  a {projection.ordersAffected} órdenes, se cerrará la venta y se avisará a cada
                  comprador.
                </p>
                {/* Escribir el nombre es la fricción que distingue una decisión de un
                    clic equivocado en la pestaña de al lado. */}
                <Field
                  label={`Escribe «${projection.eventTitle}» para confirmar`}
                  value={typedTitle}
                  onChange={(e) => setTypedTitle(e.target.value)}
                  autoComplete="off"
                  error={
                    typedTitle.length > 0 && !titleMatches ? 'El nombre no coincide.' : undefined
                  }
                />
                <div className={styles.actions}>
                  <TicketButton
                    variant="danger"
                    onClick={() => void execute()}
                    disabled={!titleMatches || busy}
                  >
                    {busy ? 'Cancelando' : 'Cancelar definitivamente'}
                  </TicketButton>
                  <TicketButton
                    variant="ghost"
                    onClick={() => setConfirmOpen(false)}
                    disabled={busy}
                  >
                    No cancelar
                  </TicketButton>
                </div>
              </div>
            ) : (
              <div className={styles.actions}>
                <TicketButton variant="danger" onClick={() => setConfirmOpen(true)}>
                  Cancelar evento y devolver {formatTicketAmount(amount(projection.grandTotal))} MXN
                </TicketButton>
              </div>
            )}
          </>
        ) : (
          <p className={frame.tertiary}>
            Completa el motivo y la imputabilidad para calcular el impacto.
          </p>
        )}
      </div>
    </section>
  );
}
