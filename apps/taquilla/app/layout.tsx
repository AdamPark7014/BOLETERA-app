import type { Metadata, Viewport } from 'next';
import { Space_Grotesk } from 'next/font/google';
import { ReauthDialog } from '@/components/ReauthDialog';
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister';
// El sistema de diseno va PRIMERO: define los --bl-* de los que
// derivan los tokens locales. Sin esta linea cada pantalla caia a
// su reserva codificada a mano y las familias de gris no concordaban.
import '@boletera/ui/src/styles/theme.scss';
import './globals.scss';

const body = Space_Grotesk({ subsets: ['latin'], variable: '--font-body' });

export const metadata: Metadata = {
  title: 'Boletera Taquilla',
  description: 'POS de taquilla',
  manifest: '/manifest.json',
};

/** Pantalla completa en tablet y sin zoom accidental al teclear importes. */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#111113',
};

export default function TaquillaLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es">
      <body className={body.variable}>
        <ServiceWorkerRegister />
        {/* El diálogo de reautenticación vive en el layout: un 401 puede llegar
            desde cualquier pantalla y no debe tumbar la venta en curso. */}
        <ReauthDialog />
        {children}
      </body>
    </html>
  );
}
