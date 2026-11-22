'use client';

import { useLayoutEffect, useMemo, useRef } from 'react';
import type { ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { BT } from './btTokens';
import type { LaidOutSeat } from './bowlLayout';

const _dummy = new THREE.Object3D();
const _color = new THREE.Color();

function isResale(seat: LaidOutSeat): boolean {
  const meta = (seat as { metadata?: Record<string, unknown> }).metadata;
  return meta?.resale === true || meta?.listing === true;
}

function isAccessibleSeat(seat: LaidOutSeat): boolean {
  const raw = (seat as { accessible?: boolean }).accessible;
  if (raw === true) return true;
  const meta = (seat as { metadata?: Record<string, unknown> }).metadata;
  return meta?.accessible === true || meta?.wheelchair === true || meta?.pmr === true;
}

/** Color de instancia según estado, zona, calor y selección. */
export function seatInstanceColor(
  seat: LaidOutSeat,
  selected: boolean,
  heat?: string | null
): THREE.Color {
  const blocked = seat.visibility?.blocked || seat.status === 'blocked';
  if (blocked) return _color.set(BT.inkOverlay);
  if (seat.status === 'sold') return _color.set(BT.seatSold);
  if (seat.status === 'held') return _color.set(BT.seatSoldLine);
  if (selected) return _color.set(BT.gold);
  if (heat) return _color.set(heat);
  if (isResale(seat)) return _color.set(BT.moneyOut);
  if (isAccessibleSeat(seat)) return _color.set(BT.seatAccess);
  if (seat.visibility?.restrictedView) return _color.set(BT.textTertiary);
  if (seat.visibility?.premiumView) return _color.set(BT.bonePressed);
  return _color.set(seat.color || BT.seatFree);
}

function disabledSeat(seat: LaidOutSeat) {
  return (
    seat.status === 'sold' ||
    seat.status === 'blocked' ||
    seat.status === 'held' ||
    Boolean(seat.visibility?.blocked)
  );
}

export type InstancedSeatsProps = {
  seats: LaidOutSeat[];
  selectedIds: Set<string>;
  heatBySeat?: Map<string, string> | null;
  onToggleSeat?: (id: string) => void;
  onHoverSeat: (seat: LaidOutSeat | null) => void;
  lodAggressive?: boolean;
};

/**
 * Butacas con InstancedMesh (asiento + respaldo). Nunca un mesh React por plaza.
 */
export function InstancedSeats({
  seats,
  selectedIds,
  heatBySeat,
  onToggleSeat,
  onHoverSeat,
  lodAggressive,
}: InstancedSeatsProps) {
  const seatMesh = useRef<THREE.InstancedMesh>(null);
  const backMesh = useRef<THREE.InstancedMesh>(null);
  const decoMesh = useRef<THREE.InstancedMesh>(null);

  const real = useMemo(() => seats.filter((s) => !s.decorative), [seats]);
  const deco = useMemo(() => {
    const all = seats.filter((s) => s.decorative);
    const aggressive = lodAggressive ?? seats.length > 5000;
    if (!aggressive) return all;
    return all.filter((s) => (s.rowIndex ?? 0) <= 8);
  }, [seats, lodAggressive]);

  useLayoutEffect(() => {
    const mesh = seatMesh.current;
    const back = backMesh.current;
    if (!mesh || !back) return;
    const n = real.length;
    mesh.count = n;
    back.count = n;
    for (let i = 0; i < n; i++) {
      const seat = real[i]!;
      const selected = selectedIds.has(seat.id);
      const lift = selected ? 0.08 : 0;
      _dummy.position.set(seat.px, seat.py + 0.055 + lift, seat.pz);
      _dummy.rotation.set(seat.rotX ?? 0, seat.rotY, seat.rotZ ?? 0);
      _dummy.scale.set(1, 1, 1);
      _dummy.updateMatrix();
      mesh.setMatrixAt(i, _dummy.matrix);
      seatInstanceColor(seat, selected, heatBySeat?.get(seat.id));
      mesh.setColorAt(i, _color);

      _dummy.position.set(seat.px, seat.py + 0.16 + lift, seat.pz);
      _dummy.rotation.set(seat.rotX ?? 0, seat.rotY, seat.rotZ ?? 0);
      _dummy.translateZ(0.09);
      _dummy.updateMatrix();
      back.setMatrixAt(i, _dummy.matrix);
      back.setColorAt(i, _color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    back.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
    if (back.instanceColor) back.instanceColor.needsUpdate = true;
  }, [real, selectedIds, heatBySeat]);

  useLayoutEffect(() => {
    const mesh = decoMesh.current;
    if (!mesh) return;
    const n = deco.length;
    mesh.count = n;
    for (let i = 0; i < n; i++) {
      const seat = deco[i]!;
      _dummy.position.set(seat.px, seat.py + 0.05, seat.pz);
      _dummy.rotation.set(seat.rotX ?? 0, seat.rotY, seat.rotZ ?? 0);
      _dummy.scale.set(1, 1, 1);
      _dummy.updateMatrix();
      mesh.setMatrixAt(i, _dummy.matrix);
      _color.set(seat.color || BT.inkRaised);
      mesh.setColorAt(i, _color);
    }
    mesh.instanceMatrix.needsUpdate = true;
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true;
  }, [deco]);

  const onClick = (e: ThreeEvent<MouseEvent>) => {
    e.stopPropagation();
    const id = e.instanceId;
    if (id == null || id < 0 || id >= real.length) return;
    const seat = real[id]!;
    if (disabledSeat(seat)) return;
    onToggleSeat?.(seat.id);
  };

  const onOver = (e: ThreeEvent<PointerEvent>) => {
    e.stopPropagation();
    const id = e.instanceId;
    if (id == null || id < 0 || id >= real.length) return;
    const seat = real[id]!;
    if (disabledSeat(seat)) {
      onHoverSeat(null);
      return;
    }
    onHoverSeat(seat);
    document.body.style.cursor = 'pointer';
  };

  const onOut = () => {
    onHoverSeat(null);
    document.body.style.cursor = 'auto';
  };

  return (
    <group>
      <instancedMesh
        ref={decoMesh}
        args={[undefined, undefined, Math.max(deco.length, 1)]}
        frustumCulled
        raycast={() => null}
      >
        <boxGeometry args={[0.2, 0.08, 0.22]} />
        <meshStandardMaterial vertexColors roughness={0.95} />
      </instancedMesh>

      <instancedMesh
        ref={seatMesh}
        args={[undefined, undefined, Math.max(real.length, 1)]}
        castShadow
        frustumCulled
        onClick={onClick}
        onPointerOver={onOver}
        onPointerOut={onOut}
      >
        <boxGeometry args={[0.26, 0.08, 0.24]} />
        <meshStandardMaterial vertexColors roughness={0.55} metalness={0.08} />
      </instancedMesh>

      <instancedMesh
        ref={backMesh}
        args={[undefined, undefined, Math.max(real.length, 1)]}
        castShadow
        frustumCulled
        raycast={() => null}
      >
        <boxGeometry args={[0.26, 0.18, 0.05]} />
        <meshStandardMaterial vertexColors roughness={0.6} metalness={0.06} />
      </instancedMesh>
    </group>
  );
}
