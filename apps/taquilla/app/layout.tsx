import type { Metadata, Viewport } from 'next';
import { BlackTicketRoot } from '@boletera/ui';
import { ReauthDialog } from '@/components/ReauthDialog';
import { ServiceWorkerRegister } from '@/components/ServiceWorkerRegister';
import { ShiftSync } from '@/components/ShiftSync';
import '@boletera/ui/src/styles/theme.scss';
import './globals.scss';

export const metadata: Metadata = {
  title: 'Black Ticket · Taquilla',
  description: 'Ventanilla de Black Ticket',
  manifest: '/manifest.json',
};

/** Pantalla completa en tablet y sin zoom accidental al teclear importes. */
export const viewport: Viewport = {
  width: 'device-width',
  initialScale: 1,
  maximumScale: 1,
  themeColor: '#0B0B0C',
};

export default function TaquillaLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="es" data-theme="dark">
      <body>
        <BlackTicketRoot density="taquilla" className="bt-app">
          <ServiceWorkerRegister />
          <ShiftSync />
          {/* El diálogo de reautenticación vive en el layout: un 401 puede llegar
              desde cualquier pantalla y no debe tumbar la venta en curso. */}
          <ReauthDialog />
          {children}
        </BlackTicketRoot>
      </body>
    </html>
  );
}
