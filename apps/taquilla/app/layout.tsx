import type { Metadata, Viewport } from 'next';
import { Space_Grotesk } from 'next/font/google';
import { ReauthDialog } from '@/components/ReauthDialog';
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister';
// Taquilla NO importa el sistema de diseno a proposito: no usa ni un componente
// de @boletera/ui, y su paleta oscura (globals.scss) ya es coherente por si sola
// —medida en pantalla: cero grises de croma cero, una sola familia—. Importarlo
// solo anadiria CSS que nadie consume. Si algun dia entra un componente
// compartido, hay que anadir el import aqui.
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
