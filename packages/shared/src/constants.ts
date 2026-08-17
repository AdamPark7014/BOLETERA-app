export const HOLD_TTL_WEB_SECONDS = 900;
export const HOLD_TTL_TAQUILLA_SECONDS = 300;
export const API_PREFIX = '/api/v1';
export const DEFAULT_PAGE_SIZE = 20;

/** Re-export market defaults so existing `from '@boletera/shared'` imports keep working. */
export {
  PLATFORM_LOCALE,
  PLATFORM_COUNTRY,
  PLATFORM_TIMEZONE,
  MEXICO_MARKET,
} from './locale';
