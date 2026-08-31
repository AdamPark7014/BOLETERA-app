'use client';

import Link from 'next/link';
import { SiteHeader } from '@/components/SiteHeader';
import styles from './order.module.scss';

/**
 * Pantalla para el 403 de una orden.
 *
 * `publicId` dejó de abrir la orden: hace falta el `accessToken` del correo o
 * una sesión con el correo del comprador. Un 403 crudo deja al comprador
 * pensando que perdió sus boletos, cuando lo que le falta es abrir el enlace
 * correcto. Se le dice exactamente eso y se le dan las dos salidas.
 */
export function OrderAccessGate({
  publicId,
  reason = 'forbidden',
  message,
}: {
  publicId: string;
  reason?: 'forbidden' | 'not-found' | 'error';
  message?: string;
}) {
  const notFound = reason === 'not-found';
  const failed = reason === 'error';

  return (
    <div className={styles.shell}>
      <SiteHeader />
      <main className={styles.page}>
        <div className={styles.empty}>
          <h1>
            {notFound
              ? 'No encontramos esa orden'
              : failed
                ? 'No pudimos cargar tu orden'
                : 'Este enlace no incluye tu credencial de acceso'}
          </h1>
          <p>
            {notFound ? (
              <>
                Revisa que el identificador <code>{publicId}</code> sea el del correo de
                confirmación.
              </>
            ) : failed ? (
              (message ?? 'Vuelve a intentarlo en unos segundos.')
            ) : (
              <>
                Ábrelo desde el correo de confirmación —ese enlace sí la lleva— o inicia sesión con
                el correo con el que hiciste la compra. Tus boletos siguen ahí; lo único que falta
                es acreditar que la orden es tuya.
              </>
            )}
          </p>
          {!notFound && !failed && (
            <p className={styles.gateNote}>
              Si abriste el enlace en otro dispositivo o borraste los datos del navegador, la
              credencial se quedó en el correo. Búscalo como «Tu compra {publicId}».
            </p>
          )}
          <div className={styles.actions}>
            <Link href="/login" className={styles.link}>
              Iniciar sesión
            </Link>
            <Link href="/cuenta" className={styles.secondary}>
              Ir a mis boletos
            </Link>
            <Link href="/ayuda" className={styles.ghost}>
              Necesito ayuda
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
