'use client';

import { useThree } from '@react-three/fiber';
import { useEffect } from 'react';

type Point = { x: number; y: number; z: number };

/**
 * Cámara a la altura de los ojos en el asiento. Si se da `lookAt` (el
 * escenario), mira hacia allá; si no, hacia el frente (-z) como antes.
 */
export function SeatViewCamera({ target, lookAt }: { target: Point; lookAt?: Point }) {
  const { camera } = useThree();
  useEffect(() => {
    camera.position.set(target.x, target.y + 1.2, target.z);
    if (lookAt) {
      camera.lookAt(lookAt.x, lookAt.y, lookAt.z);
    } else {
      camera.position.z = target.z + 2;
      camera.lookAt(target.x, target.y + 0.5, target.z - 4);
    }
  }, [camera, target, lookAt]);
  return null;
}
