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
              ? 'No encontramos esa compra'
              : failed
                ? 'No pudimos cargar tu compra'
                : 'Inicia sesión para ver tus boletos'}
          </h1>
          <p>
            {notFound
              ? 'Revisa el enlace de tu correo de confirmación.'
              : failed
                ? (message ?? 'Intenta de nuevo en unos segundos.')
                : 'Usa el correo con el que compraste o abre el enlace de tu correo.'}
          </p>
          <div className={styles.actions}>
            {notFound || failed ? (
              <Link href="/cuenta" className={styles.secondary}>
                Ir a mis boletos
              </Link>
            ) : (
              <Link
                href={`/login?next=${encodeURIComponent(`/orders/${publicId}`)}`}
                className={styles.primaryLink}
              >
                Entrar
              </Link>
            )}
            <Link href="/ayuda" className={styles.ghost}>
              Ayuda
            </Link>
          </div>
        </div>
      </main>
    </div>
  );
}
