import type { Metadata } from 'next';
import { noIndexMetadata } from '@/lib/seo';

export const metadata: Metadata = noIndexMetadata('Pago');

export default function CheckoutLayout({ children }: { children: React.ReactNode }) {
  return children;
}
