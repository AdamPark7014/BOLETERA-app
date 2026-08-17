/**
 * Diagnóstico de importación CAD (DXF / SVG).
 *
 * La importación fallaba con un único mensaje genérico —"DXF sin geometría
 * usable"— sin decir qué entidad se descartó ni dónde. Con un plano de recinto
 * real de miles de entidades eso es imposible de depurar: el operador solo sabe
 * que "no funciona".
 *
 * Aquí se recogen los descartes uno a uno (tipo de entidad, capa, posición en el
 * archivo, motivo) y se resumen en un error que sí se puede accionar.
 *
 * Identificadores en inglés, comentarios de dominio en español.
 */

export type CadSkipReason =
  /** El tipo de entidad no se soporta (BLOCK, HATCH, SPLINE, …). */
  | 'unsupported-type'
  /** La entidad no traía vértices. */
  | 'no-points'
  /** Los vértices no son números finitos. */
  | 'invalid-coordinates'
  /** Menos puntos de los que el rol necesita. */
  | 'too-few-points'
  /** Radio o ángulos inválidos en CIRCLE/ARC. */
  | 'invalid-arc'
  /** Atributo de SVG ausente o no interpretable. */
  | 'unparsable-attribute'
  /** La capa está bloqueada por los CAD locks del mapa. */
  | 'locked-layer'
  /** Geometría degenerada (área o longitud cero). */
  | 'degenerate';

export const CAD_SKIP_LABELS: Record<CadSkipReason, string> = {
  'unsupported-type': 'tipo de entidad no soportado',
  'no-points': 'sin vértices',
  'invalid-coordinates': 'coordenadas no numéricas',
  'too-few-points': 'vértices insuficientes',
  'invalid-arc': 'radio o ángulos inválidos',
  'unparsable-attribute': 'atributo ilegible',
  'locked-layer': 'capa bloqueada en el mapa',
  degenerate: 'geometría degenerada (tamaño cero)',
};

/** Pista concreta por motivo: qué hacer en el CAD para arreglarlo. */
export const CAD_SKIP_HINTS: Record<CadSkipReason, string> = {
  'unsupported-type':
    'Explota bloques y convierte splines a polilíneas antes de exportar (se admiten LINE, LWPOLYLINE, POLYLINE, CIRCLE y ARC).',
  'no-points': 'La entidad está vacía en el archivo; bórrala o vuelve a dibujarla.',
  'invalid-coordinates':
    'Revisa las unidades y que no haya coordenadas infinitas o NaN por escalado.',
  'too-few-points': 'Un pasillo o contorno necesita al menos dos vértices.',
  'invalid-arc': 'Comprueba que el radio sea mayor que cero y los ángulos estén en grados.',
  'unparsable-attribute':
    'Revisa el atributo `d`, `points` o `transform` del elemento SVG; los transform anidados no se resuelven.',
  'locked-layer': 'Desbloquea la categoría en los CAD locks del editor si quieres sobrescribirla.',
  degenerate: 'La entidad ocupa un área nula; suele venir de un doble clic accidental en el CAD.',
};

export type CadSkippedEntity = {
  reason: CadSkipReason;
  /** Tipo DXF (LWPOLYLINE, SPLINE…) o etiqueta SVG (path, rect…). */
  entityType: string;
  /** Capa DXF o id/clase del elemento SVG. */
  layer?: string;
  /** Índice de la entidad dentro del archivo, para poder localizarla. */
  index: number;
  /** Línea aproximada del archivo, cuando se conoce. */
  line?: number;
  /** Identificador propio de la entidad (handle DXF, id SVG). */
  ref?: string;
  /** Primer vértice, para ubicarla en el plano. */
  at?: [number, number];
  detail?: string;
};

/** Recolector de descartes durante el análisis del archivo. */
export class CadDiagnostics {
  readonly skipped: CadSkippedEntity[] = [];
  /** Entidades leídas correctamente. */
  accepted = 0;
  /** Tipos de entidad vistos, con su recuento. */
  readonly typesSeen = new Map<string, number>();

  note(entityType: string) {
    this.typesSeen.set(entityType, (this.typesSeen.get(entityType) ?? 0) + 1);
  }

  accept() {
    this.accepted += 1;
  }

  skip(entry: CadSkippedEntity) {
    this.skipped.push(entry);
  }

  get skippedCount(): number {
    return this.skipped.length;
  }

  /** Recuento por motivo, de mayor a menor. */
  byReason(): { reason: CadSkipReason; count: number; sample: CadSkippedEntity }[] {
    const groups = new Map<CadSkipReason, CadSkippedEntity[]>();
    for (const s of this.skipped) {
      const arr = groups.get(s.reason) ?? [];
      arr.push(s);
      groups.set(s.reason, arr);
    }
    return [...groups.entries()]
      .map(([reason, list]) => ({ reason, count: list.length, sample: list[0] }))
      .sort((a, b) => b.count - a.count);
  }

  /** Descripción de una entidad concreta, para el mensaje de error. */
  static describe(e: CadSkippedEntity): string {
    const parts = [`${e.entityType} #${e.index + 1}`];
    if (e.layer) parts.push(`capa "${e.layer}"`);
    if (e.ref) parts.push(`ref ${e.ref}`);
    if (e.line != null) parts.push(`línea ${e.line}`);
    if (e.at) parts.push(`en (${Math.round(e.at[0])}, ${Math.round(e.at[1])})`);
    return parts.join(', ');
  }
}

/** Error de importación con el detalle de qué falló y dónde. */
export class CadImportError extends Error {
  readonly source: 'dxf' | 'svg';
  readonly diagnostics: CadDiagnostics;

  constructor(source: 'dxf' | 'svg', diagnostics: CadDiagnostics, headline: string) {
    super(buildMessage(source, diagnostics, headline));
    this.name = 'CadImportError';
    this.source = source;
    this.diagnostics = diagnostics;
  }
}

function buildMessage(
  source: 'dxf' | 'svg',
  diag: CadDiagnostics,
  headline: string,
): string {
  const lines: string[] = [headline];

  if (diag.skippedCount === 0 && diag.typesSeen.size === 0) {
    lines.push('');
    lines.push(
      source === 'dxf'
        ? 'No se encontró la sección ENTITIES: puede que el archivo sea DXF binario. Vuelve a exportarlo como DXF ASCII.'
        : 'No se encontró ningún elemento gráfico (path, polyline, rect, circle) dentro del SVG.',
    );
    return lines.join('\n');
  }

  if (diag.typesSeen.size) {
    const seen = [...diag.typesSeen.entries()]
      .sort((a, b) => b[1] - a[1])
      .slice(0, 8)
      .map(([t, n]) => `${t}×${n}`)
      .join(', ');
    lines.push('');
    lines.push(`Entidades encontradas: ${seen}`);
  }

  if (diag.skippedCount) {
    lines.push('');
    lines.push(`Descartadas ${diag.skippedCount}:`);
    for (const group of diag.byReason().slice(0, 6)) {
      lines.push(
        `  • ${group.count}× ${CAD_SKIP_LABELS[group.reason]} — p. ej. ${CadDiagnostics.describe(group.sample)}`,
      );
      lines.push(`    ${CAD_SKIP_HINTS[group.reason]}`);
    }
  }

  return lines.join('\n');
}

/** Resumen legible aunque la importación haya salido bien (avisos parciales). */
export type CadImportReport = {
  accepted: number;
  skipped: number;
  bySkipReason: { reason: CadSkipReason; label: string; count: number; example: string }[];
  typesSeen: { type: string; count: number }[];
};

export function buildCadImportReport(diag: CadDiagnostics): CadImportReport {
  return {
    accepted: diag.accepted,
    skipped: diag.skippedCount,
    bySkipReason: diag.byReason().map((g) => ({
      reason: g.reason,
      label: CAD_SKIP_LABELS[g.reason],
      count: g.count,
      example: CadDiagnostics.describe(g.sample),
    })),
    typesSeen: [...diag.typesSeen.entries()]
      .map(([type, count]) => ({ type, count }))
      .sort((a, b) => b.count - a.count),
  };
}
