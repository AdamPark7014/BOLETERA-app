'use client';

import { memo, useEffect, useRef, type RefObject } from 'react';
import { mapToMeters } from '@boletera/venue-engine';
import type { SeatMapRenderer, WorldPoint } from '@boletera/venue-engine/render';
import { useEditor, useVenueBuilderStores } from '../store/store-context';
import { venueScale } from '../store/editor-store';
import { distance } from '../utils/geometry';
import type { ToolDraft } from '../store/types';
import styles from '../VenueBuilder.module.scss';

const GUIDE_SPAN = 1_000_000;

type Props = {
  rendererRef: RefObject<SeatMapRenderer | null>;
  ready: boolean;
};

function pointsAttr(points: readonly WorldPoint[]): string {
  return points.map((p) => `${p.x},${p.y}`).join(' ');
}

function arcPath(center: WorldPoint, radius: number, from: number, to: number): string {
  let span = to - from;
  while (span > Math.PI) span -= Math.PI * 2;
  while (span < -Math.PI) span += Math.PI * 2;
  const steps = 32;
  const parts: string[] = [];
  for (let i = 0; i <= steps; i++) {
    const angle = from + (span * i) / steps;
    const x = center.x + Math.cos(angle) * radius;
    const y = center.y + Math.sin(angle) * radius;
    parts.push(`${i === 0 ? 'M' : 'L'}${x} ${y}`);
  }
  return parts.join(' ');
}

function draftLabelAnchor(draft: ToolDraft): WorldPoint {
  switch (draft.kind) {
    case 'polygon':
    case 'polyline': {
      const last = draft.points[draft.points.length - 1];
      return last ?? { x: 0, y: 0 };
    }
    case 'rect':
      return { x: (draft.a.x + draft.b.x) / 2, y: Math.min(draft.a.y, draft.b.y) };
    case 'arc':
      return { x: draft.center.x, y: draft.center.y - draft.radius };
    case 'dot':
    default:
      return draft.at;
  }
}

/**
 * Vector chrome that the GPU layer does not own: snap guides, tool drafts,
 * dimension lines and sticky notes.
 *
 * The whole group is repositioned with a single transform per frame, so panning
 * and zooming never trigger a React render. Labels live in an HTML layer so they
 * keep a constant size at any zoom.
 */
export const VectorOverlay = memo(function VectorOverlay({ rendererRef, ready }: Props) {
  const { editor } = useVenueBuilderStores();
  const guides = useEditor((state) => state.guides);
  const draft = useEditor((state) => state.draft);
  const measurements = useEditor((state) => state.measurements);
  const annotations = useEditor((state) => state.annotations);
  const selectedNotes = useEditor((state) => state.selection.annotationIds);
  const scale = useEditor((state) => venueScale(state.scene));

  const groupRef = useRef<SVGGElement>(null);
  const labelsRef = useRef<HTMLDivElement>(null);

  const hasContent =
    guides.length > 0 || draft !== null || measurements.length > 0 || annotations.length > 0;

  useEffect(() => {
    if (!ready || !hasContent) return undefined;
    let raf = 0;
    let lastKey = '';
    const tick = () => {
      const renderer = rendererRef.current;
      const group = groupRef.current;
      if (renderer && group) {
        const { camera } = renderer;
        const key = `${camera.x}|${camera.y}|${camera.zoom}|${camera.width}|${camera.height}`;
        if (key !== lastKey) {
          lastKey = key;
          const tx = camera.width / 2 - camera.x * camera.zoom;
          const ty = camera.height / 2 - camera.y * camera.zoom;
          group.setAttribute('transform', `translate(${tx} ${ty}) scale(${camera.zoom})`);
          const labels = labelsRef.current;
          if (labels) {
            for (const child of Array.from(labels.children)) {
              const node = child as HTMLElement;
              const wx = Number(node.dataset.wx ?? '0');
              const wy = Number(node.dataset.wy ?? '0');
              const screen = camera.worldToScreen({ x: wx, y: wy });
              node.style.transform = `translate(${screen.x}px, ${screen.y}px)`;
            }
          }
        }
      }
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [ready, hasContent, rendererRef]);

  return (
    <div className={styles.vectorOverlay}>
      <svg className={styles.vectorSvg} aria-hidden="true">
        <g ref={groupRef}>
          {guides.map((guide) =>
            guide.axis === 'x' ? (
              <line
                key={`gx-${guide.value}`}
                x1={guide.value}
                y1={-GUIDE_SPAN}
                x2={guide.value}
                y2={GUIDE_SPAN}
                className={styles.snapGuide}
                vectorEffect="non-scaling-stroke"
              />
            ) : (
              <line
                key={`gy-${guide.value}`}
                x1={-GUIDE_SPAN}
                y1={guide.value}
                x2={GUIDE_SPAN}
                y2={guide.value}
                className={styles.snapGuide}
                vectorEffect="non-scaling-stroke"
              />
            ),
          )}

          {measurements.map((measurement) => (
            <line
              key={measurement.id}
              x1={measurement.a.x}
              y1={measurement.a.y}
              x2={measurement.b.x}
              y2={measurement.b.y}
              className={styles.measureLine}
              vectorEffect="non-scaling-stroke"
            />
          ))}

          {draft?.kind === 'polygon' && (
            <polygon
              points={pointsAttr(draft.points)}
              className={styles.draftShape}
              vectorEffect="non-scaling-stroke"
            />
          )}
          {draft?.kind === 'polyline' && (
            <polyline
              points={pointsAttr(draft.points)}
              className={styles.draftLine}
              vectorEffect="non-scaling-stroke"
            />
          )}
          {draft?.kind === 'rect' && (
            <rect
              x={Math.min(draft.a.x, draft.b.x)}
              y={Math.min(draft.a.y, draft.b.y)}
              width={Math.abs(draft.b.x - draft.a.x)}
              height={Math.abs(draft.b.y - draft.a.y)}
              className={styles.draftShape}
              vectorEffect="non-scaling-stroke"
            />
          )}
          {draft?.kind === 'arc' && (
            <path
              d={arcPath(draft.center, draft.radius, draft.from, draft.to)}
              className={styles.draftLine}
              vectorEffect="non-scaling-stroke"
            />
          )}
          {draft?.kind === 'dot' && (
            <circle
              cx={draft.at.x}
              cy={draft.at.y}
              r={6}
              className={styles.draftDot}
              vectorEffect="non-scaling-stroke"
            />
          )}
        </g>
      </svg>

      <div className={styles.overlayLabels} ref={labelsRef}>
        {draft?.label && (
          <span
            className={styles.overlayChip}
            data-wx={draftLabelAnchor(draft).x}
            data-wy={draftLabelAnchor(draft).y}
          >
            {draft.label}
          </span>
        )}
        {measurements.map((measurement) => (
          <span
            key={measurement.id}
            className={styles.overlayChip}
            data-wx={(measurement.a.x + measurement.b.x) / 2}
            data-wy={(measurement.a.y + measurement.b.y) / 2}
          >
            {mapToMeters(distance(measurement.a, measurement.b), scale).toFixed(2)} m
          </span>
        ))}
        {annotations.map((annotation) => (
          <button
            key={annotation.id}
            type="button"
            className={
              selectedNotes.includes(annotation.id)
                ? `${styles.overlayNote} ${styles.overlayNoteActive}`
                : styles.overlayNote
            }
            data-wx={annotation.at.x}
            data-wy={annotation.at.y}
            onClick={() => {
              editor.getState().setSelection({
                annotationIds: [annotation.id],
                seatIds: [],
                sectionIds: [],
                furnitureIds: [],
                measurementIds: [],
                stage: false,
              });
              editor.getState().setRightPanel('properties');
            }}
          >
            {annotation.text || 'Nota'}
          </button>
        ))}
      </div>
    </div>
  );
});
