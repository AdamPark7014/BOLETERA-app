/** Decode JWT `exp` claim (seconds → ms). No signature verification — client-side TTL only. */
export function decodeJwtExpiryMs(token: string): number | null {
  try {
    const part = token.split('.')[1];
    if (!part) return null;
    const padded = part.replace(/-/g, '+').replace(/_/g, '/');
    const padLen = (4 - (padded.length % 4)) % 4;
    const base64 = padded + '='.repeat(padLen);
    let json: string;
    if (typeof globalThis.atob === 'function') {
      json = globalThis.atob(base64);
    } else {
      // Hermes / RN polyfill path
      const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/=';
      let output = '';
      let i = 0;
      while (i < base64.length) {
        const enc1 = chars.indexOf(base64.charAt(i++));
        const enc2 = chars.indexOf(base64.charAt(i++));
        const enc3 = chars.indexOf(base64.charAt(i++));
        const enc4 = chars.indexOf(base64.charAt(i++));
        output += String.fromCharCode((enc1 << 2) | (enc2 >> 4));
        if (enc3 !== 64) output += String.fromCharCode(((enc2 & 15) << 4) | (enc3 >> 2));
        if (enc4 !== 64) output += String.fromCharCode(((enc3 & 3) << 6) | enc4);
      }
      json = output;
    }
    const payload = JSON.parse(json) as { exp?: number };
    return typeof payload.exp === 'number' ? payload.exp * 1000 : null;
  } catch {
    return null;
  }
}

/** Fallback when JWT has no exp: match API default JWT_EXPIRATION (2 h). */
export const TOKEN_FALLBACK_TTL_MS = 2 * 60 * 60 * 1000;

/** Warn this many ms before expiry (mirrors taquilla web). */
export const TOKEN_WARN_MS = 10 * 60 * 1000;
