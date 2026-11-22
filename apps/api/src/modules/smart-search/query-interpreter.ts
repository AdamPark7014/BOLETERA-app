import {
  EMPTY_FILTERS,
  normalizeQuery,
  type InterpretResult,
  type SmartSearchFilters,
} from './query-filters';

const TZ = 'America/Mexico_City';
const WEEKDAYS = [
  'domingo',
  'lunes',
  'martes',
  'miércoles',
  'jueves',
  'viernes',
  'sábado',
] as const;

type Ymd = { y: number; m: number; d: number; weekday: number };

function mexicoParts(now: Date): Ymd {
  const fmt = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    weekday: 'short',
  });
  const parts = Object.fromEntries(
    fmt.formatToParts(now).map((p) => [p.type, p.value])
  ) as Record<string, string>;
  const map: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6,
  };
  return {
    y: Number(parts.year),
    m: Number(parts.month),
    d: Number(parts.day),
    weekday: map[parts.weekday] ?? 0,
  };
}

function ymdToIso(y: number, m: number, d: number): string {
  return `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
}

function addDays(base: Ymd, days: number): Ymd {
  const utc = Date.UTC(base.y, base.m - 1, base.d + days, 12, 0, 0);
  return mexicoParts(new Date(utc));
}

function chipDate(ymd: Ymd): string {
  return `${WEEKDAYS[ymd.weekday]} ${ymd.d}`;
}

function scrub(n: string, re: RegExp): string {
  return n.replace(re, ' ').replace(/\s+/g, ' ').trim();
}

/**
 * Intérprete determinista de frases en español de México.
 * Zona horaria: America/Mexico_City.
 */
export function interpretQuery(q: string, now: Date = new Date()): InterpretResult {
  const filters: SmartSearchFilters = { ...EMPTY_FILTERS };
  const chips: string[] = [];
  let n = normalizeQuery(q);
  const today = mexicoParts(now);

  const price = n.match(
    /\b(?:por\s+)?(?:menos|bajo|hasta|maximo|max)\s+(?:de\s+)?(?:\$)?(\d{2,5})\b/
  );
  if (price) {
    filters.maxPrice = Number(price[1]);
    chips.push(`hasta $${filters.maxPrice}`);
    n = scrub(n, /\b(?:por\s+)?(?:menos|bajo|hasta|maximo|max)\s+(?:de\s+)?(?:\$)?\d{2,5}\b/);
  }

  let party = n.match(/\b(\d{1,2})\s*personas?\b/);
  if (!party) party = n.match(/\bpara\s+(\d{1,2})\b(?!\s*(?:pesos|mxn|\$))/);
  if (party) {
    filters.partySize = Number(party[1]);
    chips.push(`${filters.partySize} personas`);
    n = scrub(n, /\b\d{1,2}\s*personas?\b|\bpara\s+\d{1,2}\b(?!\s*(?:pesos|mxn|\$))/);
  }

  if (/\b(barato|baratos|economico|oferta)\b/.test(n)) {
    filters.cheap = true;
    chips.push('barato');
    n = scrub(n, /\b(barato|baratos|economico|oferta)\b/g);
  }
  if (/\b(cerca del escenario|primera fila|al frente)\b/.test(n)) {
    filters.nearStage = true;
    chips.push('cerca del escenario');
    n = scrub(n, /\b(cerca del escenario|primera fila|al frente)\b/g);
  }
  if (/\b(accesible|accesibilidad|silla de ruedas|discapacidad)\b/.test(n)) {
    filters.accessible = true;
    chips.push('accesible');
    n = scrub(n, /\b(accesible|accesibilidad|silla de ruedas|discapacidad)\b/g);
  }
  if (/\b(ninos|nina|ninas|kids|familia|para ir con ninos)\b/.test(n)) {
    filters.kids = true;
    filters.category = filters.category ?? 'FAMILY';
    chips.push('niños');
    n = scrub(n, /\b(para ir con ninos|ninos|nina|ninas|kids|familia)\b/g);
  }

  if (/\bhoy\b/.test(n)) {
    filters.dateFrom = ymdToIso(today.y, today.m, today.d);
    filters.dateTo = filters.dateFrom;
    chips.push('hoy');
    n = scrub(n, /\bhoy\b/g);
  } else if (/\bmanana\b/.test(n)) {
    const t = addDays(today, 1);
    filters.dateFrom = ymdToIso(t.y, t.m, t.d);
    filters.dateTo = filters.dateFrom;
    chips.push('mañana');
    n = scrub(n, /\bmanana\b/g);
  } else if (/\b(este fin(?: de semana)?|fin de semana)\b/.test(n)) {
    let start: Ymd;
    let end: Ymd;
    if (today.weekday === 0) {
      start = addDays(today, -1);
      end = today;
    } else if (today.weekday === 6) {
      start = today;
      end = addDays(today, 1);
    } else {
      start = addDays(today, 6 - today.weekday);
      end = addDays(start, 1);
    }
    filters.dateFrom = ymdToIso(start.y, start.m, start.d);
    filters.dateTo = ymdToIso(end.y, end.m, end.d);
    chips.push('este fin');
    n = scrub(n, /\b(este fin(?: de semana)?|fin de semana)\b/g);
  } else if (/\b(la )?proxima semana\b/.test(n)) {
    const daysToMon = (8 - today.weekday) % 7 || 7;
    const mon = addDays(today, daysToMon);
    const sun = addDays(mon, 6);
    filters.dateFrom = ymdToIso(mon.y, mon.m, mon.d);
    filters.dateTo = ymdToIso(sun.y, sun.m, sun.d);
    chips.push('próxima semana');
    n = scrub(n, /\b(la )?proxima semana\b/g);
  } else if (/\bsabado\b/.test(n)) {
    const sat = addDays(today, (6 - today.weekday + 7) % 7);
    filters.dateFrom = ymdToIso(sat.y, sat.m, sat.d);
    filters.dateTo = filters.dateFrom;
    chips.push(chipDate(sat));
    n = scrub(n, /\bsabado\b/g);
  } else if (/\bdomingo\b/.test(n)) {
    const sun = addDays(today, (7 - today.weekday) % 7);
    filters.dateFrom = ymdToIso(sun.y, sun.m, sun.d);
    filters.dateTo = filters.dateFrom;
    chips.push(chipDate(sun));
    n = scrub(n, /\bdomingo\b/g);
  } else if (/\bdiciembre\b/.test(n)) {
    filters.dateFrom = ymdToIso(today.y, 12, 1);
    filters.dateTo = ymdToIso(today.y, 12, 31);
    chips.push('diciembre');
    n = scrub(n, /\bdiciembre\b/g);
  }

  const cities: Array<{ re: RegExp; city: string }> = [
    { re: /\b(cdmx|ciudad de mexico|mexico df|\bdf\b)\b/, city: 'CDMX' },
    { re: /\b(guadalajara|gdl)\b/, city: 'Guadalajara' },
    { re: /\b(monterrey|mty)\b/, city: 'Monterrey' },
    { re: /\bpuebla\b/, city: 'Puebla' },
    { re: /\bqueretaro\b/, city: 'Querétaro' },
    { re: /\btijuana\b/, city: 'Tijuana' },
    { re: /\bcancun\b/, city: 'Cancún' },
    { re: /\bmerida\b/, city: 'Mérida' },
    { re: /\bleon\b/, city: 'León' },
    { re: /\btoluca\b/, city: 'Toluca' },
  ];
  for (const c of cities) {
    if (c.re.test(n)) {
      filters.city = c.city;
      chips.push(c.city);
      n = scrub(n, c.re);
      break;
    }
  }

  const genres: Array<{ re: RegExp; genre: string; chip: string }> = [
    { re: /\brock\b/, genre: 'rock', chip: 'Rock' },
    { re: /\bpop\b/, genre: 'pop', chip: 'Pop' },
    { re: /\bindie\b/, genre: 'indie', chip: 'Indie' },
    { re: /\bmetal\b/, genre: 'metal', chip: 'Metal' },
    { re: /\breggaeton\b/, genre: 'reggaeton', chip: 'Reggaetón' },
  ];
  for (const g of genres) {
    if (g.re.test(n)) {
      filters.genre = g.genre;
      filters.category = 'MUSIC';
      chips.push(g.chip);
      n = scrub(n, g.re);
      break;
    }
  }

  if (!filters.category) {
    if (/\b(musica|concierto|conciertos)\b/.test(n)) {
      filters.category = 'MUSIC';
      chips.push('Conciertos');
      n = scrub(n, /\b(musica|concierto|conciertos)\b/g);
    } else if (/\b(deporte|deportes|futbol|partido|clasico)\b/.test(n)) {
      filters.category = 'SPORTS';
      chips.push('Deportes');
      if (/\bclasico\b/.test(n)) {
        filters.text = 'clásico';
        chips.push('clásico');
      }
      n = scrub(n, /\b(deporte|deportes|futbol|partido|clasico)\b/g);
    } else if (/\b(teatro|obra)\b/.test(n)) {
      filters.category = 'THEATER';
      chips.push('Teatro');
      n = scrub(n, /\b(teatro|obra)\b/g);
    } else if (/\b(comedia|standup|stand up)\b/.test(n)) {
      filters.category = 'COMEDY';
      chips.push('Comedia');
      n = scrub(n, /\b(comedia|standup|stand up)\b/g);
    } else if (/\bfestival\b/.test(n)) {
      filters.category = 'FESTIVAL';
      chips.push('Festival');
      n = scrub(n, /\bfestival\b/g);
    } else if (/\bcine\b/.test(n)) {
      filters.category = 'CINEMA';
      chips.push('Cine');
      n = scrub(n, /\bcine\b/g);
    }
  }

  n = scrub(
    n,
    /\b(algo de|boletos?|para|el|la|los|las|un|una|de|en|con|por|este|esta|quiero|buscar|ver)\b/g
  );

  if (n.length >= 2) {
    filters.text = filters.text ? `${filters.text} ${n}`.trim() : n;
  }

  return { filters, chips, residual: n, source: 'deterministic' };
}

export function explainChips(chips: string[]): string {
  return chips.filter(Boolean).join(' · ');
}

/** Coincidencia tolerante a acentos y faltas leves. */
export function fuzzyIncludes(haystack: string, needle: string): boolean {
  const h = normalizeQuery(haystack);
  const n = normalizeQuery(needle);
  if (!n) return true;
  if (h.includes(n)) return true;
  return n.split(' ').every((t) => {
    if (t.length < 3) return h.includes(t);
    if (h.includes(t)) return true;
    return h.split(/\s+/).some((w) => editDistance(w, t) <= 1);
  });
}

function editDistance(a: string, b: string): number {
  if (Math.abs(a.length - b.length) > 1) return 99;
  const m = a.length;
  const n = b.length;
  const dp: number[][] = Array.from({ length: m + 1 }, () => Array(n + 1).fill(0));
  for (let i = 0; i <= m; i++) dp[i][0] = i;
  for (let j = 0; j <= n; j++) dp[0][j] = j;
  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(dp[i - 1][j] + 1, dp[i][j - 1] + 1, dp[i - 1][j - 1] + cost);
    }
  }
  return dp[m][n];
}
