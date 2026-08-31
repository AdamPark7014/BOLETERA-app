import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalDraftNotice } from '@/components/LegalDraftNotice';
import { SiteHeader } from '@/components/SiteHeader';
import styles from '../legal.module.scss';

export const metadata: Metadata = {
  title: 'Términos y condiciones | Boletera',
  description:
    'Términos de uso de Boletera, política de reembolsos y cambios, reventa oficial y transferencia de boletos.',
};

/*
 * BORRADOR. La sección de reembolsos existe porque la Ley Federal de Protección
 * al Consumidor exige que las condiciones de cancelación, devolución y cambios
 * estén publicadas y sean accesibles antes de pagar; por eso se enlaza desde el
 * pie, desde la ficha del evento y desde Ayuda.
 */
export default function TerminosPage() {
  return (
    <>
      <SiteHeader />
      <main id="contenido" tabIndex={-1} className={styles.page}>
        <h1>Términos y condiciones</h1>
        <p className={styles.updated}>Última actualización: agosto de 2026</p>

        <LegalDraftNotice className={styles.draftNotice}>
          <strong>Borrador pendiente de revisión legal</strong>
          <p>
            Redactado internamente como base de trabajo. No ha sido revisado por el área
            legal y los datos entre corchetes están sin completar, así que no debe
            considerarse el texto contractual definitivo.
          </p>
        </LegalDraftNotice>

        <nav className={styles.toc} aria-label="Contenido de los términos">
          <h2>En esta página</h2>
          <ul>
            <li>
              <a href="#servicio">Qué es Boletera</a>
            </li>
            <li>
              <a href="#compras">Compras y precios</a>
            </li>
            <li>
              <a href="#reembolsos">Reembolsos y cambios</a>
            </li>
            <li>
              <a href="#transferencia">Transferencia y reventa</a>
            </li>
            <li>
              <a href="#acceso">Acceso al evento</a>
            </li>
            <li>
              <a href="#cuentas">Cuentas</a>
            </li>
            <li>
              <a href="#contacto">Contacto y aclaraciones</a>
            </li>
          </ul>
        </nav>

        <h2 id="servicio">1. Qué es Boletera</h2>
        <p>
          Boletera es una plataforma de boletaje para promotores en México. Vendemos
          boletos <strong>por cuenta y orden del promotor</strong> de cada evento: él
          define el precio, el aforo, las fechas y las condiciones de acceso, y es el
          responsable de que el espectáculo se realice. Al usar el sitio web, el panel de
          administración o la taquilla aceptas estos términos.
        </p>

        <h2 id="compras">2. Compras y precios</h2>
        <ul>
          <li>
            Los precios se muestran en pesos mexicanos (MXN) e incluyen los impuestos
            aplicables. Los cargos por servicio se desglosan antes de pagar.
          </li>
          <li>
            El pago se procesa a través de Banorte (tarjeta, SPEI u OXXO, según el flujo
            que habilite el evento).
          </li>
          <li>
            Al elegir asientos se reservan temporalmente durante el tiempo indicado en la
            página del evento. Si el pago no se completa en ese plazo, vuelven a estar
            disponibles.
          </li>
          <li>
            La compra queda confirmada cuando recibes la orden con los boletos y su código
            QR. Guarda ese comprobante.
          </li>
        </ul>

        <h2 id="reembolsos">3. Política de reembolsos y cambios</h2>
        <p>
          Salvo que el promotor establezca condiciones más amplias en la ficha del evento,
          aplica lo siguiente:
        </p>
        <h3>Cancelación del evento</h3>
        <p>
          Si el promotor cancela el evento, se reembolsa el{' '}
          <strong>100 % del precio del boleto</strong>. El reembolso se realiza por el
          mismo medio de pago con el que compraste, sin que tengas que solicitarlo, dentro
          de los [X] días hábiles siguientes al aviso de cancelación. El plazo real de
          abono depende de tu banco.
        </p>
        <h3>Reprogramación o cambio de sede</h3>
        <p>
          Si cambia la fecha, el horario o el recinto, tu boleto sigue siendo válido para
          la nueva función. Si no puedes asistir, tienes{' '}
          <strong>[X] días naturales desde el aviso</strong> para pedir el reembolso del
          precio del boleto.
        </p>
        <h3>Cancelación por parte de la persona compradora</h3>
        <p>
          Los boletos de espectáculos no son reembolsables por cambio de opinión, salvo que
          el promotor lo permita expresamente en la ficha del evento. Cuando el promotor lo
          autoriza, la condición se indica en la sección «Información importante» de la
          página del evento antes de pagar.
        </p>
        <h3>Errores de cobro</h3>
        <p>
          Si detectas un cargo duplicado o un cobro que no reconoces, escríbenos y lo
          revisamos; si procede, se devuelve el importe completo.
        </p>
        <h3>Cargos por servicio</h3>
        <p>
          [Legal: definir si el cargo por servicio se reembolsa en cancelación del evento.
          Debe quedar explícito antes de publicar.]
        </p>
        <h3>Cómo solicitar un reembolso</h3>
        <ol>
          <li>
            Entra a <Link href="/cuenta">Mi cuenta</Link> y localiza la orden.
          </li>
          <li>
            Escribe a [soporte@dominio.mx] con el número de orden y el motivo, o
            contáctanos por los medios de la sección de <a href="#contacto">contacto</a>.
          </li>
          <li>
            Recibirás respuesta en un máximo de [X] días hábiles con la resolución y, si
            procede, la fecha estimada del abono.
          </li>
        </ol>

        <h2 id="transferencia">4. Transferencia y reventa oficial</h2>
        <ul>
          <li>
            Puedes ceder un boleto desde tu cuenta cuando el evento lo permite. El boleto
            original se invalida y el destinatario recibe uno nuevo con su propio QR.
          </li>
          <li>
            La reventa oficial tiene un tope de precio respecto del valor original del
            boleto. Fuera de la plataforma no podemos garantizar la validez de un boleto.
          </li>
          <li>
            Los eventos marcados como no transferibles no admiten cesión ni reventa.
          </li>
        </ul>

        <h2 id="acceso">5. Acceso al evento</h2>
        <p>
          Presenta el código QR desde tu celular o impreso. Cada código se escanea una sola
          vez. El promotor y el recinto pueden negar el acceso por seguridad, por
          reglamento interno o por clasificación de edad; esas condiciones se indican en la
          página del evento.
        </p>

        <h2 id="cuentas">6. Cuentas</h2>
        <p>
          Eres responsable de mantener la confidencialidad de tu contraseña. Por seguridad,
          la sesión caduca automáticamente tras un periodo de inactividad y al cambiar los
          datos de tu cuenta; en ese caso solo tienes que volver a entrar. Puedes
          restablecer tu contraseña desde el{' '}
          <Link href="/login/forgot">enlace de recuperación</Link>.
        </p>

        <h2 id="contacto">7. Contacto y aclaraciones</h2>
        <div className={styles.dataBlock}>
          <p>
            <strong>Atención a clientes:</strong> [soporte@dominio.mx]
          </p>
          <p>
            <strong>Teléfono:</strong> [teléfono] · [horario]
          </p>
          <p>
            <strong>Domicilio:</strong> [domicilio del operador]
          </p>
        </div>
        <p>
          Si no quedas conforme con la respuesta, puedes acudir a la Procuraduría Federal
          del Consumidor (PROFECO). [Legal: confirmar los datos de registro del contrato de
          adhesión, si aplica.]
        </p>

        <div className={styles.footerLinks}>
          <Link href="/privacidad">Aviso de privacidad</Link>
          <Link href="/privacidad#arco">Derechos ARCO</Link>
          <Link href="/ayuda">Ayuda</Link>
        </div>
      </main>
    </>
  );
}
