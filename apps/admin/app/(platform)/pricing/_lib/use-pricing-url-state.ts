'use client';

import { useCallback, useMemo } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import type { FilterSelection } from '@boletera/ui';
import { isPageSize, type PageSize } from './derive';
import type { PricingDirection } from './types';

export const PRICING_VIEWS = ['recomendaciones', 'aprobaciones', 'senales'] as const;

export type PricingView = (typeof PRICING_VIEWS)[number];

const DIRECTIONS: readonly PricingDirection[] = ['increase', 'decrease', 'hold'];

const DEFAULT_PAGE_SIZE: PageSize = 10;

function isView(value: string): value is PricingView {
  return PRICING_VIEWS.some((view) => view === value);
}

function isDirection(value: string): value is PricingDirection {
  return DIRECTIONS.some((direction) => direction === value);
}

function parseDirections(raw: string | null): readonly PricingDirection[] {
  if (!raw) return [];
  return raw
    .split(',')
    .map((part) => part.trim())
    .filter(isDirection);
}

function parsePage(raw: string | null): number {
  const parsed = Number(raw);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : 1;
}

export type PricingUrlState = {
  eventId: string;
  view: PricingView;
  query: string;
  directions: readonly PricingDirection[];
  approvalOnly: boolean;
  clampedOnly: boolean;
  page: number;
  pageSize: PageSize;
  /** Oferta abierta en el panel de detalle. */
  offerId: string | null;
  filterSelection: FilterSelection;
  hasFilters: boolean;
};

/**
 * La URL es la única fuente de verdad: un enlace a "alzas que exigen
 * aprobación del evento X" reproduce exactamente la misma vista.
 */
export function usePricingUrlState() {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();

  const state = useMemo<PricingUrlState>(() => {
    const rawView = searchParams.get('vista') ?? '';
    const directions = parseDirections(searchParams.get('dir'));
    const approvalOnly = searchParams.get('aprobacion') === '1';
    const clampedOnly = searchParams.get('banda') === '1';
    const query = searchParams.get('q') ?? '';
    const rawSize = Number(searchParams.get('tam'));
    const marks: string[] = [];
    if (approvalOnly) marks.push('aprobacion');
    if (clampedOnly) marks.push('banda');

    const filterDraft: Record<string, readonly string[]> = {};
    if (directions.length > 0) filterDraft.direccion = directions;
    if (marks.length > 0) filterDraft.marca = marks;
    const filterSelection: FilterSelection = filterDraft;

    return {
      eventId: searchParams.get('evento') ?? '',
      view: isView(rawView) ? rawView : 'recomendaciones',
      query,
      directions,
      approvalOnly,
      clampedOnly,
      page: parsePage(searchParams.get('pagina')),
      pageSize: isPageSize(rawSize) ? rawSize : DEFAULT_PAGE_SIZE,
      offerId: searchParams.get('oferta'),
      filterSelection,
      hasFilters:
        query.trim().length > 0 || directions.length > 0 || approvalOnly || clampedOnly,
    };
  }, [searchParams]);

  const replaceParams = useCallback(
    (patch: Readonly<Record<string, string | null>>) => {
      const next = new URLSearchParams(searchParams.toString());
      for (const [key, value] of Object.entries(patch)) {
        if (value === null || value === '') next.delete(key);
        else next.set(key, value);
      }
      const qs = next.toString();
      router.replace(qs ? `${pathname}?${qs}` : pathname, { scroll: false });
    },
    [pathname, router, searchParams],
  );

  /** Cambiar de evento invalida la paginación y el detalle abierto. */
  const setEventId = useCallback(
    (eventId: string) =>
      replaceParams({ evento: eventId || null, pagina: null, oferta: null }),
    [replaceParams],
  );

  const setView = useCallback(
    (view: PricingView) =>
      replaceParams({
        vista: view === 'recomendaciones' ? null : view,
        pagina: null,
      }),
    [replaceParams],
  );

  const setQuery = useCallback(
    (query: string) => replaceParams({ q: query || null, pagina: null }),
    [replaceParams],
  );

  const setFilterSelection = useCallback(
    (selection: FilterSelection) => {
      const directions = (selection.direccion ?? []).filter(isDirection);
      const marks = selection.marca ?? [];
      replaceParams({
        dir: directions.length > 0 ? directions.join(',') : null,
        aprobacion: marks.includes('aprobacion') ? '1' : null,
        banda: marks.includes('banda') ? '1' : null,
        pagina: null,
      });
    },
    [replaceParams],
  );

  const setPage = useCallback(
    (page: number) => replaceParams({ pagina: page > 1 ? String(page) : null }),
    [replaceParams],
  );

  const setPageSize = useCallback(
    (size: PageSize) =>
      replaceParams({
        tam: size === DEFAULT_PAGE_SIZE ? null : String(size),
        pagina: null,
      }),
    [replaceParams],
  );

  const setOfferId = useCallback(
    (offerId: string | null) => replaceParams({ oferta: offerId }),
    [replaceParams],
  );

  const clearFilters = useCallback(
    () =>
      replaceParams({
        q: null,
        dir: null,
        aprobacion: null,
        banda: null,
        pagina: null,
      }),
    [replaceParams],
  );

  return {
    ...state,
    setEventId,
    setView,
    setQuery,
    setFilterSelection,
    setPage,
    setPageSize,
    setOfferId,
    clearFilters,
  };
}
