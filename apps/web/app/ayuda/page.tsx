import type { Metadata } from 'next';
import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import { fetchTenantCurrent } from '@/lib/tenant';
import styles from '../legal.module.scss';

export async function generateMetadata(): Promise<Metadata> {
  const tenant = await fetchTenantCurrent();
  return {
    title: `Ayuda | ${tenant.name}`,
    description:
      'Cómo comprar boletos, entrar al evento, transferir entradas, pedir factura y solicitar un reembolso.',
  };
}

export default function AyudaPage() {
  return (
    <>
      <SiteHeader />
      <main id="contenido" tabIndex={-1} className={styles.page}>
        <h1>Ayuda</h1>
        <p className={styles.updated}>Guía rápida del producto actual</p>

        <nav className={styles.toc} aria-label="Temas de ayuda">
          <h2>En esta página</h2>
          <ul>
            <li>
              <a href="#comprar">Comprar boletos</a>
            </li>
            <li>
              <a href="#acceso">Entrar al evento</a>
            </li>
            <li>
              <a href="#cuenta">Mi cuenta y sesión</a>
            </li>
            <li>
              <a href="#reembolsos">Reembolsos y cambios</a>
            </li>
            <li>
              <a href="#organizadores">Organizadores</a>
            </li>
          </ul>
        </nav>

        <h2 id="comprar">Comprar boletos</h2>
        <p>
          Elige un evento, selecciona asientos o zona y completa el pago con Banorte
          (tarjeta, SPEI u OXXO, según lo que habilite el evento). Al confirmar verás la
          orden y podrás descargar el PDF con el código QR.
        </p>
        <p>
          Los asientos se reservan solo unos minutos mientras pagas. Si se agota el tiempo,
          vuelven a quedar disponibles para otras personas y tendrás que elegirlos de
          nuevo.
        </p>

        <h2 id="acceso">Entrar al evento</h2>
        <p>
          Presenta el código QR desde el celular o impreso desde el PDF. El personal del
          recinto lo escanea en la entrada. Cada código sirve una sola vez; todavía no hay
          aplicación móvil nativa.
        </p>

        <h2 id="cuenta">Mi cuenta y sesión</h2>
        <ul>
          <li>
            <Link href="/cuenta">Ver mis órdenes, boletos y transferencias</Link>
          </li>
          <li>
            <Link href="/login/forgot">Recuperar mi contraseña</Link>
          </li>
          <li>
            <Link href="/cuenta">Solicitar factura CFDI (entorno de pruebas)</Link>
          </li>
        </ul>
        <p>
          Por seguridad la sesión caduca sola tras un rato de inactividad y cuando cambian
          los datos de tu cuenta. Si te pasa, solo vuelve a entrar: los boletos que ya
          compraste siguen en tu cuenta y en tu correo.
        </p>

        <h2 id="reembolsos">Reembolsos y cambios</h2>
        <p>
          Si el evento se cancela, el reembolso es del 100 % y se hace por el mismo medio
          de pago, sin que tengas que pedirlo. Si se reprograma, tu boleto sigue siendo
          válido y puedes pedir la devolución dentro del plazo publicado.
        </p>
        <p>
          Las condiciones completas, con plazos y el procedimiento paso a paso, están en la{' '}
          <Link href="/terminos#reembolsos">política de reembolsos y cambios</Link>.
        </p>

        <h2 id="organizadores">Organizadores</h2>
        <p>
          Desde el panel de administración puedes crear eventos, revisar órdenes y tramitar
          reembolsos. Taquilla está pensada para la venta presencial en el recinto.
        </p>

        <div className={styles.footerLinks}>
          <Link href="/terminos">Términos y condiciones</Link>
          <Link href="/terminos#reembolsos">Reembolsos y cambios</Link>
          <Link href="/privacidad">Aviso de privacidad</Link>
        </div>
      </main>
    </>
  );
}
