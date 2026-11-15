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
      <h2>{isSpei ? 'Transferencia SPEI' : 'Pago en OXXO'}</h2>

      {demo && (
        <p className={styles.demoNote} role="status">
          Modo demostración: datos de prueba, no transfieras dinero.
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
          hint="Tus lugares siguen apartados hasta entonces."
          expiredHint="La referencia venció y los lugares volvieron a la venta. No se realizó ningún cargo."
        />
      )}

      <div className={styles.payGrid}>
        {isSpei && clabe && (
          <CopyField
            label="CLABE"
            value={clabe}
            display={clabeDisplay ?? clabe}
            hint="Cuenta Banorte del promotor"
          />
        )}
        {isSpei && concept && <CopyField label="Referencia" value={concept} primary />}
        {!isSpei && reference && (
          <CopyField label="Referencia" value={reference} primary hint="Dísela al cajero." />
        )}
        {exactAmount && (
          <div className={styles.copyField}>
            <span className={styles.copyLabel}>Importe exacto</span>
            <div className={styles.copyRow}>
              <strong className={styles.amount}>{exactAmount}</strong>
            </div>
            <span className={styles.copyHint}>Incluye cargos e IVA</span>
          </div>
        )}
        {deadline && (
          <div className={styles.copyField}>
            <span className={styles.copyLabel}>Fecha límite</span>
            <div className={styles.copyRow}>
              <strong className={styles.amount}>{deadline}</strong>
            </div>
          </div>
        )}
      </div>
    </section>
  );
}
