'use client';

import { useEffect } from 'react';
import type { CameraPreset, StudioColorMode } from './types';

type StudioKeyboardHandlers = {
  onCameraPreset: (preset: CameraPreset) => void;
  onColorMode: (mode: StudioColorMode) => void;
  onFit: () => void;
  onToggleSeatView: () => void;
  onSelectNextSeat: (direction: 1 | -1) => void;
  onClearSelection: () => void;
  enabled?: boolean;
};

/**
 * Controles de teclado del estudio (alternativa accesible a la orbita con raton).
 */
export function useStudioKeyboard({
  onCameraPreset,
  onColorMode,
  onFit,
  onToggleSeatView,
  onSelectNextSeat,
  onClearSelection,
  enabled = true,
}: StudioKeyboardHandlers): void {
  useEffect(() => {
    if (!enabled) return;

    function isTypingTarget(target: EventTarget | null): boolean {
      if (!(target instanceof HTMLElement)) return false;
      const tag = target.tagName;
      return tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || target.isContentEditable;
    }

    function onKeyDown(event: KeyboardEvent) {
      if (isTypingTarget(event.target)) return;
      if (event.metaKey || event.ctrlKey || event.altKey) return;

      switch (event.key) {
        case '1':
          onColorMode('zone');
          break;
        case '2':
          onColorMode('tier');
          break;
        case '3':
          onColorMode('price');
          break;
        case '4':
          onColorMode('status');
          break;
        case '5':
          onColorMode('sightline');
          break;
        case 'o':
        case 'O':
          onCameraPreset('orbit');
          break;
        case 'p':
        case 'P':
          onCameraPreset('plan');
          break;
        case 'l':
        case 'L':
          onCameraPreset('side');
          break;
        case 'e':
        case 'E':
          onCameraPreset('stage');
          break;
        case 'v':
        case 'V':
          onToggleSeatView();
          break;
        case 'f':
        case 'F':
          onFit();
          break;
        case 'ArrowRight':
        case ']':
          event.preventDefault();
          onSelectNextSeat(1);
          break;
        case 'ArrowLeft':
        case '[':
          event.preventDefault();
          onSelectNextSeat(-1);
          break;
        case 'Escape':
          onClearSelection();
          break;
        default:
          break;
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [
    enabled,
    onCameraPreset,
    onClearSelection,
    onColorMode,
    onFit,
    onSelectNextSeat,
    onToggleSeatView,
  ]);
}
