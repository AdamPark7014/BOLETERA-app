/**
 * Posicionamiento de capas flotantes (tooltips, popovers, menus) contra el
 * viewport. Sustituye a Floating UI con lo minimo que necesitamos: colocacion
 * en los cuatro lados, volteo cuando no cabe y desplazamiento para no salirse
 * por los bordes.
 */

import { clamp } from './scale';

/** Lado preferido de la capa flotante respecto a su ancla. */
export type Placement = 'top' | 'bottom' | 'left' | 'right';

/** Alineacion de la capa a lo largo del lado elegido. */
export type Alignment = 'start' | 'center' | 'end';

/** Medidas de un elemento, en pixeles de viewport. */
export interface Box {
  top: number;
  left: number;
  width: number;
  height: number;
}

/** Resultado del calculo: coordenadas `fixed` y el lado finalmente usado. */
export interface Position {
  top: number;
  left: number;
  placement: Placement;
}

const OPPOSITE: Record<Placement, Placement> = {
  top: 'bottom',
  bottom: 'top',
  left: 'right',
  right: 'left',
};

function fits(placement: Placement, anchor: Box, floating: Box, gap: number, padding: number): boolean {
  switch (placement) {
    case 'top':
      return anchor.top - floating.height - gap >= padding;
    case 'bottom':
      return anchor.top + anchor.height + floating.height + gap <= window.innerHeight - padding;
    case 'left':
      return anchor.left - floating.width - gap >= padding;
    case 'right':
      return anchor.left + anchor.width + floating.width + gap <= window.innerWidth - padding;
  }
}

function alignAlong(start: number, anchorSize: number, floatingSize: number, alignment: Alignment): number {
  if (alignment === 'start') return start;
  if (alignment === 'end') return start + anchorSize - floatingSize;
  return start + (anchorSize - floatingSize) / 2;
}

/**
 * Coloca `floating` junto a `anchor`, volteando al lado opuesto si no cabe y
 * recortando al viewport. Las coordenadas resultantes son para `position: fixed`.
 *
 * @param gap Separacion entre ancla y capa, en px.
 * @param padding Margen minimo respecto a los bordes del viewport, en px.
 */
export function computePosition(
  anchor: Box,
  floating: Box,
  placement: Placement,
  alignment: Alignment = 'center',
  gap = 8,
  padding = 8,
): Position {
  const resolved =
    fits(placement, anchor, floating, gap, padding) ||
    !fits(OPPOSITE[placement], anchor, floating, gap, padding)
      ? placement
      : OPPOSITE[placement];

  let top: number;
  let left: number;

  switch (resolved) {
    case 'top':
      top = anchor.top - floating.height - gap;
      left = alignAlong(anchor.left, anchor.width, floating.width, alignment);
      break;
    case 'bottom':
      top = anchor.top + anchor.height + gap;
      left = alignAlong(anchor.left, anchor.width, floating.width, alignment);
      break;
    case 'left':
      top = alignAlong(anchor.top, anchor.height, floating.height, alignment);
      left = anchor.left - floating.width - gap;
      break;
    case 'right':
      top = alignAlong(anchor.top, anchor.height, floating.height, alignment);
      left = anchor.left + anchor.width + gap;
      break;
  }

  return {
    top: clamp(top, padding, Math.max(padding, window.innerHeight - floating.height - padding)),
    left: clamp(left, padding, Math.max(padding, window.innerWidth - floating.width - padding)),
    placement: resolved,
  };
}

/** Convierte un `DOMRect` en la caja plana que consume {@link computePosition}. */
export function toBox(rect: DOMRect): Box {
  return { top: rect.top, left: rect.left, width: rect.width, height: rect.height };
}
