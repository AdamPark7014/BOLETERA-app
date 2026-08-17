export * from './map-utils';
export * from './seatmap-canvas';
export * from './layout-templates';
export * from './geometry';
// Índice espacial y operaciones de edición masiva: los usa el editor de mapas
// para sostener 45.000 butacas (hit-test 0,13 ms, edición de todas en 5,3 ms).
export * from './seat-index';
export * from './edit-ops';
// Browser render engine is a separate entry — keep Node/API consumers DOM-free.
// import from '@boletera/venue-engine/render' in client apps.
