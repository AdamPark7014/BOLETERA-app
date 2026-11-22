export type SmartSearchFilters = {
  text?: string;
  city?: string;
  category?: string;
  genre?: string;
  dateFrom?: string;
  dateTo?: string;
  maxPrice?: number;
  partySize?: number;
  cheap?: boolean;
  nearStage?: boolean;
  accessible?: boolean;
  kids?: boolean;
};

export type InterpretResult = {
  filters: SmartSearchFilters;
  chips: string[];
  residual: string;
  source: 'deterministic' | 'model' | 'hybrid';
};

export const EMPTY_FILTERS: SmartSearchFilters = {};

/** Minúsculas, sin acentos, espacios colapsados. */
export function normalizeQuery(q: string): string {
  return q
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .replace(/\s+/g, ' ');
}

export function stripAccents(s: string): string {
  return s.normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}
