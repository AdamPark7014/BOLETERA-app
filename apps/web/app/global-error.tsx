'use client';

/* Respaldo si falla el layout raíz: sin dependencias, mismo lenguaje. */
export default function GlobalError({
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <html lang="es">
      <body
        style={{
          margin: 0,
          background: '#000',
          color: '#fff',
          fontFamily: 'Roboto, system-ui, sans-serif',
        }}
      >
        <main
          style={{
            maxWidth: 720,
            margin: '0 auto',
            padding: '96px 24px',
            display: 'flex',
            flexDirection: 'column',
            gap: 16,
          }}
        >
          <span
            style={{ color: '#A68A6B', fontSize: 12, fontWeight: 700, letterSpacing: '0.14em' }}
          >
            BLACK TICKET
          </span>
          <h1
            style={{
              margin: 0,
              fontSize: 48,
              fontWeight: 900,
              textTransform: 'uppercase',
              lineHeight: 0.95,
            }}
          >
            No pudimos cargar el sitio
          </h1>
          <p style={{ margin: 0, color: '#A8A29A', fontSize: 18 }}>
            Intenta de nuevo en unos segundos.
          </p>
          <button
            type="button"
            onClick={() => reset()}
            style={{
              alignSelf: 'flex-start',
              minHeight: 52,
              padding: '0 28px',
              borderRadius: 999,
              border: 0,
              background: '#A68A6B',
              color: '#000',
              fontWeight: 700,
              fontSize: 17,
            }}
          >
            Intentar de nuevo
          </button>
        </main>
      </body>
    </html>
  );
}
