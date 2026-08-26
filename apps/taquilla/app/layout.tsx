import type { Metadata, Viewport } from 'next';
import { Space_Grotesk } from 'next/font/google';
import { ReauthDialog } from '@/components/ReauthDialog';
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister';
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
  themeColor: '#0b0d11',
};

export default function TaquillaLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" data-theme="dark">
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
