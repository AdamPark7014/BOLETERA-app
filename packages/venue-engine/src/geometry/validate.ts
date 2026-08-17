import type { SeatMapShape } from '@boletera/shared';
import { analyzeCirculation } from './circulation';
import { resolveEgressPolicy } from './egress-report';
import { auditAccessibility } from './accessibility';
import type {
  GeometryIssue,
  GeometryIssueCode,
  GeometryValidation,
  ResolvedVenueScene,
} from './types';

export type ValidateGeometryOptions = {
  /**
   * When set, only validate seats/sections on this level (untagged included).
   * Overlaps between different levels are never reported, even without levelId.
   */
  levelId?: string;
  /**
   * Aforo declarado del recinto o del evento. Si no cuadra con las butacas
   * generadas, se avisa: publicar con un aforo que no coincide con el mapa es
   * la forma más rápida de vender de más.
   */
  declaredCapacity?: number;
  /** Omitir las comprobaciones de accesibilidad (por defecto se hacen). */
  skipAccessibility?: boolean;
};

/** Tope de avisos individuales por código antes de agrupar en uno solo. */
const MAX_ISSUES_PER_CODE = 25;

function pointInPolygon(x: number, y: number, points: [number, number][]): boolean {
  if (points.length < 3) return true;
  let inside = false;
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const [xi, yi] = points[i];
    const [xj, yj] = points[j];
    const intersect =
      yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi + Number.EPSILON) + xi;
    if (intersect) inside = !inside;
  }
  return inside;
}

function touchesLevel(
  levelId: string | undefined,
  entityLevelId: string | undefined,
): boolean {
  if (!levelId) return true;
  if (!entityLevelId) return true;
  return entityLevelId === levelId;
}

/**
 * Validate spatial integrity.
 * Overlaps are warnings by default; set venue.cadLocks.strictOverlaps to elevate to errors.
 */
export function validateGeometry(
  scene: ResolvedVenueScene,
  options?: ValidateGeometryOptions,
): GeometryValidation {
  const issues: GeometryIssue[] = [];
  const levelId = options?.levelId;
  const seats = levelId
    ? scene.seats.filter((s) => touchesLevel(levelId, s.levelId))
    : scene.seats;
  const sections = levelId
    ? scene.sections.filter((s) => touchesLevel(levelId, s.levelId))
    : scene.sections;
  const sectionIds = new Set(sections.map((s) => s.id));

  const strict = Boolean(scene.map.venue?.cadLocks?.strictOverlaps);
  const overlapSeverity = strict ? 'error' : 'warning';

  const pitchBySection = new Map(
    scene.sections.map((s) => [s.id, s.seatPitch ?? 26] as const),
  );

  // Spatial hash for overlap detection (same-level only)
  const cellSize = 12;
  const grid = new Map<string, number[]>();
  const key = (x: number, y: number) => `${Math.floor(x / cellSize)}:${Math.floor(y / cellSize)}`;

  seats.forEach((s, i) => {
    const k = key(s.x, s.y);
    const arr = grid.get(k) ?? [];
    arr.push(i);
    grid.set(k, arr);
  });

  const reported = new Set<string>();
  for (let i = 0; i < seats.length; i++) {
    const a = seats[i];
    const minDist = (pitchBySection.get(a.sectionId) ?? 26) * 0.55;
    const cx = Math.floor(a.x / cellSize);
    const cy = Math.floor(a.y / cellSize);
    for (let dx = -1; dx <= 1; dx++) {
      for (let dy = -1; dy <= 1; dy++) {
        const neighbors = grid.get(`${cx + dx}:${cy + dy}`) ?? [];
        for (const j of neighbors) {
          if (j <= i) continue;
          const b = seats[j];
          // Stacked plan seats on different floors are not overlaps
          if (a.levelId && b.levelId && a.levelId !== b.levelId) continue;
          const dist = Math.hypot(a.x - b.x, a.y - b.y);
          if (dist < minDist) {
            const pair = [a.id, b.id].sort().join('|');
            if (reported.has(pair)) continue;
            reported.add(pair);
            issues.push({
              code: 'overlap',
              severity: overlapSeverity,
              seatIds: [a.id, b.id],
              sectionIds: [a.sectionId],
              message: `${a.sectionName}: las butacas ${a.label} y ${b.label} se pisan (separación ${dist.toFixed(1)}, mínima ${minDist.toFixed(1)})`,
              hint: 'Sube el paso entre butacas de la zona o mueve una de las dos; dos butacas en el mismo sitio se venden dos veces.',
            });
          }
        }
      }
    }
  }

  for (const sec of sections) {
    const shape: SeatMapShape | undefined = sec.shape;
    if (!shape?.points?.length) continue;
    for (const seat of seats.filter((s) => s.sectionId === sec.id)) {
      if (!pointInPolygon(seat.x, seat.y, shape.points)) {
        issues.push({
          code: 'outside_shape',
          severity: 'warning',
          seatIds: [seat.id],
          message: `Asiento ${seat.label} fuera del contorno de ${sec.name}`,
        });
      }
    }
  }

  for (const seat of seats) {
    if (!seat.position || ![seat.position.x, seat.position.y, seat.position.z].every(Number.isFinite)) {
      issues.push({
        code: 'missing_position',
        severity: 'error',
        seatIds: [seat.id],
        sectionIds: [seat.sectionId],
        message: `${seat.sectionName}: la butaca ${seat.label} no tiene posición 3D válida`,
        hint: 'Regenera la zona desde sus bloques o coloca la butaca a mano; sin posición no se puede dibujar ni calcular visibilidad.',
      });
    }
  }

  /* ── Integridad del inventario ──────────────────────────────────────────
   * Lo que rompe la operación en puerta no suele ser la geometría, sino la
   * identidad: dos butacas con el mismo id, una fila sin letra, una zona
   * declarada que no tiene butacas. Nada de esto se comprobaba.
   */

  // Ids duplicados: el guardado del API haría upsert de una sobre la otra.
  const idCounts = new Map<string, number>();
  for (const seat of seats) idCounts.set(seat.id, (idCounts.get(seat.id) ?? 0) + 1);
  const dupIds = [...idCounts.entries()].filter(([, n]) => n > 1);
  for (const [id, n] of dupIds.slice(0, MAX_ISSUES_PER_CODE)) {
    issues.push({
      code: 'duplicate_seat_id',
      severity: 'error',
      seatIds: [id],
      count: n,
      message: `El id de butaca "${id}" aparece ${n} veces`,
      hint: 'Regenera la zona: al guardar, el API hace upsert por id y una de las butacas desaparecería del inventario.',
    });
  }
  if (dupIds.length > MAX_ISSUES_PER_CODE) {
    issues.push({
      code: 'duplicate_seat_id',
      severity: 'error',
      seatIds: [],
      count: dupIds.length - MAX_ISSUES_PER_CODE,
      message: `…y ${dupIds.length - MAX_ISSUES_PER_CODE} ids de butaca duplicados más`,
      hint: 'Regenera las zonas afectadas desde sus bloques.',
    });
  }

  // Etiquetas repetidas dentro de una misma zona: el acomodador no sabe cuál es.
  const labelKeys = new Map<string, number>();
  for (const seat of seats) {
    const key = `${seat.sectionId}|${seat.label}`;
    labelKeys.set(key, (labelKeys.get(key) ?? 0) + 1);
  }
  const dupLabels = [...labelKeys.entries()].filter(([, n]) => n > 1);
  for (const [key, n] of dupLabels.slice(0, MAX_ISSUES_PER_CODE)) {
    const [sectionId, label] = key.split('|');
    const sec = scene.sections.find((s) => s.id === sectionId);
    issues.push({
      code: 'duplicate_seat_label',
      severity: 'error',
      seatIds: [],
      sectionIds: [sectionId],
      count: n,
      message: `${sec?.name ?? sectionId}: la etiqueta "${label}" está en ${n} butacas`,
      hint: 'Aplica una convención de numeración a la zona: dos butacas con la misma etiqueta son dos personas en el mismo asiento.',
    });
  }
  if (dupLabels.length > MAX_ISSUES_PER_CODE) {
    issues.push({
      code: 'duplicate_seat_label',
      severity: 'error',
      seatIds: [],
      count: dupLabels.length - MAX_ISSUES_PER_CODE,
      message: `…y ${dupLabels.length - MAX_ISSUES_PER_CODE} etiquetas duplicadas más`,
      hint: 'Renumera las zonas afectadas con la convención del recinto.',
    });
  }

  // Butacas sin etiqueta de fila, agrupadas por zona.
  const noRowBySection = new Map<string, string[]>();
  for (const seat of seats) {
    if (seat.row && String(seat.row).trim()) continue;
    const arr = noRowBySection.get(seat.sectionId) ?? [];
    arr.push(seat.id);
    noRowBySection.set(seat.sectionId, arr);
  }
  for (const [sectionId, seatIds] of noRowBySection) {
    const sec = scene.sections.find((s) => s.id === sectionId);
    issues.push({
      code: 'missing_row_label',
      severity: 'warning',
      seatIds: seatIds.slice(0, 50),
      sectionIds: [sectionId],
      count: seatIds.length,
      message: `${sec?.name ?? sectionId}: ${seatIds.length} butaca(s) sin etiqueta de fila`,
      hint: 'Asigna fila desde la convención de numeración; sin fila el boleto solo lleva número y el acomodador no puede ubicarla.',
    });
  }

  // Zonas declaradas sin butacas (salvo zonas GA, que sí pueden ir sin asientos).
  for (const sec of sections) {
    if (sec.seatIds.length > 0) continue;
    const isGaZone = Boolean(sec.shape?.points?.length);
    issues.push({
      code: 'empty_section',
      severity: isGaZone ? 'warning' : 'error',
      seatIds: [],
      sectionIds: [sec.id],
      message: isGaZone
        ? `${sec.name}: zona de admisión general sin butacas numeradas`
        : `${sec.name}: zona sin ninguna butaca`,
      hint: isGaZone
        ? 'Correcto si se vende por aforo; si debía tener butacas, rellénala con la herramienta de relleno.'
        : 'Añade butacas o elimina la zona: al publicar generaría una oferta sin inventario.',
    });
  }

  // Zonas con id o slug repetido.
  const secIdCounts = new Map<string, number>();
  const secSlugCounts = new Map<string, number>();
  for (const sec of scene.map.sections) {
    secIdCounts.set(sec.id, (secIdCounts.get(sec.id) ?? 0) + 1);
    secSlugCounts.set(sec.slug, (secSlugCounts.get(sec.slug) ?? 0) + 1);
  }
  for (const [id, n] of secIdCounts) {
    if (n < 2) continue;
    issues.push({
      code: 'duplicate_section',
      severity: 'error',
      seatIds: [],
      sectionIds: [id],
      count: n,
      message: `El id de zona "${id}" aparece ${n} veces`,
      hint: 'Renombra una de las zonas: el API sincroniza por id y borraría las butacas de la otra.',
    });
  }
  for (const [slug, n] of secSlugCounts) {
    if (n < 2) continue;
    issues.push({
      code: 'duplicate_section',
      severity: 'error',
      seatIds: [],
      count: n,
      message: `El slug de zona "${slug}" aparece ${n} veces`,
      hint: 'El slug es la clave de la oferta de precio (única por evento): dos zonas con el mismo slug comparten precio y aforo.',
    });
  }

  // Saltos de numeración dentro de una fila.
  const rowGroups = new Map<string, number[]>();
  for (const seat of seats) {
    if (!seat.row) continue;
    const n = Number(String(seat.label).match(/(\d+)\s*$/)?.[1]);
    if (!Number.isFinite(n)) continue;
    const key = `${seat.sectionId}|${seat.row}`;
    const arr = rowGroups.get(key) ?? [];
    arr.push(n);
    rowGroups.set(key, arr);
  }
  let gapCount = 0;
  for (const [key, numbers] of rowGroups) {
    if (numbers.length < 3) continue;
    numbers.sort((a, b) => a - b);
    const span = numbers[numbers.length - 1] - numbers[0] + 1;
    // Las convenciones de pares/impares dejan huecos legítimos de 1 en 1.
    const isParityRun = numbers.every((n, i) => i === 0 || n - numbers[i - 1] === 2);
    if (span === numbers.length || isParityRun) continue;
    gapCount++;
    if (gapCount > MAX_ISSUES_PER_CODE) continue;
    const [sectionId, row] = key.split('|');
    const sec = scene.sections.find((s) => s.id === sectionId);
    const missing: number[] = [];
    for (let n = numbers[0]; n <= numbers[numbers.length - 1] && missing.length < 6; n++) {
      if (!numbers.includes(n)) missing.push(n);
    }
    issues.push({
      code: 'row_numbering_gap',
      severity: 'warning',
      seatIds: [],
      sectionIds: [sectionId],
      count: span - numbers.length,
      message: `${sec?.name ?? sectionId}, fila ${row}: faltan los números ${missing.join(', ')}${span - numbers.length > missing.length ? '…' : ''}`,
      hint: 'Normal si ahí hay un pasillo o una plaza accesible; revisa que el hueco sea intencionado.',
    });
  }

  // Aforo declarado frente a butacas reales.
  if (options?.declaredCapacity != null && !levelId) {
    const actual = scene.seats.length;
    const declared = options.declaredCapacity;
    if (declared !== actual) {
      const diff = actual - declared;
      issues.push({
        code: 'capacity_mismatch',
        severity: 'error',
        seatIds: [],
        count: Math.abs(diff),
        message: `El aforo declarado (${declared.toLocaleString('es-MX')}) no coincide con las butacas del mapa (${actual.toLocaleString('es-MX')}): ${diff > 0 ? 'sobran' : 'faltan'} ${Math.abs(diff).toLocaleString('es-MX')}`,
        hint:
          diff > 0
            ? 'Ajusta el aforo declarado o elimina butacas: publicar así vende más asientos de los autorizados.'
            : 'Ajusta el aforo declarado o completa el mapa: se quedarían butacas sin poner a la venta.',
      });
    }
  }

  /* ── Accesibilidad (requisito legal) ─────────────────────────────────── */
  if (!options?.skipAccessibility && !levelId) {
    const access = auditAccessibility(scene.map);
    if (access.wheelchairSpaces < access.requiredWheelchairSpaces) {
      issues.push({
        code: 'accessible_shortfall',
        severity: 'warning',
        seatIds: [],
        count: access.requiredWheelchairSpaces - access.wheelchairSpaces,
        message: `Plazas de silla de ruedas: ${access.wheelchairSpaces} de las ${access.requiredWheelchairSpaces} exigidas para un aforo de ${access.capacity.toLocaleString('es-MX')}`,
        hint: 'Marca butacas como plaza accesible desde el panel de selección; es requisito legal, no una recomendación.',
      });
    }
    for (const id of access.wheelchairWithoutCompanion.slice(0, MAX_ISSUES_PER_CODE)) {
      issues.push({
        code: 'accessible_no_companion',
        severity: 'warning',
        seatIds: [id],
        message: `La plaza accesible ${id} no tiene butaca de acompañante`,
        hint: 'Selecciona la butaca contigua y márcala como acompañante.',
      });
    }
    for (const id of access.orphanCompanions.slice(0, MAX_ISSUES_PER_CODE)) {
      issues.push({
        code: 'accessible_orphan_companion',
        severity: 'warning',
        seatIds: [id],
        message: `La butaca de acompañante ${id} apunta a una plaza que ya no existe`,
        hint: 'Vuelve a ligarla a una plaza accesible o quítale la marca.',
      });
    }
  }

  const circulation = analyzeCirculation(scene);
  if (circulation.hasNetwork && circulation.unreachableSections.length) {
    for (const sectionId of circulation.unreachableSections) {
      if (!sectionIds.has(sectionId)) continue;
      const sec = scene.sections.find((s) => s.id === sectionId);
      issues.push({
        code: 'unreachable_section',
        severity: 'warning',
        seatIds: [],
        sectionIds: [sectionId],
        message: `Sección ${sec?.name ?? sectionId} sin ruta a salida (pasillo/escalera/exit)`,
      });
    }
  }

  // Venue-wide exit/clearance warnings only when not level-scoped
  if (!levelId && circulation.hasNetwork && circulation.seedMode === 'stage') {
    issues.push({
      code: 'no_exits',
      severity: 'warning',
      seatIds: [],
      sectionIds: [],
      message:
        'Sin salidas autoradas: el análisis mide acceso al escenario. Coloca salidas (tool Salida) para egress real.',
    });
  }

  const policy = resolveEgressPolicy(scene.map.venue?.egressPolicy);
  if (circulation.hasNetwork) {
    for (const secEg of circulation.egress.sections) {
      if (!sectionIds.has(secEg.sectionId)) continue;
      if (secEg.pathLength != null && secEg.pathLength > policy.longPathUnits) {
        issues.push({
          code: 'long_egress',
          severity: 'warning',
          seatIds: [],
          sectionIds: [secEg.sectionId],
          message: `Sección ${secEg.sectionName ?? secEg.sectionId}: ruta de salida larga (${Math.round(secEg.pathLength)}u)`,
        });
      }
    }
    if (!levelId) {
      for (const bn of circulation.egress.bottlenecks.slice(0, 3)) {
        if (
          bn.overCapacity ||
          (bn.utilization >= policy.bottleneckUtilization && bn.sectionCount >= 2)
        ) {
          issues.push({
            code: 'egress_bottleneck',
            severity: 'warning',
            seatIds: [],
            message: `Cuello de botella en ${bn.kind}: carga ${bn.seatLoad}/${bn.capacity} (${Math.round(bn.utilization * 100)}%, ancho ${bn.width}u, ~${bn.clearanceMinutes.toFixed(1)} min)`,
          });
        } else if (bn.seatLoad >= policy.bottleneckSeatLoad && bn.sectionCount >= 2) {
          issues.push({
            code: 'egress_bottleneck',
            severity: 'warning',
            seatIds: [],
            message: `Cuello de botella en ${bn.kind}: ~${bn.seatLoad} asientos / ${bn.sectionCount} secciones`,
          });
        }
      }
      if (
        circulation.egress.clearanceMinutes != null &&
        circulation.egress.clearanceMinutes > policy.slowClearanceMinutes
      ) {
        issues.push({
          code: 'slow_clearance',
          severity: 'warning',
          seatIds: [],
          message: `Vaciado estimado ~${circulation.egress.clearanceMinutes.toFixed(1)} min (umbral ${policy.slowClearanceMinutes} min)`,
        });
      }
    }
  }

  // Resumen por código: permite priorizar sin recorrer cientos de avisos.
  const byCode = new Map<GeometryIssueCode, { severity: 'warning' | 'error'; count: number }>();
  for (const issue of issues) {
    const prev = byCode.get(issue.code);
    const add = issue.count ?? 1;
    if (prev) {
      prev.count += add;
      if (issue.severity === 'error') prev.severity = 'error';
    } else {
      byCode.set(issue.code, { severity: issue.severity, count: add });
    }
  }
  const summary = [...byCode.entries()]
    .map(([code, v]) => ({ code, severity: v.severity, count: v.count }))
    // Errores primero, y dentro de cada grupo lo más numeroso arriba.
    .sort((a, b) =>
      a.severity === b.severity ? b.count - a.count : a.severity === 'error' ? -1 : 1,
    );

  return {
    ok: !issues.some((i) => i.severity === 'error'),
    issues,
    summary,
  };
}
