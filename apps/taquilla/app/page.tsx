'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { getTaquillaToken, getTaquillaUser } from '@/lib/auth';

/** El turno entra directo a la función. El tablero de indicadores no es la ventanilla. */
export default function TaquillaHome() {
  const router = useRouter();

  useEffect(() => {
    if (!getTaquillaToken()) router.replace('/login');
    else router.replace(getTaquillaUser()?.role === 'SCANNER' ? '/acceso' : '/venta');
  }, [router]);

  return null;
}
