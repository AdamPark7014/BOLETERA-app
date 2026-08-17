/**
 * Convenciones de numeración de filas y butacas.
 *
 * La numeración es lo que rompe la operación en puerta: si el mapa dice "Fila I,
 * butaca 12" y el acomodador ve "Fila J, butaca 11", el evento se cae. Este módulo
 * concentra las convenciones reales que usan los recintos para que generadores,
 * importadores y renumeraciones masivas produzcan siempre la misma etiqueta.
 *
 * Identificadores en inglés, comentarios de dominio en español (convención del repo).
 */

/** Alfabeto latino completo. */
const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ';

/**
 * Letras que la mayoría de recintos omite por ambigüedad visual:
 * `I` se confunde con 1, `O` con 0. Muchos teatros omiten también `Q` (parece O)
 * y `Ñ` no se usa nunca en numeración aunque el recinto sea hispanohablante.
 */
export const AMBIGUOUS_ROW_LETTERS = ['I', 'O'] as const;

export type RowLabelScheme =
  /** A, B, C … Z, AA, AB, AC … (sin omitir letras) */
  | 'latin'
  /** A, B, C … omitiendo I y O — convención dominante en teatros */
  | 'latin-no-ambiguous'
  /** A, B, C … omitiendo I, O y Q */
  | 'latin-no-ambiguous-q'
  /** Z, Y, X … (fila A al fondo; usado cuando la fila 1 está pegada al escenario) */
  | 'latin-reverse'
  /** 1, 2, 3 … */
  | 'numeric'
  /** AA, BB, CC … (tribunas de estadio) */
  | 'doubled';

export type SeatNumberScheme =
  /** 1, 2, 3 … de izquierda a derecha vistos desde el escenario */
  | 'sequential'
  /** N … 3, 2, 1 — de derecha a izquierda */
  | 'sequential-rtl'
  /**
   * Pares e impares desde el centro hacia afuera.
   * Mitad izquierda: 2, 4, 6 … Mitad derecha: 1, 3, 5 …
   * Convención española / latinoamericana de teatro ("butacas pares e impares").
   */
  | 'odd-even-from-center'
  /** Igual que la anterior pero con impares a la izquierda y pares a la derecha */
  | 'even-odd-from-center'
  /** 1, 2, 3 … hacia afuera en ambos lados (se distinguen por sufijo de sector) */
  | 'from-center'
  /** La numeración continúa entre filas en lugar de reiniciar (palcos, gradas) */
  | 'continuous';

export type NumberingConvention = {
  rowScheme?: RowLabelScheme;
  seatScheme?: SeatNumberScheme;
  /** Primera etiqueta de fila (p. ej. 'C' para empezar en la fila C). */
  startRowLabel?: string;
  /** Primer número de butaca (por defecto 1). */
  startSeatNumber?: number;
  /** Prefijo de fila, p. ej. 'AA' → 'AA1'..; o 'F' → 'F1'.. con rowScheme numeric. */
  rowPrefix?: string;
  /** Sufijo de sector añadido al número de butaca (p. ej. 'IZQ' / 'DER'). */
  sideSuffix?: { left: string; right: string };
  /**
   * Serpentina: filas pares numeran al revés que las impares.
   * Se usa en algunas gradas modulares; casi nunca en teatro.
   */
  serpentine?: boolean;
  /** Separador entre fila y butaca en la etiqueta visible. Por defecto '-'. */
  labelSeparator?: string;
  /** Rellena el número con ceros a la izquierda hasta este ancho (p. ej. 3 → '007'). */
  padSeatNumberTo?: number;
};

export const DEFAULT_CONVENTION: Required<
  Pick<NumberingConvention, 'rowScheme' | 'seatScheme' | 'startSeatNumber' | 'labelSeparator'>
> = {
  rowScheme: 'latin-no-ambiguous',
  seatScheme: 'sequential',
  startSeatNumber: 1,
  labelSeparator: '-',
};

function alphabetFor(scheme: RowLabelScheme): string {
  if (scheme === 'latin-no-ambiguous') {
    return ALPHABET.split('')
      .filter((c) => !AMBIGUOUS_ROW_LETTERS.includes(c as (typeof AMBIGUOUS_ROW_LETTERS)[number]))
      .join('');
  }
  if (scheme === 'latin-no-ambiguous-q') {
    return ALPHABET.split('')
      .filter(
        (c) =>
          !AMBIGUOUS_ROW_LETTERS.includes(c as (typeof AMBIGUOUS_ROW_LETTERS)[number]) && c !== 'Q',
      )
      .join('');
  }
  return ALPHABET;
}

/**
 * Convierte un índice 0-based a etiqueta bijectiva sobre el alfabeto dado.
 * 0→A, 1→B … 25→Z, 26→AA, 27→AB (base-26 bijectiva, no posicional con cero).
 */
function bijectiveLabel(index: number, alphabet: string): string {
  const base = alphabet.length;
  let n = index;
  let out = '';
  do {
    out = alphabet[n % base] + out;
    n = Math.floor(n / base) - 1;
  } while (n >= 0);
  return out;
}

/** Índice 0-based a partir de una etiqueta de fila (inverso de `bijectiveLabel`). */
function labelToIndex(label: string, alphabet: string): number {
  const base = alphabet.length;
  let n = 0;
  for (const ch of label.toUpperCase()) {
    const pos = alphabet.indexOf(ch);
    // Letra fuera del alfabeto de la convención: no es un punto de partida válido.
    if (pos < 0) return -1;
    n = n * base + (pos + 1);
  }
  return n - 1;
}

/**
 * Etiqueta de fila para el índice dado (0-based) según la convención.
 *
 * @param index índice de fila empezando en 0 (la más cercana al escenario)
 * @param totalRows total de filas — solo necesario para `latin-reverse`
 */
export function rowLabelAt(
  index: number,
  convention: NumberingConvention = {},
  totalRows?: number,
): string {
  const scheme = convention.rowScheme ?? DEFAULT_CONVENTION.rowScheme;
  const prefix = convention.rowPrefix ?? '';

  if (scheme === 'numeric') {
    const start = convention.startRowLabel ? Number(convention.startRowLabel) || 1 : 1;
    return `${prefix}${start + index}`;
  }

  const alphabet = alphabetFor(scheme === 'latin-reverse' ? 'latin' : scheme);

  if (scheme === 'doubled') {
    const letter = alphabet[index % alphabet.length];
    const repeat = Math.floor(index / alphabet.length) + 1;
    return `${prefix}${letter.repeat(repeat)}`;
  }

  let effective = index;
  if (scheme === 'latin-reverse' && totalRows && totalRows > 0) {
    effective = totalRows - 1 - index;
  }

  // Desplazamiento por fila inicial (p. ej. empezar en 'C').
  if (convention.startRowLabel) {
    const offset = labelToIndex(convention.startRowLabel, alphabet);
    if (offset >= 0) effective += offset;
  }

  return `${prefix}${bijectiveLabel(Math.max(0, effective), alphabet)}`;
}

/** Etiquetas de fila para un bloque completo — útil para previsualizar la convención. */
export function rowLabelsFor(totalRows: number, convention: NumberingConvention = {}): string[] {
  return Array.from({ length: totalRows }, (_, i) => rowLabelAt(i, convention, totalRows));
}

export type SeatNumbering = {
  /** Número de butaca tal como se imprime en el boleto. */
  number: number;
  /** Etiqueta completa (fila + separador + número + sufijo de sector). */
  label: string;
  /** Lado respecto al eje central; `center` cuando el asiento cae en el eje. */
  side: 'left' | 'right' | 'center';
  /** Sufijo aplicado (cadena vacía si la convención no usa sectores). */
  suffix: string;
};

function padNumber(n: number, width?: number): string {
  if (!width || width <= 0) return String(n);
  return String(n).padStart(width, '0');
}

/**
 * Calcula la numeración de una butaca dentro de su fila.
 *
 * @param columnIndex índice 0-based dentro de la fila, de izquierda a derecha
 *                    vista desde el escenario (el mismo orden en que se generan)
 * @param seatsInRow  total de butacas ocupadas en esa fila (sin contar huecos)
 * @param rowLabel    etiqueta de fila ya calculada
 * @param rowIndex    índice 0-based de la fila (necesario para serpentina y continua)
 * @param seatsBefore butacas acumuladas en filas anteriores (solo `continuous`)
 */
export function seatNumberAt(
  columnIndex: number,
  seatsInRow: number,
  rowLabel: string,
  convention: NumberingConvention = {},
  rowIndex = 0,
  seatsBefore = 0,
): SeatNumbering {
  const scheme = convention.seatScheme ?? DEFAULT_CONVENTION.seatScheme;
  const start = convention.startSeatNumber ?? DEFAULT_CONVENTION.startSeatNumber;
  const sep = convention.labelSeparator ?? DEFAULT_CONVENTION.labelSeparator;

  // La serpentina invierte el sentido en filas de índice impar.
  let col = columnIndex;
  if (convention.serpentine && rowIndex % 2 === 1) {
    col = seatsInRow - 1 - columnIndex;
  }

  const centerBased =
    scheme === 'odd-even-from-center' ||
    scheme === 'even-odd-from-center' ||
    scheme === 'from-center';

  // En las convenciones desde el centro el lado lo define el mismo corte que usa
  // la numeración (la butaca del eje cae en el grupo izquierdo), no la mitad exacta.
  const leftCount = Math.ceil(seatsInRow / 2);
  let side: SeatNumbering['side'];
  if (centerBased) {
    side = col < leftCount ? 'left' : 'right';
  } else {
    const mid = (seatsInRow - 1) / 2;
    side = col < mid ? 'left' : col > mid ? 'right' : 'center';
  }

  let number: number;

  switch (scheme) {
    case 'sequential-rtl':
      number = start + (seatsInRow - 1 - col);
      break;

    case 'continuous':
      number = start + seatsBefore + col;
      break;

    case 'odd-even-from-center':
    case 'even-odd-from-center': {
      // Distancia al centro: 0 para la butaca más cercana al eje, creciendo hacia afuera.
      const isLeft = side === 'left';
      const stepsFromCenter = isLeft ? leftCount - 1 - col : col - leftCount;
      const leftIsEven = scheme === 'odd-even-from-center';
      const parityBase = isLeft === leftIsEven ? 2 : 1;
      // start-1 desplaza la serie completa si el recinto no empieza en 1.
      number = parityBase + stepsFromCenter * 2 + (start - 1);
      break;
    }

    case 'from-center': {
      const isLeft = side === 'left';
      const stepsFromCenter = isLeft ? leftCount - 1 - col : col - leftCount;
      number = start + stepsFromCenter;
      break;
    }

    case 'sequential':
    default:
      number = start + col;
      break;
  }

  let suffix = '';
  if (convention.sideSuffix && side !== 'center') {
    suffix = side === 'left' ? convention.sideSuffix.left : convention.sideSuffix.right;
  } else if (convention.sideSuffix && side === 'center') {
    // El eje exacto se asigna al lado derecho por convención de taquilla.
    suffix = convention.sideSuffix.right;
  }

  const printed = padNumber(number, convention.padSeatNumberTo);
  const label = suffix ? `${rowLabel}${sep}${printed}${suffix}` : `${rowLabel}${sep}${printed}`;

  return { number, label, side, suffix };
}

/**
 * Numera una fila completa de una vez.
 * Devuelve un array paralelo al de butacas de entrada.
 */
export function numberRow(
  seatsInRow: number,
  rowLabel: string,
  convention: NumberingConvention = {},
  rowIndex = 0,
  seatsBefore = 0,
): SeatNumbering[] {
  return Array.from({ length: seatsInRow }, (_, c) =>
    seatNumberAt(c, seatsInRow, rowLabel, convention, rowIndex, seatsBefore),
  );
}

/**
 * Verifica que una convención no produzca etiquetas duplicadas ni saltos raros
 * para un bloque de filas × butacas. Se usa en `validate` y en el editor antes
 * de aplicar una renumeración masiva.
 */
export function previewConvention(
  rows: number,
  seatsPerRow: number,
  convention: NumberingConvention = {},
): { labels: string[][]; duplicates: string[]; ok: boolean } {
  const labels: string[][] = [];
  const seen = new Map<string, number>();
  let before = 0;

  for (let r = 0; r < rows; r++) {
    const rowLabel = rowLabelAt(r, convention, rows);
    const row = numberRow(seatsPerRow, rowLabel, convention, r, before).map((n) => n.label);
    for (const l of row) seen.set(l, (seen.get(l) ?? 0) + 1);
    labels.push(row);
    before += seatsPerRow;
  }

  const duplicates = [...seen.entries()].filter(([, n]) => n > 1).map(([l]) => l);
  return { labels, duplicates, ok: duplicates.length === 0 };
}
