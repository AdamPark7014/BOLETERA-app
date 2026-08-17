export type CsvCell = string | number | null | undefined;

export interface CsvTable {
  /** Nombre del archivo sin extensión. */
  readonly name: string;
  readonly columns: readonly string[];
  readonly rows: readonly (readonly CsvCell[])[];
}

function escapeCell(cell: CsvCell): string {
  if (cell === null || cell === undefined) return '';
  const text = typeof cell === 'number' ? String(cell) : cell;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

/** Serializa una tabla a CSV. Los números salen sin formato para poder operarlos. */
export function toCsv(table: CsvTable): string {
  const lines = [
    table.columns.map(escapeCell).join(','),
    ...table.rows.map((row) => row.map(escapeCell).join(',')),
  ];
  return lines.join('\r\n');
}

function triggerDownload(filename: string, contents: BlobPart, mime: string): void {
  if (typeof document === 'undefined') return;
  const blob = new Blob([contents], { type: mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  document.body.removeChild(anchor);
  URL.revokeObjectURL(url);
}

/**
 * Descarga la tabla como CSV. Se antepone el BOM UTF-8 porque sin él Excel en
 * es-MX rompe los acentos.
 */
export function downloadCsv(table: CsvTable, suffix: string): void {
  triggerDownload(
    `${table.name}-${suffix}.csv`,
    `\uFEFF${toCsv(table)}`,
    'text/csv;charset=utf-8;',
  );
}

/** Descarga un CSV ya serializado (p. ej. el del endpoint `/reports/export`). */
export function downloadRawCsv(filename: string, csv: string): void {
  triggerDownload(filename, `\uFEFF${csv}`, 'text/csv;charset=utf-8;');
}

/** Sufijo de archivo con el rango exportado: `2026-03-01_2026-03-28`. */
export function rangeSuffix(from: string, to: string): string {
  return `${from.slice(0, 10)}_${to.slice(0, 10)}`;
}
