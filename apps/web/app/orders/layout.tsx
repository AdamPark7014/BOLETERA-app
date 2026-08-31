import type { Metadata } from 'next';
import { noIndexMetadata } from '@/lib/seo';

export const metadata: Metadata = noIndexMetadata('Órdenes');

export default function OrdersLayout({ children }: { children: React.ReactNode }) {
  return children;
}
