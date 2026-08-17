import type { SightlineGrade, SightlineScore } from '@boletera/venue-engine';
import type { Seat3D, Venue3DHeatMode } from '@boletera/venue-3d';

/** Alineado con ColorMode del editor 2D (`@boletera/venue-engine/render`). */
export type StudioColorMode = 'zone' | 'tier' | 'price' | 'status' | 'sightline';

export type CameraPreset = 'orbit' | 'plan' | 'side' | 'stage' | 'seat';

export type StudioQuality = 'high' | 'balanced' | 'low';

export type LayerVisibility = {
  levels: Record<string, boolean>;
  sections: boolean;
  furniture: boolean;
  structure: boolean;
  aisles: boolean;
  obstacles: boolean;
  exits: boolean;
  opacity: {
    seats: number;
    furniture: number;
    structure: number;
  };
};

export type StageDraft = {
  x: number;
  y: number;
  width: number;
  rotation: number;
  elevation: number;
};

export type StudioSeat = Seat3D & {
  sectionId?: string;
  tier?: string;
  price?: number;
};

export type SelectedSeatInfo = {
  seat: StudioSeat;
  world: { x: number; y: number; z: number };
  sightline: SightlineScore | null;
};

export type SightlineSummary = Record<SightlineGrade, number>;

export type StudioUrlState = {
  studio: boolean;
  seatId: string | null;
  colorMode: StudioColorMode;
  levelId: string | 'ALL';
  camera: CameraPreset;
  heat: Venue3DHeatMode;
};

export const COLOR_MODE_LABELS: Record<StudioColorMode, string> = {
  zone: 'Zona',
  tier: 'Precio (tier)',
  price: 'Precio',
  status: 'Estado de venta',
  sightline: 'Visibilidad',
};

export const CAMERA_PRESET_LABELS: Record<CameraPreset, string> = {
  orbit: 'Órbita libre',
  plan: 'Planta',
  side: 'Lateral',
  stage: 'Escenario',
  seat: 'Desde el asiento',
};

export const GRADE_LABELS: Record<SightlineGrade, string> = {
  premium: 'Premium',
  good: 'Buena',
  fair: 'Aceptable',
  restricted: 'Restringida',
  blocked: 'Obstruida',
};

export function defaultLayerVisibility(levelIds: string[]): LayerVisibility {
  const levels: Record<string, boolean> = {};
  for (const id of levelIds) levels[id] = true;
  return {
    levels,
    sections: true,
    furniture: true,
    structure: true,
    aisles: true,
    obstacles: true,
    exits: true,
    opacity: {
      seats: 1,
      furniture: 1,
      structure: 1,
    },
  };
}

export function colorModeToHeat(mode: StudioColorMode): Venue3DHeatMode {
  if (mode === 'price') return 'price';
  if (mode === 'sightline') return 'view';
  return 'off';
}
