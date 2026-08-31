import type { Metadata } from 'next';
import { noIndexMetadata } from '@/lib/seo';

export const metadata: Metadata = noIndexMetadata('Mi cuenta');

export default function CuentaLayout({ children }: { children: React.ReactNode }) {
  return children;
}
