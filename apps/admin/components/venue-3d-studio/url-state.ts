import type { Venue3DHeatMode } from '@boletera/venue-3d';
import {
  colorModeToHeat,
  type CameraPreset,
  type StudioColorMode,
  type StudioUrlState,
} from './types';

const COLOR_MODES: readonly StudioColorMode[] = [
  'zone',
  'tier',
  'price',
  'status',
  'sightline',
];

const CAMERAS: readonly CameraPreset[] = ['orbit', 'plan', 'side', 'stage', 'seat'];

const HEATS: readonly Venue3DHeatMode[] = ['off', 'price', 'view'];

function parseColorMode(raw: string | null): StudioColorMode {
  if (raw && (COLOR_MODES as readonly string[]).includes(raw)) {
    return raw as StudioColorMode;
  }
  return 'zone';
}

function parseCamera(raw: string | null): CameraPreset {
  if (raw && (CAMERAS as readonly string[]).includes(raw)) {
    return raw as CameraPreset;
  }
  return 'orbit';
}

function parseHeat(raw: string | null, colorMode: StudioColorMode): Venue3DHeatMode {
  if (raw && (HEATS as readonly string[]).includes(raw)) {
    return raw as Venue3DHeatMode;
  }
  return colorModeToHeat(colorMode);
}

export function readStudioUrlState(search: URLSearchParams): StudioUrlState {
  const colorMode = parseColorMode(search.get('color'));
  return {
    studio: search.get('studio') === '1',
    seatId: search.get('seat'),
    colorMode,
    levelId: search.get('level') || 'ALL',
    camera: parseCamera(search.get('cam')),
    heat: parseHeat(search.get('heat'), colorMode),
  };
}

export function buildStudioSearchParams(state: {
  studio: boolean;
  seatId: string | null;
  colorMode: StudioColorMode;
  levelId: string | 'ALL';
  camera: CameraPreset;
  heat: Venue3DHeatMode;
}): string {
  const params = new URLSearchParams();
  if (state.studio) params.set('studio', '1');
  if (state.seatId) params.set('seat', state.seatId);
  if (state.colorMode !== 'zone') params.set('color', state.colorMode);
  if (state.levelId !== 'ALL') params.set('level', state.levelId);
  if (state.camera !== 'orbit') params.set('cam', state.camera);
  const impliedHeat = colorModeToHeat(state.colorMode);
  if (state.heat !== impliedHeat) params.set('heat', state.heat);
  const qs = params.toString();
  return qs ? `?${qs}` : '';
}

/** Enlace al editor 2D conservando asiento, nivel y modo de color. */
export function buildMapEditorHref(
  venueId: string,
  state: {
    seatId: string | null;
    colorMode: StudioColorMode;
    levelId: string | 'ALL';
  },
): string {
  const params = new URLSearchParams();
  params.set('from', '3d');
  if (state.seatId) params.set('seat', state.seatId);
  if (state.colorMode !== 'zone') params.set('color', state.colorMode);
  if (state.levelId !== 'ALL') params.set('level', state.levelId);
  return `/venues/${venueId}/map?${params.toString()}`;
}

export function buildStudioHref(
  venueId: string,
  state: {
    studio?: boolean;
    seatId?: string | null;
    colorMode?: StudioColorMode;
    levelId?: string | 'ALL';
    camera?: CameraPreset;
  },
): string {
  return `/venues/${venueId}/3d${buildStudioSearchParams({
    studio: state.studio ?? true,
    seatId: state.seatId ?? null,
    colorMode: state.colorMode ?? 'zone',
    levelId: state.levelId ?? 'ALL',
    camera: state.camera ?? 'orbit',
    heat: colorModeToHeat(state.colorMode ?? 'zone'),
  })}`;
}
