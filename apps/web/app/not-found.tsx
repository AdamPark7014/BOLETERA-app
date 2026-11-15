import type { Metadata } from 'next';
import { SiteHeader } from '@/components/SiteHeader';
import { StatusScreen } from '@/components/status/StatusScreen';

export const metadata: Metadata = {
  title: 'Página no encontrada | Black Ticket',
  robots: { index: false },
};

export default function NotFound() {
  return (
    <>
      <SiteHeader />
      <StatusScreen
        kicker="Error 404"
        title="Esta función no está en cartelera"
        body="La página que buscas no existe o el evento ya no está a la venta. Revisa la cartelera para ver lo que sí hay."
      />
    </>
  );
}
