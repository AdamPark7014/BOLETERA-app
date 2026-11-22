'use client';

import { useFrame, useThree } from '@react-three/fiber';
import { useEffect, useRef } from 'react';
import * as THREE from 'three';

type Point = { x: number; y: number; z: number };

function easeInOutCubic(t: number) {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

function prefersReducedMotion() {
  if (typeof window === 'undefined' || !window.matchMedia) return false;
  return window.matchMedia('(prefers-reduced-motion: reduce)').matches;
}

/**
 * Vuela la cámara al punto de vista del asiento (1.2 s, ease in-out).
 * `target` es la base del asiento en mundo; el ojo queda a +1.2 en Y.
 */
export function SeatViewCamera({
  target,
  lookAt,
  durationMs = 1200,
  fov = 55,
  onArrive,
}: {
  target: Point;
  lookAt?: Point;
  durationMs?: number;
  fov?: number;
  onArrive?: () => void;
}) {
  const { camera } = useThree();
  const startPos = useRef(new THREE.Vector3());
  const endPos = useRef(new THREE.Vector3());
  const startLook = useRef(new THREE.Vector3());
  const endLook = useRef(new THREE.Vector3());
  const lookScratch = useRef(new THREE.Vector3());
  const startedAt = useRef(0);
  const flying = useRef(false);
  const arrived = useRef(false);
  const onArriveRef = useRef(onArrive);
  onArriveRef.current = onArrive;

  useEffect(() => {
    const persp = camera as THREE.PerspectiveCamera;
    if (typeof persp.fov === 'number') {
      persp.fov = fov;
      persp.updateProjectionMatrix();
    }

    endPos.current.set(target.x, target.y + 1.2, target.z);
    if (lookAt) {
      endLook.current.set(lookAt.x, lookAt.y, lookAt.z);
    } else {
      endLook.current.set(target.x, target.y + 0.5, target.z - 4);
    }

    startPos.current.copy(camera.position);
    // Dirección actual de mira (aprox. 4 u delante).
    camera.getWorldDirection(lookScratch.current);
    startLook.current.copy(camera.position).addScaledVector(lookScratch.current, 4);

    if (prefersReducedMotion() || durationMs <= 0) {
      camera.position.copy(endPos.current);
      camera.lookAt(endLook.current);
      flying.current = false;
      if (!arrived.current) {
        arrived.current = true;
        onArriveRef.current?.();
      }
      return;
    }

    startedAt.current = performance.now();
    flying.current = true;
    arrived.current = false;
  }, [camera, target.x, target.y, target.z, lookAt?.x, lookAt?.y, lookAt?.z, durationMs, fov]);

  useFrame(() => {
    if (!flying.current) return;
    const elapsed = performance.now() - startedAt.current;
    const t = Math.min(1, elapsed / Math.max(1, durationMs));
    const e = easeInOutCubic(t);
    camera.position.lerpVectors(startPos.current, endPos.current, e);
    lookScratch.current.lerpVectors(startLook.current, endLook.current, e);
    camera.lookAt(lookScratch.current);
    if (t >= 1) {
      flying.current = false;
      camera.position.copy(endPos.current);
      camera.lookAt(endLook.current);
      if (!arrived.current) {
        arrived.current = true;
        onArriveRef.current?.();
      }
    }
  });

  return null;
}
