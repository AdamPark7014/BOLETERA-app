/**
 * Calidad de vista 0–100 y pose de cámara por butaca (mapa 3D).
 * Determinista: distancia al escenario, ángulo de frente, altura y obstrucciones.
 */

export type ViewQualityLabel = 'excelente' | 'buena' | 'lateral' | 'lejana';

export type ViewQualityResult = {
  score: number;
  label: ViewQualityLabel;
  distance: number;
  angleDeg: number;
  elevation: number;
  occluded: boolean;
};

export type SeatCameraPose = {
  position: { x: number; y: number; z: number };
  lookAt: { x: number; y: number; z: number };
  fov: number;
};

export type ComputeViewQualityInput = {
  seat: { x: number; y: number; elevation?: number; rotationDeg?: number };
  stage: { x: number; y: number; elevation?: number };
  maxDistance?: number;
  occluded?: boolean;
  restrictedView?: boolean;
  blocked?: boolean;
};

function clamp01(n: number) {
  return Math.max(0, Math.min(1, n));
}

/** excelente ≥80 · buena ≥60 · lateral ≥40 · lejana. */
export function viewScoreToLabel(score: number): ViewQualityLabel {
  const s = Math.max(0, Math.min(100, score));
  if (s >= 80) return 'excelente';
  if (s >= 60) return 'buena';
  if (s >= 40) return 'lateral';
  return 'lejana';
}

export function labelInSpanish(label: ViewQualityLabel): string {
  switch (label) {
    case 'excelente':
      return 'Vista excelente';
    case 'buena':
      return 'Vista buena';
    case 'lateral':
      return 'Vista lateral';
    default:
      return 'Vista lejana';
  }
}

/**
 * Puntaje 0–100. `rotationDeg` 0 mira hacia −Y en planta (mismo convenio que sightlines).
 */
export function computeViewQuality(input: ComputeViewQualityInput): ViewQualityResult {
  const { seat, stage } = input;
  const occluded = Boolean(input.occluded);
  const restrictedView = Boolean(input.restrictedView);
  const blocked = Boolean(input.blocked);

  const dx = stage.x - seat.x;
  const dy = stage.y - seat.y;
  const distance = Math.hypot(dx, dy);
  const maxDistance = Math.max(1, input.maxDistance ?? Math.max(distance * 1.5, 1));
  const distScore = 1 - clamp01(distance / maxDistance);

  const yaw = ((seat.rotationDeg ?? 0) * Math.PI) / 180;
  const faceX = Math.sin(yaw);
  const faceY = -Math.cos(yaw);
  const toLen = distance || 1;
  const facingDot = (faceX * dx + faceY * dy) / toLen;
  const facingScore = clamp01((facingDot + 1) / 2);
  const angleDeg = Math.round((Math.acos(clamp01((facingDot + 1) / 2) * 2 - 1) * 180) / Math.PI);

  const elevation = seat.elevation ?? 0;
  const elevationBonus = clamp01(elevation / 120) * 0.15;

  let unit = clamp01(distScore * 0.4 + facingScore * 0.35 + elevationBonus);
  if (blocked) unit = 0;
  else if (occluded) unit *= 0.35;

  let score = Math.round(unit * 100);
  if (!blocked && restrictedView) score -= 15;
  score = Math.max(0, Math.min(100, score));
  if (blocked) score = 0;

  return {
    score,
    label: viewScoreToLabel(score),
    distance: Math.round(distance * 10) / 10,
    angleDeg,
    elevation,
    occluded: occluded || blocked,
  };
}

/** Cámara a altura de ojos mirando al escenario (FOV humano ~55°). */
export function seatCameraPose(
  seatWorld: { px: number; py: number; pz: number; rotY?: number },
  stageWorld: { x: number; y: number; z: number },
  opts?: { eyeHeight?: number; fov?: number }
): SeatCameraPose {
  const eyeHeight = opts?.eyeHeight ?? 1.2;
  return {
    position: {
      x: seatWorld.px,
      y: seatWorld.py + eyeHeight,
      z: seatWorld.pz,
    },
    lookAt: {
      x: stageWorld.x,
      y: stageWorld.y,
      z: stageWorld.z,
    },
    fov: opts?.fov ?? 55,
  };
}

/** Mejor butaca por puntaje; empate → seatId con localeCompare. */
export function bestSeatIdByView(
  scores: Array<{ seatId: string; score: number }>
): string | null {
  if (!scores.length) return null;
  let best = scores[0]!;
  for (let i = 1; i < scores.length; i++) {
    const cur = scores[i]!;
    if (cur.score > best.score) {
      best = cur;
      continue;
    }
    if (cur.score === best.score && cur.seatId.localeCompare(best.seatId) < 0) {
      best = cur;
    }
  }
  return best.seatId;
}
