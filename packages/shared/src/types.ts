import type { UserRoleValue } from './enums';
import type { CurrencyCode } from './money';

export interface SeatMapData {
  /** 3 = spatial engine (position/elevation/blocks); 2 = bbox + normalized ids; 1/undefined = legacy */
  version?: 1 | 2 | 3;
  sections: SeatMapSection[];
  viewport?: {
    width: number;
    height: number;
    minX?: number;
    minY?: number;
  };
  venue?: SeatMapVenueMeta;
}

export interface SeatMapVenueMeta {
  stage?: SeatMapStage;
  furniture?: SeatMapFurniture[];
  levels?: SeatMapLevel[];
  aisles?: SeatMapAisle[];
  obstacles?: SeatMapObstacle[];
  stairs?: SeatMapStair[];
  /** Authored emergency / public exits (egress seeds). Prefer over stage for path analysis. */
  exits?: SeatMapExit[];
  /** Coordinate units for authored geometry */
  units?: 'map' | 'meters';
  /** Map units per meter when units === 'map' (e.g. 40 = 40 map units ≈ 1m) */
  scale?: number;
  /** Editor/CAD snap pitch in map units */
  snapPitch?: number;
  /** CAD locks / constraints for the editor */
  cadLocks?: SeatMapCadLocks;
  /**
   * Optional look-at targets for sightlines (e.g. left/center/right of stage).
   * When empty, the stage center is used.
   */
  focusPoints?: SeatMapFocusPoint[];
  /** Egress validation / analysis policy (thresholds) */
  egressPolicy?: SeatMapEgressPolicy;
}

/** Soft CAD constraints persisted with the map */
export interface SeatMapCadLocks {
  aisles?: boolean;
  obstacles?: boolean;
  stairs?: boolean;
  stage?: boolean;
  furniture?: boolean;
  exits?: boolean;
  /** Sightline focus points (CAD / editor) */
  focusPoints?: boolean;
  /**
   * When true, seat overlaps are errors and save should be blocked.
   * Default (false) keeps overlaps as warnings.
   */
  strictOverlaps?: boolean;
}

/** Thresholds for circulation / egress analysis */
export interface SeatMapEgressPolicy {
  /** Path length (map units) above which validate warns. Default 900 */
  longPathUnits?: number;
  /** Clearance minutes above which validate warns. Default 8 */
  slowClearanceMinutes?: number;
  /** Utilization (0–1) at which shared corridors warn. Default 0.85 */
  bottleneckUtilization?: number;
  /** Absolute seat load on shared edges that warns. Default 120 */
  bottleneckSeatLoad?: number;
}

/** Sightline look-at target in map space */
export interface SeatMapFocusPoint {
  id: string;
  label?: string;
  x: number;
  y: number;
  /** Target elevation (same units as seat elevation) */
  z?: number;
  /** Architectural level (orchestra, balcony, …); untagged = all levels */
  levelId?: string;
}

export interface SeatMapLevel {
  id: string;
  name: string;
  elevation: number;
  zIndex: number;
}

export interface SeatMapAisle {
  id: string;
  points: [number, number][];
  /** Corridor clear width in map units (default ~24 ≈ 0.6m at scale 40) */
  width?: number;
  /** Level this aisle belongs to (avoids false cross-level proximity joins) */
  levelId?: string;
}

export interface SeatMapObstacle {
  id: string;
  type: string;
  points: [number, number][];
  height?: number;
  /** Level this obstacle belongs to (multi-level visibility / CAD) */
  levelId?: string;
}

export interface SeatMapStair {
  id: string;
  /** stairs | vomitoria | ramp */
  kind?: 'stairs' | 'vomitoria' | 'ramp';
  points: [number, number][];
  fromLevelId?: string;
  toLevelId?: string;
  width?: number;
}

/** Emergency / public exit used as egress destination (seed for shortest paths). */
export interface SeatMapExit {
  id: string;
  /**
   * Door point (length 1) or short mouth polyline (length ≥ 2).
   * Analysis places circulation nodes on each point.
   */
  points: [number, number][];
  label?: string;
  /** Clear width in map units (default ~32) */
  width?: number;
  levelId?: string;
}

export interface SeatMapStage {
  x: number;
  y: number;
  width: number;
  rotation?: number;
  elevation?: number;
}

export interface SeatMapFurniture {
  id: string;
  type: 'led' | 'speaker' | 'door';
  x: number;
  y: number;
  rotation?: number;
  /** Level this furniture belongs to (multi-level visibility / CAD) */
  levelId?: string;
}

export interface SeatMapShape {
  points: [number, number][];
}

export interface SeatMapBlock {
  id: string;
  label?: string;
  /** Origin of first seat in first row (map space) */
  origin: { x: number; y: number };
  rows: number;
  seatsPerRow: number;
  seatPitch: number;
  rowPitch: number;
  /** Elevation gain per row (map/world units) */
  rake?: number;
  /** 0 = straight; >0 curves toward stage (radius bias) */
  curvature?: number;
  /** Yaw of the block in degrees */
  yaw?: number;
  /** Base elevation of front row */
  elevation?: number;
  startRowLabel?: string;
  tier?: string;
  /** Column indices to leave empty (center aisles, vomitoria gaps) */
  skipColumns?: number[];
}

export interface SeatMapSection {
  id: string;
  name: string;
  slug: string;
  color: string;
  seats: SeatMapSeat[];
  /** Optional hand-drawn zone outline (e.g. GA pits); auto-hull is used when absent. */
  shape?: SeatMapShape;
  /** Parametric seating blocks (engine may regenerate seats from these) */
  blocks?: SeatMapBlock[];
  /** Elevation gain per row when resolving without per-seat Z */
  rake?: number;
  seatPitch?: number;
  rowPitch?: number;
  curvature?: number;
  /** Architectural level id (orchestra, balcony, …) */
  levelId?: string;
  /** When true, editor refuses to move/delete seats or reshape this section */
  locked?: boolean;
}

export interface SeatVisibility {
  blocked?: boolean;
  restrictedView?: boolean;
  premiumView?: boolean;
}

export interface SeatMapSeat {
  id: string;
  label: string;
  row?: string;
  x: number;
  y: number;
  /** Yaw in degrees (2D map facing) */
  rotation?: number;
  tier?: string;
  /** Legacy authored 3D; prefer `position` when both exist */
  coord3d?: { x: number; y: number; z: number; pitch?: number; roll?: number };
  /** Canonical 3D position (map/world). x/z ≈ plan, y ≈ elevation */
  position?: { x: number; y: number; z: number };
  /** Full Euler in degrees: x=pitch, y=yaw, z=roll */
  rotation3d?: { x: number; y: number; z: number };
  elevation?: number;
  visibility?: SeatVisibility;
  /** Architectural level id */
  levelId?: string;
  metadata?: Record<string, unknown>;
}

export interface SeatMapBounds {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
}

export interface JwtPayload {
  sub: string;
  email: string;
  role: UserRoleValue | string;
  organizationId?: string;
}

export interface TenantContext {
  organizationId: string;
  slug: string;
  subdomain?: string;
}

/** Shared event identity fields used across API, admin and storefront. */
export interface EventRef {
  id: string;
  organizationId: string;
  slug: string;
  title: string;
  timezone: string;
  currency: CurrencyCode;
}

/** Shared order identity for cross-app payloads. */
export interface OrderRef {
  id: string;
  publicId: string;
  organizationId: string;
  eventId: string;
  status: string;
}
