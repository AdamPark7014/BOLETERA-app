'use client';

import { useMemo } from 'react';
import { Billboard, Text } from '@react-three/drei';
import { BT } from './btTokens';
import type { LaidOutSeat, SectionPlate } from './bowlLayout';

export type SectionPriceLabelsProps = {
  seats: LaidOutSeat[];
  plates: SectionPlate[];
  currency?: string;
  visible?: boolean;
};

/**
 * Precio flotante por sección («desde $X») que siempre mira a la cámara.
 */
export function SectionPriceLabels({
  seats,
  plates,
  currency = 'MXN',
  visible = true,
}: SectionPriceLabelsProps) {
  const labels = useMemo(() => {
    if (!visible) return [];
    const bySection = new Map<string, number>();
    for (const s of seats) {
      if (s.decorative) continue;
      if (s.status === 'sold' || s.status === 'blocked') continue;
      if (typeof s.price !== 'number' || !(s.price > 0)) continue;
      const key = s.section || 'General';
      const prev = bySection.get(key);
      if (prev == null || s.price < prev) bySection.set(key, s.price);
    }
    const out: Array<{ key: string; x: number; y: number; z: number; text: string }> = [];
    for (const plate of plates) {
      const min = bySection.get(plate.name);
      if (min == null) continue;
      const amount = min.toLocaleString('es-MX', { maximumFractionDigits: 0 });
      out.push({
        key: plate.name,
        x: plate.center[0],
        y: Math.max(plate.center[1], 0) + 1.2,
        z: plate.center[2],
        text: `desde $${amount}${currency === 'MXN' ? '' : ` ${currency}`}`,
      });
      if (out.length >= 24) break;
    }
    return out;
  }, [seats, plates, currency, visible]);

  if (!visible || !labels.length) return null;

  return (
    <group>
      {labels.map((l) => (
        <Billboard key={l.key} position={[l.x, l.y, l.z]} follow>
          <Text
            fontSize={0.28}
            color={BT.text}
            anchorX="center"
            anchorY="middle"
            outlineWidth={0.02}
            outlineColor={BT.ink}
          >
            {l.text}
          </Text>
        </Billboard>
      ))}
    </group>
  );
}
