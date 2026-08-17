'use client';

import { HoldCountdown } from '@/components/HoldCountdown';
import { formatDeadline } from '@/lib/payment-window';
import { formatMoney } from '@/lib/pricing';
import { CopyField } from './CopyField';
import styles from './order.module.scss';

/**
 * Pago diferido (OXXO / SPEI): la pantalla que el comprador tiene delante
 * mientras camina a la tienda o abre la app del banco.
 *
 * Lo que falla en producción no es el diseño, son los datos incompletos: una
 * referencia sin importe exacto se paga por otra cantidad y no se acredita; una
 * CLABE sin concepto llega sin poder conciliarse; y una fecha límite inventada
 * («tienes 15 minutos») contradice la ventana real de 24 h que el API ya
 * reserva. Por eso los cuatro datos —referencia, CLABE, importe y fecha
 * límite— salen SIEMPRE de la orden, y la cuenta atrás cuelga del `expiresAt`
 * que devolvió el servidor.
 */
export function DeferredPaymentPanel({
  method,
  reference,
  clabe,
  concept,
  amount,
  currency = 'MXN',
  expiresAt,
  demo = false,
  onExpire,
}: {
  method: 'SPEI' | 'OXXO';
  reference?: string | null;
  clabe?: string | null;
  concept?: string | null;
  amount?: string | number | null;
  currency?: string;
  /** Fecha límite REAL devuelta por el API (`order.expiresAt`). */
  expiresAt?: string | null;
  demo?: boolean;
  onExpire?: () => void;
}) {
  const isSpei = method === 'SPEI';
  const deadline = formatDeadline(expiresAt);
  const exactAmount = amount != null && amount !== '' ? formatMoney(amount, currency) : null;
  // Agrupar de 4 en 4 hace legible una CLABE de 18 dígitos; se copia limpia.
  const clabeDisplay = clabe ? clabe.replace(/(\d{4})(?=\d)/g, '$1 ') : null;

  return (
    <section className={styles.section} aria-label={`Instrucciones de pago ${method}`}>
      <h2>{isSpei ? 'Paga por transferencia SPEI' : 'Paga en cualquier OXXO'}</h2>

      {demo && (
        <p className={styles.demoNote} role="status">
          Modo demo: estos datos son de prueba. No transfieras dinero real.
        </p>
      )}

      {expiresAt && (
        <HoldCountdown
          expiresAt={expiresAt}
          variant="payment"
          // Media hora de aviso: en una ventana de 12-24 h, avisar a los dos
          // minutos no le sirve a nadie.
          warnSeconds={30 * 60}
          showDeadline
          onExpire={onExpire}
          label="Tiempo para pagar"
          hint={
            isSpei
              ? 'Tus lugares están apartados hasta esta fecha'
              : 'Tus lugares están apartados hasta esta fecha. Llévala contigo a la tienda.'
          }
          expiredHint="La referencia venció y los lugares volvieron a la venta. No se realizó ningún cargo."
        />
      )}

      <ol className={styles.steps2}>
        {isSpei ? (
          <>
            <li>Abre la app de tu banco y elige transferencia SPEI a otro banco.</li>
            <li>Captura la CLABE y el concepto exactamente como aparecen aquí.</li>
            <li>Transfiere el importe exacto. Otra cantidad no se acredita automáticamente.</li>
          </>
        ) : (
          <>
            <li>Ve a cualquier tienda OXXO y di que vas a hacer un pago de servicio.</li>
            <li>Dicta la referencia al cajero.</li>
            <li>Paga el importe exacto y conserva tu ticket hasta recibir los boletos.</li>
          </>
        )}
      </ol>

      <div className={styles.payGrid}>
        {isSpei && clabe && (
          <CopyField
            label="CLABE"
            value={clabe}
            display={clabeDisplay ?? clabe}
            hint="Cuenta Banorte del promotor"
          />
        )}
        {isSpei && concept && (
          <CopyField
            label="Concepto / referencia"
            value={concept}
            hint="Cópialo tal cual: sin él no podemos identificar tu pago"
          />
        )}
        {!isSpei && reference && (
          <CopyField label="Referencia OXXO" value={reference} hint="Dísela al cajero" />
        )}
        {exactAmount && (
          <div className={styles.copyField}>
            <span className={styles.copyLabel}>Importe exacto</span>
            <div className={styles.copyRow}>
              <strong className={styles.amount}>{exactAmount}</strong>
            </div>
            <span className={styles.copyHint}>Incluye cargo por servicio e IVA</span>
          </div>
        )}
        {deadline && (
          <div className={styles.copyField}>
            <span className={styles.copyLabel}>Fecha límite</span>
            <div className={styles.copyRow}>
              <strong className={styles.amount}>{deadline}</strong>
            </div>
            <span className={styles.copyHint}>
              Después de esa hora la referencia deja de servir y los lugares vuelven a la venta.
            </span>
          </div>
        )}
      </div>

      <p className={styles.instructionsNote}>
        {demo
          ? 'En demo puedes simular el acreditamiento con el botón de abajo.'
          : 'Actualizamos esta pantalla sola en cuanto el banco acredita tu pago. También te llega por correo.'}
      </p>
    </section>
  );
}
