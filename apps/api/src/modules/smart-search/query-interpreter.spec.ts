import { interpretQuery, fuzzyIncludes, explainChips } from './query-interpreter';

/** Fija «ahora» en jueves 26 nov 2026 15:00 CST. */
const NOW = new Date('2026-11-26T21:00:00.000Z');

describe('interpretQuery', () => {
  it('rock sábado CDMX menos de 800', () => {
    const r = interpretQuery(
      'algo de rock este sábado en CDMX por menos de 800',
      NOW
    );
    expect(r.filters.category).toBe('MUSIC');
    expect(r.filters.genre).toBe('rock');
    expect(r.filters.city).toBe('CDMX');
    expect(r.filters.maxPrice).toBe(800);
    expect(r.filters.dateFrom).toBe('2026-11-28');
    expect(r.chips.join(' ')).toMatch(/Rock/i);
    expect(r.chips.some((c) => c.includes('800'))).toBe(true);
  });

  it('niños el domingo', () => {
    const r = interpretQuery('para ir con niños el domingo', NOW);
    expect(r.filters.kids).toBe(true);
    expect(r.filters.category).toBe('FAMILY');
    expect(r.filters.dateFrom).toBe('2026-11-29');
  });

  it('boletos baratos para el clásico', () => {
    const r = interpretQuery('boletos baratos para el clásico', NOW);
    expect(r.filters.cheap).toBe(true);
    expect(r.filters.category).toBe('SPORTS');
  });

  it('hoy', () => {
    const r = interpretQuery('conciertos hoy', NOW);
    expect(r.filters.dateFrom).toBe('2026-11-26');
    expect(r.filters.category).toBe('MUSIC');
  });

  it('mañana teatro', () => {
    const r = interpretQuery('teatro mañana en Puebla', NOW);
    expect(r.filters.dateFrom).toBe('2026-11-27');
    expect(r.filters.category).toBe('THEATER');
    expect(r.filters.city).toBe('Puebla');
  });

  it('este fin', () => {
    const r = interpretQuery('festival este fin de semana', NOW);
    expect(r.filters.dateFrom).toBe('2026-11-28');
    expect(r.filters.dateTo).toBe('2026-11-29');
    expect(r.filters.category).toBe('FESTIVAL');
  });

  it('próxima semana', () => {
    const r = interpretQuery('comedia la próxima semana', NOW);
    expect(r.filters.dateFrom).toBe('2026-11-30');
    expect(r.filters.dateTo).toBe('2026-12-06');
    expect(r.filters.category).toBe('COMEDY');
  });

  it('diciembre', () => {
    const r = interpretQuery('conciertos en diciembre en Guadalajara', NOW);
    expect(r.filters.dateFrom).toBe('2026-12-01');
    expect(r.filters.dateTo).toBe('2026-12-31');
    expect(r.filters.city).toBe('Guadalajara');
  });

  it('cerca del escenario y accesible', () => {
    const r = interpretQuery('lugares cerca del escenario accesible', NOW);
    expect(r.filters.nearStage).toBe(true);
    expect(r.filters.accessible).toBe(true);
  });

  it('4 personas', () => {
    const r = interpretQuery('standup para 4 personas en Monterrey', NOW);
    expect(r.filters.partySize).toBe(4);
    expect(r.filters.category).toBe('COMEDY');
    expect(r.filters.city).toBe('Monterrey');
  });

  it('hasta $500', () => {
    const r = interpretQuery('cine hasta 500', NOW);
    expect(r.filters.maxPrice).toBe(500);
    expect(r.filters.category).toBe('CINEMA');
  });

  it('fuzzyIncludes tolera acentos y typo', () => {
    expect(fuzzyIncludes('José José en el Auditorio', 'jose')).toBe(true);
    expect(fuzzyIncludes('Clásico Nacional', 'clasico')).toBe(true);
    expect(fuzzyIncludes('Rock fest', 'rockk')).toBe(true);
  });

  it('explainChips', () => {
    expect(explainChips(['Rock', 'CDMX', 'hasta $800'])).toBe('Rock · CDMX · hasta $800');
  });
});
