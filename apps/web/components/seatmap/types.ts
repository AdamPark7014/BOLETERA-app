/**
 * Tipos compartidos del subsistema de mapa de butacas.
 *
 * El visor trabaja con arrays planos e índices numéricos (no con objetos por
 * butaca dentro del bucle de dibujo): con 45.000 asientos, cada búsqueda por
 * `id` dentro de un `requestAnimationFrame` cuesta frames en un móvil de gama
 * media.
 */

/** Estado de una butaca ya traducido al dominio de la UI. */
export type SeatStatus =
  | 'available'
  | 'held'
  | 'sold'
  | 'blocked'
  | 'selected'
  /** Aún no llegó la página de inventario que cubre esta butaca. */
  | 'unknown';

/** Butaca lista para pintar: todo precalculado, nada que resolver en el frame. */
export type RenderSeat = {
  id: string;
  sectionId: string;
  sectionName: string;
  levelId?: string;
  x: number;
  y: number;
  rotation: number;
  label: string;
  row?: string;
  color: string;
  /** Lugar para personas con discapacidad (requisito legal, no un extra). */
  accessible: boolean;
  blocked: boolean;
  restricted: boolean;
  premium: boolean;
  /** Precio de la oferta de su sección, resuelto una sola vez. */
  price: number;
  offerId: string;
};

/** Transformación pantalla↔mundo. Vive en un ref, nunca en estado de React. */
export type ViewTransform = {
  scale: number;
  tx: number;
  ty: number;
};

export type Bounds = {
  minX: number;
  minY: number;
  maxX: number;
  maxY: number;
  width: number;
  height: number;
};

/**
 * Estados de ticket del API (mayúsculas) → estados de UI.
 * Todo lo que no sea AVAILABLE/HELD es no vendible: lo pintamos como `sold`
 * para no prometer butacas que el backend ya no puede apartar.
 */
export function ticketStatusToSeatStatus(raw: string | null | undefined): SeatStatus {
  switch (String(raw ?? '').toUpperCase()) {
    case 'AVAILABLE':
      return 'available';
    case 'HELD':
      return 'held';
    default:
      return 'sold';
  }
}
