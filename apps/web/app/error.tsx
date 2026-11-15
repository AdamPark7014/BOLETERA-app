'use client';

import { useEffect } from 'react';
import { SiteHeader } from '@/components/SiteHeader';
import { StatusScreen } from '@/components/status/StatusScreen';

export default function ErrorPage({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  useEffect(() => {
    console.error(error);
  }, [error]);

  return (
    <>
      <SiteHeader />
      <StatusScreen
        kicker="Algo falló"
        title="No pudimos cargar esta pantalla"
        body="Fue un problema de nuestro lado o de tu conexión. Tus boletos y apartados no se pierden: intenta de nuevo."
        action={
          <button type="button" onClick={() => reset()}>
            Intentar de nuevo
          </button>
        }
      />
    </>
  );
}
