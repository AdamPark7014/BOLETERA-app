/**
 * Platform locale, market and timezone defaults for Mexico.
 *
 * Every app and package must import these instead of hardcoding
 * "es-MX" / "America/Mexico_City" / "MXN" so a future multi-market
 * expansion has a single place to fork from.
 */

import { DEFAULT_CURRENCY, type CurrencyCode } from './money';

export const PLATFORM_LOCALE = 'es-MX';
export const PLATFORM_COUNTRY = 'MX';
export const PLATFORM_TIMEZONE = 'America/Mexico_City';

export interface MarketDefaults {
  locale: string;
  country: string;
  timezone: string;
  currency: CurrencyCode;
}

export const MEXICO_MARKET: MarketDefaults = {
  locale: PLATFORM_LOCALE,
  country: PLATFORM_COUNTRY,
  timezone: PLATFORM_TIMEZONE,
  currency: DEFAULT_CURRENCY,
};

function tryValidateTimezone(timezone: string): boolean {
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: timezone });
    return true;
  } catch {
    return false;
  }
}

/**
 * Resolve the timezone an organization operates in.
 * Falls back to Mexico City when the value is missing or unknown to ICU.
 */
export function resolveOrganizationTimezone(timezone: string | null | undefined): string {
  if (typeof timezone === 'string' && timezone.trim() && tryValidateTimezone(timezone.trim())) {
    return timezone.trim();
  }
  return PLATFORM_TIMEZONE;
}
