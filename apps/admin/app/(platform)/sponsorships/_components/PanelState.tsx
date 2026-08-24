'use client';

import { createPanelState } from '@boletera/ui';
import { isSponsorshipsUnavailable, sponsorshipsErrorMessage } from '../_lib/status';

/**
 * Estados del panel de patrocinios. La implementación vive en `@boletera/ui`;
 * aquí solo el adaptador de esta sección.
 */
export const { PanelSkeleton, PanelUnavailable, PanelError, PanelEmpty, PanelState } =
  createPanelState({
    isUnavailable: isSponsorshipsUnavailable,
    errorMessage: sponsorshipsErrorMessage,
    unavailableTitle: 'API de patrocinios no conectada',
    unavailableDescription:
      'Este panel consulta /sponsorships. Sin respuesta no se inventan contratos, assets ni ROI.',
    unavailableHints: [
      'GET /sponsorships/organization/:orgId/packages',
      'GET /sponsorships/organization/:orgId/assets',
    ],
  });
