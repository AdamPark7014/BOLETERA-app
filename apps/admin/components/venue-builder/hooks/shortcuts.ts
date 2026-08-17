export type ShortcutEntry = { keys: string; action: string };
export type ShortcutGroup = { title: string; entries: ShortcutEntry[] };

/** Single source of truth for the help overlay and the key handler below. */
export const SHORTCUT_GROUPS: ShortcutGroup[] = [
  {
    title: 'Herramientas',
    entries: [
      { keys: 'V', action: 'Seleccionar' },
      { keys: 'H / Espacio', action: 'Encuadrar (pan)' },
      { keys: 'Z', action: 'Zoom' },
      { keys: 'S', action: 'Dibujar zona' },
      { keys: 'R', action: 'Dibujar fila (recta o curva)' },
      { keys: 'A', action: 'Colocar asiento' },
      { keys: 'F', action: 'Colocar mobiliario' },
      { keys: 'G', action: 'Definir escenario' },
      { keys: 'M', action: 'Medir' },
      { keys: 'N', action: 'Nota' },
    ],
  },
  {
    title: 'Edición',
    entries: [
      { keys: 'Ctrl/⌘ + Z', action: 'Deshacer' },
      { keys: 'Ctrl/⌘ + ⇧ + Z · Ctrl + Y', action: 'Rehacer' },
      { keys: 'Ctrl/⌘ + D', action: 'Duplicar selección' },
      { keys: 'Ctrl/⌘ + C · X · V', action: 'Copiar · cortar · pegar' },
      { keys: 'Ctrl/⌘ + A', action: 'Seleccionar todo' },
      { keys: 'Ctrl/⌘ + G', action: 'Agrupar en zona' },
      { keys: 'Ctrl/⌘ + ⇧ + G', action: 'Desagrupar zona' },
      { keys: 'Ctrl/⌘ + S', action: 'Guardar' },
      { keys: 'Supr / ⌫', action: 'Eliminar' },
      { keys: 'Esc', action: 'Cancelar herramienta y deseleccionar' },
      { keys: 'Enter', action: 'Cerrar el trazo activo' },
    ],
  },
  {
    title: 'Transformar',
    entries: [
      { keys: '← ↑ → ↓', action: 'Mover un paso de rejilla' },
      { keys: '⇧ + flechas', action: 'Mover diez pasos' },
      { keys: '[ · ]', action: 'Rotar −15° · +15°' },
      { keys: '⇧ + [ · ]', action: 'Escalar 90% · 110%' },
    ],
  },
  {
    title: 'Vista',
    entries: [
      { keys: 'Rueda', action: 'Zoom al cursor' },
      { keys: '⇧ + rueda', action: 'Desplazar horizontal' },
      { keys: 'Botón central', action: 'Pan temporal' },
      { keys: '+ · −', action: 'Zoom' },
      { keys: '0', action: 'Encuadrar todo' },
      { keys: '1…5', action: 'Color: zona, tier, precio, estado, visión' },
      { keys: 'Ctrl/⌘ + .', action: 'Ocultar o mostrar paneles' },
      { keys: '?', action: 'Este panel de atajos' },
    ],
  },
];
