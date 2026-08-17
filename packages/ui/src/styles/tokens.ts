/**
 * Espejo tipado de los design tokens declarados en `_variables.scss` / `theme.scss`.
 *
 * Se usa desde JS cuando el valor no puede resolverse en CSS: atributos SVG de
 * los charts, calculos de layout virtualizado y medidas de animacion.
 *
 * Los colores dependientes del tema se exponen como referencias `var(--bl-*)`
 * (via {@link colorVar}) para que sigan respondiendo a `data-theme`. Los valores
 * crudos de la paleta viven en {@link palette} y solo deben usarse cuando se
 * necesita un literal (por ejemplo, interpolacion de color en una escala).
 */

// -----------------------------------------------------------------------------
// Paleta primitiva
// -----------------------------------------------------------------------------

export const palette = {
  gray0: '#ffffff',
  gray25: '#fcfcfd',
  gray50: '#f8f9fb',
  gray100: '#f1f2f6',
  gray150: '#e9ebf1',
  gray200: '#e0e3ea',
  gray300: '#cbd0db',
  gray400: '#9ba3b4',
  gray500: '#6f7887',
  gray600: '#545c6b',
  gray700: '#3d4451',
  gray800: '#272c36',
  gray850: '#1b1f27',
  gray900: '#14171d',
  gray950: '#0b0d11',

  accent50: '#fff1f3',
  accent100: '#ffe0e6',
  accent200: '#ffc6d2',
  accent300: '#ff9db1',
  accent400: '#fb6486',
  accent500: '#f03562',
  accent600: '#e11d48',
  accent700: '#be123c',
  accent800: '#9f1239',
  accent900: '#881337',

  success500: '#10b981',
  success600: '#059669',
  warning500: '#f59e0b',
  warning600: '#d97706',
  danger500: '#ef4444',
  danger600: '#dc2626',
  info500: '#3b82f6',
  info600: '#2563eb',
} as const;

export type PaletteToken = keyof typeof palette;

// -----------------------------------------------------------------------------
// Colores semanticos (referencias a custom properties)
// -----------------------------------------------------------------------------

const SEMANTIC_COLORS = [
  'surface',
  'surface-sunken',
  'surface-hover',
  'surface-active',
  'elevated',
  'elevated-hover',
  'border',
  'border-subtle',
  'border-strong',
  'text-primary',
  'text-secondary',
  'text-tertiary',
  'text-disabled',
  'text-inverse',
  'accent',
  'accent-hover',
  'accent-active',
  'accent-subtle',
  'accent-border',
  'accent-text',
  'on-accent',
  'success',
  'success-subtle',
  'success-border',
  'success-text',
  'warning',
  'warning-subtle',
  'warning-border',
  'warning-text',
  'danger',
  'danger-hover',
  'danger-subtle',
  'danger-border',
  'danger-text',
  'info',
  'info-subtle',
  'info-border',
  'info-text',
  'focus-ring',
  'overlay',
  'skeleton',
  'skeleton-shine',
  'grid-line',
] as const;

/** Nombre de un color semantico del sistema. */
export type SemanticColor = (typeof SEMANTIC_COLORS)[number];

/**
 * Referencia CSS a un color semantico, apta para atributos SVG (`fill`, `stroke`).
 * @example colorVar('accent') // 'var(--bl-accent)'
 */
export function colorVar(name: SemanticColor): string {
  return `var(--bl-${name})`;
}

/** Mapa listo para usar de todos los colores semanticos como `var(--bl-*)`. */
export const color = Object.fromEntries(
  SEMANTIC_COLORS.map((name) => [name, `var(--bl-${name})`]),
) as Record<SemanticColor, string>;

/** Serie categorica para visualizacion de datos, en orden de asignacion. */
export const vizSeries = [
  '#6366f1',
  '#14b8a6',
  '#f59e0b',
  '#ec4899',
  '#22c55e',
  '#8b5cf6',
  '#06b6d4',
  '#f43f5e',
] as const;

/** Devuelve el color categorico `index`, ciclando la serie si se desborda. */
export function vizColor(index: number): string {
  const series = vizSeries;
  return series[((index % series.length) + series.length) % series.length] ?? series[0];
}

// -----------------------------------------------------------------------------
// Tipografia
// -----------------------------------------------------------------------------

export const fontFamily = {
  sans: "'Inter var', 'Inter', 'Space Grotesk', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, system-ui, sans-serif",
  display: "'Bebas Neue', 'Inter var', 'Inter', Impact, sans-serif",
  mono: "'JetBrains Mono', 'SF Mono', 'Cascadia Mono', Menlo, Consolas, monospace",
} as const;

/** Escala tipografica: tamano, interlineado y tracking en px/em. */
export const typeScale = {
  '2xs': { size: 11, lineHeight: 16, tracking: '0.01em' },
  xs: { size: 12, lineHeight: 16, tracking: '0.005em' },
  sm: { size: 13, lineHeight: 20, tracking: '0' },
  md: { size: 14, lineHeight: 20, tracking: '-0.005em' },
  lg: { size: 16, lineHeight: 24, tracking: '-0.01em' },
  xl: { size: 18, lineHeight: 26, tracking: '-0.014em' },
  '2xl': { size: 21, lineHeight: 28, tracking: '-0.018em' },
  '3xl': { size: 26, lineHeight: 32, tracking: '-0.022em' },
  '4xl': { size: 32, lineHeight: 38, tracking: '-0.026em' },
  '5xl': { size: 40, lineHeight: 46, tracking: '-0.03em' },
  '6xl': { size: 52, lineHeight: 56, tracking: '-0.034em' },
} as const;

export type TypeScaleStep = keyof typeof typeScale;

export const fontWeight = {
  regular: 400,
  medium: 500,
  semibold: 600,
  bold: 700,
} as const;

// -----------------------------------------------------------------------------
// Espaciado, radios, capas
// -----------------------------------------------------------------------------

/** Unidad base del sistema de espaciado, en pixeles. */
export const SPACE_UNIT = 4;

/** Multiplo de la unidad base de 4px. `space(3) === 12`. */
export function space(steps: number): number {
  return SPACE_UNIT * steps;
}

export const radius = {
  none: 0,
  xs: 4,
  sm: 6,
  md: 8,
  lg: 12,
  xl: 16,
  '2xl': 20,
  full: 9999,
} as const;

export type RadiusToken = keyof typeof radius;

export const zIndex = {
  base: 0,
  raised: 10,
  sticky: 100,
  header: 200,
  dropdown: 1000,
  popover: 1100,
  overlay: 1200,
  drawer: 1250,
  modal: 1300,
  command: 1400,
  toast: 1500,
  tooltip: 1600,
} as const;

export type ZIndexToken = keyof typeof zIndex;

export const breakpoints = {
  xs: 480,
  sm: 640,
  md: 768,
  lg: 1024,
  xl: 1280,
  '2xl': 1536,
} as const;

export type Breakpoint = keyof typeof breakpoints;

// -----------------------------------------------------------------------------
// Movimiento
// -----------------------------------------------------------------------------

/** Duraciones en milisegundos. */
export const duration = {
  instant: 0,
  fast: 120,
  normal: 180,
  slow: 260,
  slower: 400,
} as const;

export type DurationToken = keyof typeof duration;

export const easing = {
  standard: 'cubic-bezier(0.2, 0, 0, 1)',
  accelerate: 'cubic-bezier(0.4, 0, 1, 1)',
  decelerate: 'cubic-bezier(0, 0, 0.2, 1)',
  spring: 'cubic-bezier(0.2, 0.8, 0.2, 1)',
  linear: 'linear',
} as const;

export type EasingToken = keyof typeof easing;

// -----------------------------------------------------------------------------
// Agregado
// -----------------------------------------------------------------------------

/** Todos los tokens en un solo objeto, util para temas de charts o pruebas. */
export const tokens = {
  palette,
  color,
  vizSeries,
  fontFamily,
  typeScale,
  fontWeight,
  radius,
  zIndex,
  breakpoints,
  duration,
  easing,
  spaceUnit: SPACE_UNIT,
} as const;

export type Tokens = typeof tokens;
