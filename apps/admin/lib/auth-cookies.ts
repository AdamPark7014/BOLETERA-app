export const CSRF_COOKIE_NAME = 'boletera_csrf';
export const CSRF_HEADER_NAME = 'X-CSRF-Token';

export function readCsrfToken(): string | null {
  if (typeof document === 'undefined') return null;

  for (const cookie of document.cookie.split(';')) {
    const [rawName, ...rawValue] = cookie.trim().split('=');
    if (rawName === CSRF_COOKIE_NAME) {
      const value = rawValue.join('=');
      try {
        return decodeURIComponent(value);
      } catch {
        return value;
      }
    }
  }

  return null;
}

export function addCsrfHeader(headers: Headers): void {
  const token = readCsrfToken();
  if (token) headers.set(CSRF_HEADER_NAME, token);
}
