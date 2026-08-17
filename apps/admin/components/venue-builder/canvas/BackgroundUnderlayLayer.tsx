'use client';

import { memo, useEffect, useRef, type RefObject } from 'react';
import type { SeatMapRenderer } from '@boletera/venue-engine/render';
import { useEditor } from '../store/store-context';
import styles from '../VenueBuilder.module.scss';

type Props = {
  rendererRef: RefObject<SeatMapRenderer | null>;
  ready: boolean;
};

/**
 * Reference underlay (site plan, architectural drawing) placed in world space
 * behind the GPU canvas.
 *
 * Raster images are drawn with an `<img>`; PDFs use the browser's built-in
 * viewer through an `<object>` element, which keeps the feature dependency-free.
 * Vector fidelity of the PDF underlay therefore depends on the host browser —
 * for measurable geometry, import the DXF/SVG instead.
 */
export const BackgroundUnderlayLayer = memo(function BackgroundUnderlayLayer({
  rendererRef,
  ready,
}: Props) {
  const underlay = useEditor((state) => state.underlay);
  const frameRef = useRef<HTMLDivElement>(null);

  const visible = Boolean(underlay?.visible);

  useEffect(() => {
    if (!ready || !visible || !underlay) return undefined;
    let raf = 0;
    let lastKey = '';
    const tick = () => {
      const renderer = rendererRef.current;
      const frame = frameRef.current;
      if (renderer && frame) {
        const { camera } = renderer;
        const key = `${camera.x}|${camera.y}|${camera.zoom}`;
        if (key !== lastKey) {
          lastKey = key;
          const origin = camera.worldToScreen({ x: underlay.x, y: underlay.y });
          frame.style.transform = `translate(${origin.x}px, ${origin.y}px) scale(${camera.zoom})`;
          frame.style.width = `${underlay.width}px`;
          frame.style.height = `${underlay.height}px`;
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ready, visible, underlay, rendererRef]);

  if (!underlay || !underlay.visible) return null;

  return (
    <div className={styles.underlayHost}>
      <div ref={frameRef} className={styles.underlayFrame} style={{ opacity: underlay.opacity }}>
        {underlay.kind === 'image' ? (
          <img src={underlay.url} alt="" className={styles.underlayMedia} draggable={false} />
        ) : (
          <object
            data={underlay.url}
            type="application/pdf"
            className={styles.underlayMedia}
            aria-label={underlay.name}
          />
        )}
      </div>
    </div>
  );
});
