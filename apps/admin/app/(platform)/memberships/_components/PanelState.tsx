'use client';

import { createPanelState } from '@boletera/ui';
import { isMembershipsUnavailable, membershipsErrorMessage } from '../_lib/status';

/**
 * Estados del panel de membresías.
 *
 * La implementación vive en `@boletera/ui`: estaba copiada en cuatro secciones
 * con 570 líneas entre todas. Aquí queda solo lo que de verdad cambia entre
 * secciones — cómo se reconoce un servicio no conectado y qué se le dice al
 * usuario cuando pasa.
 */
export const { PanelSkeleton, PanelUnavailable, PanelError, PanelEmpty, PanelState } =
  createPanelState({
    isUnavailable: isMembershipsUnavailable,
    errorMessage: membershipsErrorMessage,
    unavailableTitle: 'API de membresías no conectada',
    unavailableDescription:
      'Este panel consulta contratos reales de /memberships. Mientras no exista respuesta, no se muestran cifras inventadas.',
    unavailableHints: [
      'GET /memberships/organization/:orgId/plans',
      'GET /memberships/organization/:orgId/metrics',
    ],
  });
