// =============================================================================
// @boletera/ui — superficie publica
//
// Solo exports nombrados y modulo a modulo, para que el bundler pueda eliminar
// lo que no se use. No hay `export *`: cada simbolo se declara aqui de forma
// explicita.
//
// Antes de usar cualquier componente, importa el tema una vez en el layout raiz:
//   import '@boletera/ui/src/styles/theme.scss';
// =============================================================================

// ------------------------------------------------------------------- tokens

export {
  SPACE_UNIT,
  breakpoints,
  color,
  colorVar,
  duration,
  easing,
  fontFamily,
  fontWeight,
  palette,
  radius,
  space,
  tokens,
  typeScale,
  vizColor,
  vizSeries,
  zIndex,
} from './styles/tokens';
export type {
  Breakpoint,
  DurationToken,
  EasingToken,
  PaletteToken,
  RadiusToken,
  SemanticColor,
  Tokens,
  TypeScaleStep,
  ZIndexToken,
} from './styles/tokens';

// ----------------------------------------------------------------- utilidades

export { cx } from './lib/cx';
export type { ClassValue } from './lib/cx';

export {
  formatCompact,
  formatCurrency,
  formatDateTime,
  formatDayLabel,
  formatDelta,
  formatNumber,
  formatPercent,
  formatTime,
  toDate,
} from './lib/format';

export { hexToRgb, mixHex, readableTextOn, rgbToHex } from './lib/color';

export { bandScale, clamp, extent, linearScale, nearestIndex, niceDomain, sum, ticks } from './lib/scale';
export type { BandScale, Extent, LinearScale, Point } from './lib/scale';

export { bestMatch, fuzzyMatch, highlightSegments } from './lib/fuzzy';
export type { FuzzyMatch } from './lib/fuzzy';

export {
  useControllableState,
  useDebouncedValue,
  useElementSize,
  useEscapeKey,
  useFocusTrap,
  useLockBodyScroll,
  useOnClickOutside,
  useReducedMotion,
  useRovingIndex,
} from './lib/hooks';
export type { ElementSize } from './lib/hooks';

export type {
  CartesianChartProps,
  ChartDatum,
  ChartSeries,
  ValueFormatter,
} from './lib/chart';

// ----------------------------------------------------------------- primitivas

export { Button } from './components/Button';
export type { ButtonProps, ButtonSize, ButtonVariant } from './components/Button';

export { Input } from './components/Input';
export type { InputProps, InputSize } from './components/Input';

export { SearchInput } from './components/SearchInput';
export type { SearchInputProps } from './components/SearchInput';

export { Card, CardFooter, CardHeader } from './components/Card';
export type { CardHeaderProps, CardPadding, CardProps, CardVariant } from './components/Card';

export { Badge } from './components/Badge';
export type { BadgeProps, BadgeSize, BadgeTone, BadgeVariant } from './components/Badge';

export { Spinner } from './components/Spinner';
export type { SpinnerProps, SpinnerSize } from './components/Spinner';

export { StatusDot } from './components/StatusDot';
export type { StatusDotProps, StatusTone } from './components/StatusDot';

export { TrendPill } from './components/TrendPill';
export type { TrendPillProps } from './components/TrendPill';

export { ProgressRing } from './components/ProgressRing';
export type { ProgressRingProps, ProgressRingTone } from './components/ProgressRing';

export { Avatar, initialsOf } from './components/Avatar';
export type { AvatarProps, AvatarSize } from './components/Avatar';

export { AvatarGroup } from './components/AvatarGroup';
export type { AvatarGroupMember, AvatarGroupProps } from './components/AvatarGroup';

export { Skeleton, SkeletonCard, SkeletonText } from './components/Skeleton';
export type {
  SkeletonCardProps,
  SkeletonProps,
  SkeletonShape,
  SkeletonTextProps,
} from './components/Skeleton';

// ------------------------------------------------------------------ capas

export { Modal } from './components/Modal';
export type { ModalProps, ModalSize } from './components/Modal';

export { Drawer } from './components/Drawer';
export type { DrawerProps, DrawerSide, DrawerSize } from './components/Drawer';

export { Tooltip } from './components/Tooltip';
export type { TooltipProps } from './components/Tooltip';

export { Popover } from './components/Popover';
export type { PopoverProps } from './components/Popover';

export type { Alignment, Placement } from './lib/position';

export { Toast } from './components/Toast';
export type { ToastOptions, ToastProps, ToastRecord, ToastTone } from './components/Toast';

export { ToastProvider, useToast } from './components/ToastProvider';
export type { ToastApi, ToastPlacement, ToastProviderProps } from './components/ToastProvider';

export { CommandPalette } from './components/CommandPalette';
export type { CommandAction, CommandPaletteProps } from './components/CommandPalette';

// ---------------------------------------------------------------- navegacion

export { Tabs } from './components/Tabs';
export type { TabItem, TabsProps } from './components/Tabs';

export { SegmentedControl } from './components/SegmentedControl';
export type { SegmentedControlProps, SegmentedOption } from './components/SegmentedControl';

// -------------------------------------------------------------------- layout

export { PageHeader } from './components/PageHeader';
export type { Breadcrumb, PageHeaderProps } from './components/PageHeader';

export { Section } from './components/Section';
export type { SectionProps } from './components/Section';

export { Toolbar, ToolbarSeparator } from './components/Toolbar';
export type { ToolbarProps } from './components/Toolbar';

export { FilterBar } from './components/FilterBar';
export type {
  FilterBarProps,
  FilterDefinition,
  FilterOption,
  FilterSelection,
} from './components/FilterBar';

// ---------------------------------------------------------------------- datos

export { DataTable } from './components/DataTable';
export type {
  DataTableColumn,
  DataTableProps,
  SortDirection,
  SortState,
} from './components/DataTable';

export { EmptyState } from './components/EmptyState';
export type { EmptyIllustration, EmptyStateProps } from './components/EmptyState';

export { Timeline } from './components/Timeline';
export type { TimelineItem, TimelineProps, TimelineTone } from './components/Timeline';

export { ActivityFeed } from './components/ActivityFeed';
export type { ActivityFeedProps, ActivityItem } from './components/ActivityFeed';

// ------------------------------------------------------------ visualizacion

export { KpiCard } from './components/KpiCard';
export type { KpiCardProps, KpiTone } from './components/KpiCard';

export { Sparkline } from './components/Sparkline';
export type { SparklineProps, SparklineTone } from './components/Sparkline';

export { LineChart } from './components/LineChart';
export type { LineChartProps } from './components/LineChart';

export { AreaChart } from './components/AreaChart';
export type { AreaChartProps } from './components/AreaChart';

export { BarChart } from './components/BarChart';
export type { BarChartProps } from './components/BarChart';

export { DonutChart } from './components/DonutChart';
export type { DonutChartProps, DonutSlice } from './components/DonutChart';

export { Heatmap } from './components/Heatmap';
export type { HeatmapProps } from './components/Heatmap';

export { FunnelChart } from './components/FunnelChart';
export type { FunnelChartProps, FunnelStage } from './components/FunnelChart';
