import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Membresías',
  description: 'Planes de membresía: preventa, accesos y beneficios en cada evento.',
};

export default function MembresiasLayout({ children }: { children: React.ReactNode }) {
  return children;
}
