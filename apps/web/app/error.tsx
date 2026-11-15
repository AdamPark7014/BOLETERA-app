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
        title="No pudimos cargar esta pantalla"
        body="Tus boletos y apartados siguen a salvo."
        action={
          <button type="button" onClick={() => reset()}>
            Intentar de nuevo
          </button>
        }
      />
    </>
  );
}
