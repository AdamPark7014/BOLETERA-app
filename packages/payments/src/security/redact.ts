/**
 * Redact sensitive payment fields before any logging.
 * Never log Payworks redirect URLs, FIRMA, USUARIO, passwords, card data, or CLABE.
 */

const SENSITIVE_KEY =
  /^(password|passwd|pwd|secret|token|authorization|firma|usuario|user|clabe|pan|card|cardnumber|card_number|cvv|cvc|cvv2|expiry|exp_month|exp_year|account_number|iban)$/i;

const SENSITIVE_QUERY_KEYS = new Set([
  'password',
  'passwd',
  'pwd',
  'secret',
  'token',
  'firma',
  'usuario',
  'user',
  'clabe',
  'pan',
  'card',
  'cardnumber',
  'card_number',
  'cvv',
  'cvc',
  'numero',
]);

const EMAIL_RE = /[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g;
const CLABE_RE = /\b\d{18}\b/g;
const CARD_RE = /\b(?:\d[ -]*?){13,19}\b/g;

export type RedactOptions = {
  /** When true (default), replace email addresses with `[EMAIL]`. */
  emails?: boolean;
};

const REDACTED = '[REDACTED]';

function redactString(value: string, options: RedactOptions): string {
  let out = value;

  // Strip sensitive query/fragment params from URLs without throwing on relative paths.
  try {
    const hasScheme = /^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(out);
    const url = hasScheme ? new URL(out) : new URL(out, 'https://redact.invalid');
    let mutated = false;
    for (const key of [...url.searchParams.keys()]) {
      const lower = key.toLowerCase();
      if (SENSITIVE_QUERY_KEYS.has(lower)) {
        url.searchParams.set(key, REDACTED);
        mutated = true;
      } else if (options.emails !== false && (lower === 'correo' || lower === 'email' || lower === 'mail')) {
        url.searchParams.set(key, '[EMAIL]');
        mutated = true;
      }
    }
    if (mutated) {
      out = hasScheme ? url.toString() : `${url.pathname}${url.search}${url.hash}`;
    }
  } catch {
    // not a URL — continue with pattern redaction
  }

  out = out.replace(CLABE_RE, '[CLABE]');
  out = out.replace(CARD_RE, '[CARD]');
  if (options.emails !== false) {
    // Match plain and percent-encoded emails (URL query values).
    out = out.replace(EMAIL_RE, '[EMAIL]');
    out = out.replace(
      /[a-zA-Z0-9._%+-]+%40[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}/g,
      '[EMAIL]',
    );
  }
  return out;
}

function redactValue(value: unknown, options: RedactOptions, depth: number): unknown {
  if (depth > 8) return '[DEPTH]';
  if (value == null) return value;
  if (typeof value === 'string') return redactString(value, options);
  if (typeof value === 'number' || typeof value === 'boolean' || typeof value === 'bigint') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, options, depth + 1));
  }
  if (typeof value === 'object') {
    const out: Record<string, unknown> = {};
    for (const [key, child] of Object.entries(value as Record<string, unknown>)) {
      if (SENSITIVE_KEY.test(key)) {
        out[key] = REDACTED;
      } else {
        out[key] = redactValue(child, options, depth + 1);
      }
    }
    return out;
  }
  return String(value);
}

/**
 * Deep-clone a value with secrets stripped. Safe to pass to loggers.
 * Always redacts password / FIRMA / USUARIO / card / CLABE keys and patterns;
 * emails are redacted by default (pass `{ emails: false }` to keep them).
 */
export function redactForLog(input: unknown, options: RedactOptions = {}): unknown {
  return redactValue(input, options, 0);
}
