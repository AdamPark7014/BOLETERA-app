'use client';

import { createContext, useContext, type ReactNode } from 'react';
import type { Density } from '../../styles/tokens';

const DensityContext = createContext<Density>('compra');

/** Densidad explícita del control, o la del `BlackTicketRoot` más cercano. */
export function useTicketDensity(explicit?: Density): Density {
  const fromTree = useContext(DensityContext);
  return explicit ?? fromTree;
}

export interface BlackTicketRootProps {
  /** Compra, taquilla o admin. Cambia ritmo y alto, no la paleta. */
  density: Density;
  className?: string;
  children: ReactNode;
}

/**
 * Lienzo del tema oscuro único. Pone `data-black-ticket` y `data-density`.
 * Las pantallas lo montan cuando pasen al lenguaje nuevo; no reemplaza el
 * layout que ya está en producción.
 */
export function BlackTicketRoot({ density, className, children }: BlackTicketRootProps) {
  return (
    <DensityContext.Provider value={density}>
      <div data-black-ticket="" data-density={density} className={className}>
        {children}
      </div>
    </DensityContext.Provider>
  );
}
