/**
 * Synchronous theme boot — import first in the platform shell so the
 * data-theme attribute is set as soon as the client chunk evaluates,
 * before React paints.
 */
import { applyThemeAttribute, readThemePreference } from './storage';

if (typeof window !== 'undefined') {
  applyThemeAttribute(readThemePreference());
}
