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
      <StatusScreen title="No encontramos esta página" />
    </>
  );
}
