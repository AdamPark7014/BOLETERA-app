/**
 * Prefer visitor-forwarded host over the connection Host (API origin).
 * Browsers cannot set `Host`; the storefront sends `x-tenant-host` instead.
 */
export function pickTenantHost(headers: Record<string, string | string[] | undefined>): string {
  const first = (value: string | string[] | undefined): string | undefined => {
    if (Array.isArray(value)) return value[0];
    return value;
  };

  const raw =
    first(headers['x-tenant-host']) ||
    first(headers['x-forwarded-host']) ||
    first(headers.host) ||
    'localhost';

  return raw.split(',')[0].trim() || 'localhost';
}
