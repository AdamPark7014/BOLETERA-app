/**
 * Secretos criptográficos del arranque.
 *
 * `requireJwtSecret` fallaba antes solo si la variable estaba ausente. Eso no
 * protege de nada: docker-compose inyectaba
 * `JWT_SECRET=${JWT_SECRET:-your-secret-key-change-in-production}`, así que la
 * variable SIEMPRE existía y el proceso arrancaba con un secreto público.
 * Con un JWT_SECRET conocido, cualquiera firma `{"role":"SUPER_ADMIN"}` y
 * RolesGuard le concede todo sin consultar la base (F2-05).
 */

/** Valores de ejemplo que circulan en el repo, la documentación y CI. */
const KNOWN_WEAK_SECRETS = new Set(
  [
    'your-secret-key-change-in-production',
    'your-super-secret-jwt-key-change-in-production',
    'dev-ticket-secret',
    'change-me-worker-reconcile-secret',
    'changeme',
    'secret',
    'password',
    'test',
    'ci-test-secret',
    'ci-internal-secret',
  ].map((s) => s.toLowerCase()),
);

const MIN_SECRET_LENGTH = 32;

function assertStrongSecret(name: string, value: string | undefined): string {
  if (!value) {
    throw new Error(
      `${name} no está definido. El proceso no arranca sin él: un secreto ausente ` +
        `o débil permite falsificar credenciales de administrador.`,
    );
  }
  if (KNOWN_WEAK_SECRETS.has(value.trim().toLowerCase())) {
    throw new Error(
      `${name} tiene un valor de ejemplo público ("${value.slice(0, 12)}…"). ` +
        `Genera uno con: node -e "console.log(require('crypto').randomBytes(48).toString('base64url'))"`,
    );
  }
  if (value.length < MIN_SECRET_LENGTH) {
    throw new Error(
      `${name} mide ${value.length} caracteres; el mínimo es ${MIN_SECRET_LENGTH}.`,
    );
  }
  return value;
}

/** Secreto de firma de los JWT de sesión. Falla al arrancar si es débil. */
export function requireJwtSecret(): string {
  return assertStrongSecret('JWT_SECRET', process.env.JWT_SECRET);
}

/**
 * Secreto de firma del QR rotativo de los boletos.
 *
 * Antes esto caía en `JWT_SECRET` y, si tampoco estaba, en la constante
 * `'dev-ticket-secret'` incrustada en el repositorio (F2-16). Con esa constante
 * cualquiera fabrica un QR válido para cualquier boleto de cualquier evento.
 *
 * Se permite reutilizar JWT_SECRET solo fuera de producción, para no romper los
 * entornos de desarrollo existentes; en producción exige su propia clave, de
 * modo que rotar sesiones no invalide los boletos ya emitidos y viceversa.
 */
export function requireTicketQrSecret(): string {
  const own = process.env.TICKET_QR_SECRET;
  if (own) return assertStrongSecret('TICKET_QR_SECRET', own);

  if (process.env.NODE_ENV === 'production') {
    throw new Error(
      'TICKET_QR_SECRET es obligatorio en producción: la firma de los boletos no ' +
        'debe compartir clave con las sesiones (rotar una invalidaría la otra).',
    );
  }
  return assertStrongSecret('JWT_SECRET (fallback de TICKET_QR_SECRET)', process.env.JWT_SECRET);
}

/** Secreto de las rutas internas (worker → API). Mismo criterio de fortaleza. */
export function requireInternalApiSecret(): string {
  return assertStrongSecret(
    'INTERNAL_API_SECRET',
    process.env.INTERNAL_API_SECRET ?? process.env.JWT_SECRET,
  );
}
