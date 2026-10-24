'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getTaquillaToken } from '@/lib/auth';

/** El turno entra directo a la función. El tablero de indicadores no es la ventanilla. */
export default function TaquillaHome() {
  const router = useRouter();

  useEffect(() => {
    router.replace(getTaquillaToken() ? '/venta' : '/login');
  }, [router]);

  return null;
}
