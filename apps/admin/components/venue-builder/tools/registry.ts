import type { ToolId } from '../store/types';
import { createAnnotateTool, createMeasureTool } from './annotate-tools';
import { createDrawRowTool, createDrawSeatTool, createDrawSectionTool } from './draw-tools';
import { createPanTool, createZoomTool } from './navigate-tools';
import { createPlaceFurnitureTool, createPlaceStageTool } from './place-tools';
import { createSelectTool } from './select-tool';
import type { Tool } from './types';

export function createToolRegistry(): Record<ToolId, Tool> {
  return {
    select: createSelectTool(),
    pan: createPanTool(),
    zoom: createZoomTool(),
    'draw-section': createDrawSectionTool(),
    'draw-row': createDrawRowTool(),
    'draw-seat': createDrawSeatTool(),
    'place-furniture': createPlaceFurnitureTool(),
    'place-stage': createPlaceStageTool(),
    measure: createMeasureTool(),
    annotate: createAnnotateTool(),
  };
}

export const TOOL_ORDER: ToolId[] = [
  'select',
  'pan',
  'zoom',
  'draw-section',
  'draw-row',
  'draw-seat',
  'place-furniture',
  'place-stage',
  'measure',
  'annotate',
];
