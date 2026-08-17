'use client';

import { useEffect, useRef, useState } from 'react';

/**
 * Contador de FPS de diagnostico basado en rAF (hilo principal).
 * No es telemetria GPU nativa; sirve para detectar degradacion del estudio.
 */
export function useFpsCounter(enabled: boolean): number {
  const [fps, setFps] = useState(0);
  const frames = useRef(0);
  const last = useRef(0);
  const raf = useRef(0);

  useEffect(() => {
    if (!enabled || typeof window === 'undefined') {
      setFps(0);
      return;
    }

    last.current = performance.now();
    frames.current = 0;

    const tick = (now: number) => {
      frames.current += 1;
      const elapsed = now - last.current;
      if (elapsed >= 500) {
        setFps(Math.round((frames.current * 1000) / elapsed));
        frames.current = 0;
        last.current = now;
      }
      raf.current = window.requestAnimationFrame(tick);
    };

    raf.current = window.requestAnimationFrame(tick);
    return () => {
      window.cancelAnimationFrame(raf.current);
    };
  }, [enabled]);

  return fps;
}
