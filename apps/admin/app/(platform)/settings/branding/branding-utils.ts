/** Contrast, validation and draft helpers for the branding studio. */

import { hexToRgb, mixHex, readableTextOn } from '@boletera/ui';
import { HttpError } from '@/lib/http';
import type { Branding } from '@/lib/queries';

const HEX_RE = /^#([0-9A-Fa-f]{3}|[0-9A-Fa-f]{6})$/;
const SUBDOMAIN_RE = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/;
const MAX_LOGO_DATA_BYTES = 180_000;

export const STOREFRONT_FONT =
  '"IBM Plex Sans", "Segoe UI", system-ui, sans-serif';

export const TICKET_DISPLAY_FONT =
  '"IBM Plex Sans", "Segoe UI", system-ui, sans-serif';

export type BrandDraft = {
  primaryColor: string;
  subdomain: string;
  logoUrl: string;
};

export type ThemeSnapshot = Branding & {
  secondaryColor?: string | null;
  faviconUrl?: string | null;
  customDomain?: string | null;
};

export type FieldErrors = {
  primaryColor?: string;
  subdomain?: string;
  logoUrl?: string;
  form?: string;
};

export type ContrastGrade = 'fail' | 'aa-large' | 'aa' | 'aaa';

export type DerivedPalette = {
  primary: string;
  onPrimary: string;
  secondary: string;
  surface: string;
  muted: string;
  accentSoft: string;
};

export const DEFAULT_DRAFT: BrandDraft = {
  primaryColor: '#171717',
  subdomain: 'demo',
  logoUrl: '',
};

export function normalizeHex(value: string): string {
  const trimmed = value.trim();
  if (!HEX_RE.test(trimmed)) return trimmed;
  const raw = trimmed.slice(1);
  if (raw.length === 3) {
    return `#${raw
      .split('')
      .map((c) => c + c)
      .join('')}`.toLowerCase();
  }
  return `#${raw.toLowerCase()}`;
}

export function isValidHex(value: string): boolean {
  return HEX_RE.test(value.trim());
}

function channelLinear(channel: number): number {
  const s = channel / 255;
  return s <= 0.03928 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
}

export function relativeLuminance(hex: string): number {
  const { r, g, b } = hexToRgb(normalizeHex(hex));
  return 0.2126 * channelLinear(r) + 0.7152 * channelLinear(g) + 0.0722 * channelLinear(b);
}

/** WCAG 2.1 contrast ratio between two sRGB hex colors. */
export function contrastRatio(foreground: string, background: string): number {
  const a = relativeLuminance(foreground);
  const b = relativeLuminance(background);
  const lighter = Math.max(a, b);
  const darker = Math.min(a, b);
  return (lighter + 0.05) / (darker + 0.05);
}

export function gradeContrast(ratio: number): ContrastGrade {
  if (ratio >= 7) return 'aaa';
  if (ratio >= 4.5) return 'aa';
  if (ratio >= 3) return 'aa-large';
  return 'fail';
}

export function formatRatio(ratio: number): string {
  return `${ratio.toFixed(2)}:1`;
}

export function isValidSubdomain(value: string): boolean {
  return SUBDOMAIN_RE.test(value.trim().toLowerCase());
}

export function isValidLogoUrl(value: string): boolean {
  const trimmed = value.trim();
  if (!trimmed) return true;
  if (trimmed.startsWith('data:image/')) {
    return trimmed.length <= MAX_LOGO_DATA_BYTES * 1.37;
  }
  try {
    const url = new URL(trimmed);
    return url.protocol === 'https:' || url.protocol === 'http:';
  } catch {
    return false;
  }
}

export function previewTextColor(background: string): string {
  return readableTextOn(isValidHex(background) ? normalizeHex(background) : '#171717');
}

export function derivePalette(primaryInput: string, secondaryHint?: string | null): DerivedPalette {
  const primary = isValidHex(primaryInput) ? normalizeHex(primaryInput) : DEFAULT_DRAFT.primaryColor;
  const onPrimary = previewTextColor(primary);
  const secondary =
    secondaryHint && isValidHex(secondaryHint)
      ? normalizeHex(secondaryHint)
      : mixHex(primary, '#737373', 0.45);
  return {
    primary,
    onPrimary,
    secondary,
    surface: '#ffffff',
    muted: '#71717a',
    accentSoft: mixHex(primary, '#ffffff', 0.88),
  };
}

export function toDraft(data: ThemeSnapshot | undefined): BrandDraft {
  return {
    primaryColor: data?.primaryColor?.trim() || DEFAULT_DRAFT.primaryColor,
    subdomain: data?.subdomain?.trim() || DEFAULT_DRAFT.subdomain,
    logoUrl: data?.logoUrl?.trim() || '',
  };
}

export function draftsEqual(a: BrandDraft, b: BrandDraft): boolean {
  return (
    normalizeHex(a.primaryColor) === normalizeHex(b.primaryColor) &&
    a.subdomain.trim().toLowerCase() === b.subdomain.trim().toLowerCase() &&
    a.logoUrl.trim() === b.logoUrl.trim()
  );
}

export function toPayload(draft: BrandDraft): Branding {
  return {
    primaryColor: normalizeHex(draft.primaryColor),
    subdomain: draft.subdomain.trim().toLowerCase(),
    logoUrl: draft.logoUrl.trim() || undefined,
  };
}

export function validateBrandingDraft(draft: BrandDraft): FieldErrors {
  const errors: FieldErrors = {};
  if (!isValidHex(draft.primaryColor)) {
    errors.primaryColor = 'Usa un color hexadecimal válido (#RGB o #RRGGBB).';
  } else {
    const onWhite = contrastRatio(normalizeHex(draft.primaryColor), '#ffffff');
    if (onWhite < 3) {
      errors.primaryColor =
        'El contraste sobre fondo claro es insuficiente (mín. 3:1 para UI).';
    }
  }
  if (!draft.subdomain.trim()) {
    errors.subdomain = 'El subdominio es obligatorio.';
  } else if (!isValidSubdomain(draft.subdomain)) {
    errors.subdomain =
      'Solo minúsculas, números y guiones (2–63 caracteres, sin empezar/terminar con guion).';
  }
  if (!isValidLogoUrl(draft.logoUrl)) {
    errors.logoUrl =
      draft.logoUrl.trim().startsWith('data:')
        ? 'El archivo del logo es demasiado grande (máx. ~180 KB). Usa una URL HTTPS.'
        : 'La URL del logo debe ser http(s) válida.';
  }
  return errors;
}

const FIELD_HINTS: Array<{ key: keyof FieldErrors; patterns: RegExp[] }> = [
  {
    key: 'primaryColor',
    patterns: [/primary/i, /color/i, /contraste/i, /hex/i],
  },
  {
    key: 'subdomain',
    patterns: [/subdomain/i, /subdominio/i, /domain/i, /host/i],
  },
  {
    key: 'logoUrl',
    patterns: [/logo/i, /favicon/i, /image/i, /url/i],
  },
];

export function mapServerErrors(error: unknown): FieldErrors {
  if (!(error instanceof HttpError)) {
    return {
      form: error instanceof Error ? error.message : 'No se pudo guardar la marca.',
    };
  }

  const messages: string[] = [];
  if (error.message) messages.push(error.message);

  const details = error.details;
  if (details && typeof details === 'object') {
    const body = details as { message?: unknown; details?: unknown };
    if (Array.isArray(body.message)) {
      for (const item of body.message) {
        if (typeof item === 'string') messages.push(item);
      }
    } else if (typeof body.message === 'string') {
      messages.push(body.message);
    }
  }

  const joined = messages.filter(Boolean).join(' · ');
  const errors: FieldErrors = {};
  for (const msg of messages) {
    for (const hint of FIELD_HINTS) {
      if (hint.patterns.some((re) => re.test(msg))) {
        errors[hint.key] = msg;
      }
    }
  }
  if (Object.keys(errors).length === 0) {
    errors.form = joined || 'No se pudo guardar la marca.';
  } else if (joined && !errors.form) {
    errors.form = joined;
  }
  return errors;
}

export function readLogoFileAsDataUrl(file: File): Promise<string> {
  if (!file.type.startsWith('image/')) {
    return Promise.reject(new Error('El archivo debe ser una imagen (PNG, SVG, JPG o WebP).'));
  }
  if (file.size > MAX_LOGO_DATA_BYTES) {
    return Promise.reject(
      new Error('El archivo supera ~180 KB. Súbelo a un CDN e ingresa la URL HTTPS.'),
    );
  }
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = reader.result;
      if (typeof result === 'string') resolve(result);
      else reject(new Error('No se pudo leer el archivo del logo.'));
    };
    reader.onerror = () => reject(new Error('No se pudo leer el archivo del logo.'));
    reader.readAsDataURL(file);
  });
}

export function gradeLabel(grade: ContrastGrade): string {
  switch (grade) {
    case 'aaa':
      return 'AAA';
    case 'aa':
      return 'AA';
    case 'aa-large':
      return 'AA grande';
    default:
      return 'Insuficiente';
  }
}
