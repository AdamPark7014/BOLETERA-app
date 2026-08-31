import type { Metadata } from 'next';
import Link from 'next/link';
import { LegalDraftNotice } from '@/components/LegalDraftNotice';
import { SiteHeader } from '@/components/SiteHeader';
import { fetchTenantCurrent } from '@/lib/tenant';
import styles from '../legal.module.scss';

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await fetchTenantCurrent();
  return {
    title: `Aviso de privacidad | ${tenant.name}`,
    description: `Aviso de privacidad de ${tenant.name}: responsable, finalidades, derechos ARCO y transferencias.`,
  };
}

/*
 * BORRADOR. El contenido sigue la estructura que la LFPDPPP y su Reglamento
 * piden para un aviso de privacidad integral (arts. 15, 16 y 17 LFPDPPP;
 * art. 30 del Reglamento): identidad y domicilio del responsable, datos
 * tratados, finalidades primarias y secundarias, medios para negarse a las
 * secundarias, transferencias, ejercicio de derechos ARCO, revocación del
 * consentimiento, limitación de uso y divulgación, uso de cookies y forma de
 * comunicar cambios.
 *
 * Los datos entre [corchetes] son marcadores que legal debe completar con la
 * razón social, el domicilio fiscal y el correo real del departamento de datos
 * personales antes de publicar.
 */
export default function PrivacidadPage() {
  return (
    <>
      <SiteHeader />
      <main id="contenido" tabIndex={-1} className={styles.page}>
        <h1>Aviso de privacidad</h1>
        <p className={styles.updated}>Última actualización: agosto de 2026</p>

        <LegalDraftNotice className={styles.draftNotice}>
          <strong>Borrador pendiente de revisión legal</strong>
          <p>
            Este texto es una propuesta interna redactada siguiendo la estructura que
            exige la LFPDPPP. Todavía no ha sido revisado ni validado por el área legal,
            y los datos entre corchetes están sin completar. No debe considerarse el
            aviso de privacidad definitivo de Boletera.
          </p>
        </LegalDraftNotice>

        <nav className={styles.toc} aria-label="Contenido del aviso">
          <h2>En esta página</h2>
          <ul>
            <li>
              <a href="#responsable">Responsable</a>
            </li>
            <li>
              <a href="#datos">Datos que tratamos</a>
            </li>
            <li>
              <a href="#finalidades">Finalidades</a>
            </li>
            <li>
              <a href="#transferencias">Transferencias</a>
            </li>
            <li>
              <a href="#arco">Derechos ARCO</a>
            </li>
            <li>
              <a href="#cookies">Cookies</a>
            </li>
            <li>
              <a href="#cambios">Cambios</a>
            </li>
          </ul>
        </nav>

        <h2 id="responsable">1. Identidad y domicilio del responsable</h2>
        <p>
          [Razón social del operador de Boletera], con domicilio en [calle, número,
          colonia, código postal, ciudad, estado, México], es responsable del tratamiento
          de tus datos personales.
        </p>
        <div className={styles.dataBlock}>
          <p>
            <strong>Correo del departamento de datos personales:</strong>{' '}
            [privacidad@dominio.mx]
          </p>
          <p>
            <strong>Teléfono de atención:</strong> [teléfono]
          </p>
          <p>
            <strong>Horario:</strong> [días y horario de atención]
          </p>
        </div>
        <p>
          Cuando compras un boleto, el promotor del evento actúa como responsable
          independiente respecto de los datos que necesita para operar el acceso al
          recinto. En ese caso también aplica el aviso de privacidad del propio promotor,
          que se muestra en la página del evento.
        </p>

        <h2 id="datos">2. Datos personales que tratamos</h2>
        <ul>
          <li>
            <strong>Identificación y contacto:</strong> nombre, apellidos, correo
            electrónico y, si lo proporcionas, teléfono.
          </li>
          <li>
            <strong>Datos de la compra:</strong> eventos, zonas, asientos, importes,
            historial de órdenes y boletos emitidos.
          </li>
          <li>
            <strong>Datos de pago:</strong> los procesa Banorte. Boletera no almacena el
            número completo de tarjeta ni el código de seguridad; solo conserva el
            identificador de la transacción y los últimos dígitos para conciliación.
          </li>
          <li>
            <strong>Datos fiscales:</strong> RFC, razón social y régimen fiscal,
            únicamente si solicitas factura (CFDI).
          </li>
          <li>
            <strong>Datos técnicos:</strong> dirección IP, tipo de dispositivo y
            navegador, con fines de seguridad y prevención de fraude.
          </li>
        </ul>
        <p>
          No tratamos datos personales sensibles ni datos de menores de edad de forma
          deliberada.
        </p>

        <h2 id="finalidades">3. Finalidades del tratamiento</h2>
        <h3>Finalidades primarias (necesarias para el servicio)</h3>
        <ul>
          <li>Crear y administrar tu cuenta, y autenticarte de forma segura.</li>
          <li>Procesar la compra, emitir los boletos y validar el acceso con QR.</li>
          <li>Enviarte confirmaciones, recordatorios y avisos sobre tus eventos.</li>
          <li>Gestionar transferencias, reventa oficial, cancelaciones y reembolsos.</li>
          <li>Emitir comprobantes fiscales cuando los solicitas.</li>
          <li>
            Prevenir fraude y reventa no autorizada, y cumplir obligaciones legales,
            fiscales y contables.
          </li>
        </ul>
        <h3>Finalidades secundarias (no necesarias)</h3>
        <ul>
          <li>Enviarte recomendaciones de eventos y avisos de preventa.</li>
          <li>Medir el uso del sitio para mejorar el producto.</li>
        </ul>
        <p>
          Puedes negarte al tratamiento para las finalidades secundarias desde el momento
          en que recibes este aviso, escribiendo a [privacidad@dominio.mx] con el asunto
          «Limitación de finalidades secundarias». Negarte no afecta tu compra ni el uso
          del servicio.
        </p>

        <h2 id="transferencias">4. Transferencias de datos</h2>
        <p>
          Compartimos datos personales, sin requerir tu consentimiento adicional en los
          supuestos del artículo 37 de la LFPDPPP, con:
        </p>
        <ul>
          <li>
            <strong>El promotor del evento</strong> que compraste, para el control de
            acceso, la atención a asistentes y la gestión de incidencias.
          </li>
          <li>
            <strong>Banorte</strong> y los proveedores de medios de pago, para procesar el
            cobro y las devoluciones.
          </li>
          <li>
            <strong>Proveedores de infraestructura, correo transaccional y facturación</strong>{' '}
            que actúan como encargados y solo pueden tratar los datos siguiendo nuestras
            instrucciones.
          </li>
          <li>
            <strong>Autoridades competentes</strong>, cuando exista un requerimiento
            fundado y motivado.
          </li>
        </ul>
        <p>
          Cualquier transferencia distinta a las anteriores te será informada y requerirá
          tu consentimiento. [Legal: confirmar si algún proveedor está fuera de México y,
          en su caso, declararlo aquí.]
        </p>

        <h2 id="arco">5. Derechos ARCO y revocación del consentimiento</h2>
        <p>
          Tienes derecho a <strong>acceder</strong> a tus datos personales, a{' '}
          <strong>rectificarlos</strong> cuando sean inexactos, a{' '}
          <strong>cancelarlos</strong> cuando consideres que no se requieren para las
          finalidades señaladas y a <strong>oponerte</strong> a su tratamiento para fines
          específicos. También puedes revocar el consentimiento que nos otorgaste y
          limitar el uso o divulgación de tus datos.
        </p>
        <h3>Cómo ejercerlos</h3>
        <ol>
          <li>
            Envía tu solicitud a [privacidad@dominio.mx] indicando cuál de los derechos
            quieres ejercer.
          </li>
          <li>
            Incluye tu nombre completo, un correo o domicilio para recibir la respuesta,
            copia de una identificación oficial (o del poder del representante) y la
            descripción clara de los datos sobre los que aplica la solicitud.
          </li>
          <li>
            Si pides una rectificación, indica el dato correcto y adjunta lo que lo
            acredite.
          </li>
        </ol>
        <p>
          Responderemos en un plazo máximo de <strong>20 días hábiles</strong> y, si la
          solicitud procede, la haremos efectiva dentro de los{' '}
          <strong>15 días hábiles</strong> siguientes. El ejercicio de estos derechos es
          gratuito; solo se cobrarían los gastos de envío o reproducción.
        </p>
        <p>
          La cancelación puede no proceder cuando los datos sigan siendo necesarios para
          cumplir obligaciones fiscales o para acreditar una compra ante el promotor.
        </p>
        <p>
          Si consideras que tu derecho no fue atendido, puedes acudir al Instituto
          Nacional de Transparencia, Acceso a la Información y Protección de Datos
          Personales (INAI). [Legal: verificar la denominación y los canales vigentes del
          organismo garante al momento de publicar.]
        </p>

        <h2 id="cookies">6. Cookies y tecnologías similares</h2>
        <p>
          Usamos almacenamiento local del navegador para mantener tu sesión y tu carrito.
          Puedes borrarlo desde la configuración de tu navegador; si lo haces, tendrás que
          iniciar sesión de nuevo y perderás el carrito en curso.
        </p>

        <h2 id="cambios">7. Cambios a este aviso</h2>
        <p>
          Publicaremos cualquier modificación en esta misma página, actualizando la fecha
          del encabezado. Si el cambio afecta finalidades sustanciales, además te lo
          avisaremos por correo electrónico.
        </p>

        <div className={styles.footerLinks}>
          <Link href="/terminos">Términos y condiciones</Link>
          <Link href="/terminos#reembolsos">Reembolsos y cambios</Link>
          <Link href="/ayuda">Ayuda</Link>
        </div>
      </main>
    </>
  );
}
