'use client';

import { useEffect, useRef } from 'react';

/**
 * Atajos de teclado.
 *
 * Regla del taquillero nuevo: si el atajo no está pintado en pantalla, no
 * existe. Por eso cada pantalla declara su lista y `HotkeyBar` la pinta.
 */

export type Hotkey = {
  /** Lo que se muestra en la barra: 'F8', 'Enter', '1-9'. */
  keys: string;
  label: string;
  /** Coincidencia real contra el evento; si falta se compara con `keys`. */
  match?: (e: KeyboardEvent) => boolean;
  run?: (e: KeyboardEvent) => void;
  /** Se ejecuta aunque el foco esté en un input (F-keys, Escape, Enter). */
  whileTyping?: boolean;
  /** Sólo informativo en la barra (lo maneja otro componente). */
  displayOnly?: boolean;
  hidden?: boolean;
};

function isTypingTarget(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  const tag = target.tagName;
  return (
    tag === 'INPUT' ||
    tag === 'TEXTAREA' ||
    tag === 'SELECT' ||
    target.isContentEditable === true
  );
}

function defaultMatch(keys: string, e: KeyboardEvent): boolean {
  return e.key.toLowerCase() === keys.toLowerCase();
}

/**
 * Registra los atajos de la pantalla activa. `enabled=false` los apaga sin
 * desmontar (útil mientras hay un diálogo modal encima).
 */
export function useHotkeys(hotkeys: Hotkey[], enabled = true) {
  // Ref para no re-suscribir el listener en cada render: los handlers de las
  // páginas se recrean constantemente y perder el listener a mitad de una
  // pulsación es exactamente el bug que no se puede permitir en ventanilla.
  const ref = useRef(hotkeys);
  ref.current = hotkeys;

  useEffect(() => {
    if (!enabled) return;
    function onKey(e: KeyboardEvent) {
      if (e.repeat) return;
      const typing = isTypingTarget(e.target);
      for (const hk of ref.current) {
        if (!hk.run || hk.displayOnly) continue;
        if (typing && !hk.whileTyping) continue;
        const hit = hk.match ? hk.match(e) : defaultMatch(hk.keys, e);
        if (!hit) continue;
        e.preventDefault();
        // `stopImmediatePropagation`, no `stopPropagation`: los demás registros
        // (barra de ayuda, marco, lector HID de la página) también escuchan en
        // `window`, y detener sólo la propagación no impediría que la misma
        // tecla se procese dos veces. Los efectos de los hijos se montan antes,
        // así que el atajo MÁS específico gana.
        e.stopImmediatePropagation();
        hk.run(e);
        return;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [enabled]);
}

/** Dígito 1-9 pulsado (sin modificadores), o null. */
export function digitPressed(e: KeyboardEvent): number | null {
  if (e.ctrlKey || e.altKey || e.metaKey) return null;
  if (e.key.length !== 1) return null;
  const n = Number(e.key);
  if (!Number.isInteger(n) || n < 1 || n > 9) return null;
  return n;
}

/** Cualquier dígito 0-9 (para teclear importes y cantidades). */
export function anyDigitPressed(e: KeyboardEvent): number | null {
  if (e.ctrlKey || e.altKey || e.metaKey) return null;
  if (e.key.length !== 1) return null;
  const n = Number(e.key);
  return Number.isInteger(n) && n >= 0 && n <= 9 ? n : null;
}

export function fKeyPressed(e: KeyboardEvent): number | null {
  const m = /^F([1-9]|1[0-2])$/.exec(e.key);
  return m ? Number(m[1]) : null;
}

// ---------------------------------------------------------------------------
// Catálogo global: la referencia única de qué hace cada tecla en toda la app.
// La pantalla de ayuda (`?`) lo pinta entero.
// ---------------------------------------------------------------------------

export const GLOBAL_HOTKEYS: Array<{ keys: string; label: string; scope: string }> = [
  { keys: 'F1', label: 'Nueva venta', scope: 'Global' },
  { keys: 'F2', label: 'Eventos / buscar evento', scope: 'Global' },
  { keys: 'F3', label: 'Buscar boleto u orden', scope: 'Global' },
  { keys: 'F4', label: 'Will-call', scope: 'Global' },
  { keys: 'F6', label: 'Control de acceso (puerta)', scope: 'Global' },
  { keys: 'F7', label: 'Reimprimir última venta', scope: 'Global' },
  { keys: 'F12', label: 'Corte de caja', scope: 'Global' },
  { keys: 'Esc', label: 'Volver / cancelar', scope: 'Global' },
  { keys: '?', label: 'Ver todos los atajos', scope: 'Global' },

  { keys: '1-9', label: 'Elegir evento de la lista', scope: 'Venta · evento' },
  { keys: 'Texto', label: 'Filtrar eventos al escribir', scope: 'Venta · evento' },
  { keys: '1-9', label: 'Elegir zona', scope: 'Venta · zona' },
  { keys: '0-9', label: 'Teclear cantidad', scope: 'Venta · cantidad' },
  { keys: '+ / -', label: 'Subir o bajar cantidad', scope: 'Venta · cantidad' },
  { keys: 'Enter', label: 'Continuar a cobro', scope: 'Venta · cantidad' },
  { keys: 'E', label: 'Efectivo', scope: 'Venta · cobro' },
  { keys: 'T', label: 'Tarjeta', scope: 'Venta · cobro' },
  { keys: 'C', label: 'Cortesía (PIN gerente)', scope: 'Venta · cobro' },
  { keys: '0-9', label: 'Teclear efectivo recibido', scope: 'Venta · cobro' },
  { keys: 'F1-F6', label: 'Billete rápido / importe exacto', scope: 'Venta · cobro' },
  { keys: 'Enter', label: 'Cobrar e imprimir', scope: 'Venta · cobro' },
  { keys: 'Esc', label: 'Volver al paso anterior', scope: 'Venta' },

  { keys: 'Enter', label: 'Buscar / escanear', scope: 'Buscar y will-call' },
  { keys: 'F3', label: 'Enfocar el campo de búsqueda', scope: 'Buscar y will-call' },
  { keys: 'F7', label: 'Reimprimir la orden encontrada', scope: 'Buscar y will-call' },
  { keys: 'F9', label: 'Anular la venta (PIN gerente)', scope: 'Buscar y will-call' },
  { keys: 'F4', label: 'Enfocar búsqueda de will-call', scope: 'Buscar y will-call' },

  { keys: 'Enter', label: 'Validar el boleto escaneado', scope: 'Acceso' },
  { keys: 'F5', label: 'Descargar manifiesto del evento', scope: 'Acceso' },
  { keys: 'F8', label: 'Sincronizar escaneos en cola', scope: 'Acceso' },

  { keys: 'F9', label: 'Retiro parcial de efectivo (PIN)', scope: 'Corte' },
  { keys: 'F10', label: 'Traspaso de turno (PIN)', scope: 'Corte' },
  { keys: 'F12', label: 'Cerrar turno (corte Z)', scope: 'Corte' },
];
