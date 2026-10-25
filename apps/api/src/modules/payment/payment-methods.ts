/**
 * Qué métodos ofrece el checkout público.
 *
 * Las claves viven en `Organization.settings`. Si la clave no está, el método
 * sigue activo (CARD, SPEI y OXXO). Solo un `false` lo apaga. No hay otras
 * pasarelas: PayPal, Apple Pay, Google Pay y Stripe no entran aquí.
 */

export const CHECKOUT_METHODS = ['CARD', 'SPEI', 'OXXO'] as const;

export type CheckoutMethod = (typeof CHECKOUT_METHODS)[number];

/** Llaves dentro de `Organization.settings`. */
export const METHOD_SETTING_KEYS = {
  CARD: 'tarjeta',
  SPEI: 'SPEI',
  OXXO: 'OXXO',
} as const;

export type CheckoutMethodFlags = {
  tarjeta: boolean;
  SPEI: boolean;
  OXXO: boolean;
  tarjetaSaved: boolean;
  speiSaved: boolean;
  oxxoSaved: boolean;
  methods: CheckoutMethod[];
};

export type MethodPatch = {
  tarjeta?: boolean;
  SPEI?: boolean;
  OXXO?: boolean;
};

function settingsRecord(settings: unknown): Record<string, unknown> {
  if (typeof settings === 'object' && settings !== null && !Array.isArray(settings)) {
    return settings as Record<string, unknown>;
  }
  return {};
}

/** Solo un booleano cuenta. Cualquier otra cosa es «la clave no está». */
function storedFlag(raw: unknown): boolean | null {
  return typeof raw === 'boolean' ? raw : null;
}

export function methodsFromSettings(settings: unknown): CheckoutMethodFlags {
  const record = settingsRecord(settings);
  const tarjeta = storedFlag(record[METHOD_SETTING_KEYS.CARD]);
  const spei = storedFlag(record[METHOD_SETTING_KEYS.SPEI]);
  const oxxo = storedFlag(record[METHOD_SETTING_KEYS.OXXO]);
  const on = {
    tarjeta: tarjeta !== false,
    SPEI: spei !== false,
    OXXO: oxxo !== false,
  };
  const methods = CHECKOUT_METHODS.filter((method) => {
    if (method === 'CARD') return on.tarjeta;
    if (method === 'SPEI') return on.SPEI;
    return on.OXXO;
  });
  return {
    ...on,
    tarjetaSaved: tarjeta != null,
    speiSaved: spei != null,
    oxxoSaved: oxxo != null,
    methods,
  };
}

/** Lista que el checkout y `GET /payments/config?eventId=` pueden ofrecer. */
export function offeredCheckoutMethods(settings: unknown): CheckoutMethod[] {
  return methodsFromSettings(settings).methods;
}

export function checkoutMethodOffered(settings: unknown, method: string): boolean {
  const code = method.toUpperCase();
  return offeredCheckoutMethods(settings).some((item) => item === code);
}

/** Conserva el resto del JSON (tasas, plazos, PIN) y escribe solo el booleano que llega. */
export function mergeMethodSettings(settings: unknown, patch: MethodPatch): Record<string, unknown> {
  const next = { ...settingsRecord(settings) };
  if (typeof patch.tarjeta === 'boolean') next[METHOD_SETTING_KEYS.CARD] = patch.tarjeta;
  if (typeof patch.SPEI === 'boolean') next[METHOD_SETTING_KEYS.SPEI] = patch.SPEI;
  if (typeof patch.OXXO === 'boolean') next[METHOD_SETTING_KEYS.OXXO] = patch.OXXO;
  return next;
}
