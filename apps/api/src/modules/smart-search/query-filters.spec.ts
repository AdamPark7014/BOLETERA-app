import { normalizeQuery, stripAccents, EMPTY_FILTERS } from './query-filters';

describe('query-filters', () => {
  it('normalizeQuery minúsculas, sin acentos y espacios colapsados', () => {
    expect(normalizeQuery('  México   Rock  ')).toBe('mexico rock');
  });

  it('normalizeQuery vacío o solo espacios', () => {
    expect(normalizeQuery('')).toBe('');
    expect(normalizeQuery('   ')).toBe('');
  });

  it('stripAccents quita tildes', () => {
    expect(stripAccents('Niños')).toBe('Ninos');
  });

  it('EMPTY_FILTERS es objeto vacío', () => {
    expect(EMPTY_FILTERS).toEqual({});
  });
});
