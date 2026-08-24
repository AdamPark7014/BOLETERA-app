'use client';

import { createPanelState } from '@boletera/ui';
import { aiErrorMessage, isAiServiceUnavailable } from '../_lib/status';

/**
 * Estados del panel de IA. La implementación vive en `@boletera/ui`; aquí solo
 * el adaptador de esta sección.
 *
 * El texto de «no conectado» es deliberadamente explícito: sin endpoint activo
 * se muestra un vacío honesto, nunca predicciones inventadas para que la
 * pantalla parezca llena.
 */
export const { PanelSkeleton, PanelUnavailable, PanelError, PanelEmpty, PanelState } =
  createPanelState({
    isUnavailable: isAiServiceUnavailable,
    errorMessage: aiErrorMessage,
    unavailableTitle: 'Motor de IA no conectado',
    unavailableDescription:
      'Este panel consulta un endpoint del ai-engine. Mientras no exista respuesta, no se muestran predicciones ni resúmenes inventados.',
    unavailableHints: [
      'Contratos: packages/shared/src/ai-contracts.ts',
      'Sin endpoint activo = empty state honesto',
    ],
    // Las tarjetas de IA son más altas; con dos renglones el esqueleto se queda
    // corto y el contenido salta al llegar.
    skeletonLines: 3,
  });
