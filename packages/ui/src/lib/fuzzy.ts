/**
 * Coincidencia difusa por subsecuencia, al estilo de Raycast o el buscador de
 * Linear: "nue" encuentra "Nuevo evento" y "cev" encuentra "Crear evento".
 *
 * No es un algoritmo generico de distancia de edicion; esta afinado para listas
 * cortas de comandos, donde importa premiar los inicios de palabra.
 */

/** Resultado de una coincidencia: puntaje y posiciones resaltables. */
export interface FuzzyMatch {
  score: number;
  /** Indices de `text` que coincidieron, en orden ascendente. */
  indices: number[];
}

const START_BONUS = 12;
const CONSECUTIVE_BONUS = 8;
const WORD_BOUNDARY_BONUS = 10;
const GAP_PENALTY = 1;

function isBoundary(text: string, index: number): boolean {
  if (index === 0) return true;
  const previous = text.charAt(index - 1);
  return previous === ' ' || previous === '-' || previous === '_' || previous === '/';
}

/** Normaliza para que "sesion" encuentre "sesión" y viceversa. */
function normalize(value: string): string {
  return value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();
}

/**
 * Busca `query` como subsecuencia de `text`.
 * @returns La coincidencia, o `null` si algun caracter de la consulta falta.
 */
export function fuzzyMatch(text: string, query: string): FuzzyMatch | null {
  if (query.length === 0) return { score: 0, indices: [] };

  const haystack = normalize(text);
  const needle = normalize(query);

  const indices: number[] = [];
  let score = 0;
  let cursor = 0;
  let previousIndex = -1;

  for (const character of needle) {
    const found = haystack.indexOf(character, cursor);
    if (found === -1) return null;

    if (found === 0) score += START_BONUS;
    if (isBoundary(haystack, found)) score += WORD_BOUNDARY_BONUS;
    if (previousIndex >= 0 && found === previousIndex + 1) score += CONSECUTIVE_BONUS;
    else if (previousIndex >= 0) score -= (found - previousIndex - 1) * GAP_PENALTY;

    indices.push(found);
    previousIndex = found;
    cursor = found + 1;
  }

  // Los aciertos que cubren casi todo el texto valen mas que los dispersos.
  score += Math.round((needle.length / Math.max(1, haystack.length)) * 20);
  return { score, indices };
}

/**
 * Mejor coincidencia entre el texto principal y sus palabras clave. Las
 * coincidencias por palabra clave puntuan algo menos que las del titulo.
 */
export function bestMatch(
  primary: string,
  keywords: readonly string[],
  query: string,
): FuzzyMatch | null {
  const direct = fuzzyMatch(primary, query);
  let best = direct;

  for (const keyword of keywords) {
    const match = fuzzyMatch(keyword, query);
    if (!match) continue;
    const demoted: FuzzyMatch = { score: match.score - 6, indices: [] };
    if (!best || demoted.score > best.score) best = demoted;
  }

  return best;
}

/** Divide `text` en tramos coincidentes y no coincidentes, para resaltarlos. */
export function highlightSegments(
  text: string,
  indices: readonly number[],
): Array<{ text: string; matched: boolean }> {
  if (indices.length === 0) return [{ text, matched: false }];

  const flags = new Set(indices);
  const segments: Array<{ text: string; matched: boolean }> = [];
  let buffer = '';
  let bufferMatched = flags.has(0);

  for (let i = 0; i < text.length; i += 1) {
    const matched = flags.has(i);
    if (matched !== bufferMatched && buffer.length > 0) {
      segments.push({ text: buffer, matched: bufferMatched });
      buffer = '';
    }
    bufferMatched = matched;
    buffer += text.charAt(i);
  }

  if (buffer.length > 0) segments.push({ text: buffer, matched: bufferMatched });
  return segments;
}
