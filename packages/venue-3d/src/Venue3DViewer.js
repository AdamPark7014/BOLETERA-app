'use strict';
'use client';
Object.defineProperty(exports, '__esModule', { value: true });
exports.Venue3DViewer = Venue3DViewer;
const react_1 = require('react');
const fiber_1 = require('@react-three/fiber');
const drei_1 = require('@react-three/drei');
const SeatViewCamera_1 = require('./SeatViewCamera');
function ArenaMesh() {
  return (
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.5, 0]}>
      <cylinderGeometry args={[8, 10, 0.3, 48]} />
      <meshStandardMaterial color="#e8e8e8" />
    </mesh>
  );
}
function Stage() {
  return (
    <mesh position={[0, 0.2, -6]}>
      <boxGeometry args={[6, 0.4, 2]} />
      <meshStandardMaterial color="#171717" />
    </mesh>
  );
}
function SeatDots({ seats }) {
  const statusColor = {
    available: '#4c6fff',
    held: '#ffd166',
    sold: '#a3a3a3',
    blocked: '#ff6b6b',
  };
  return (
    <>
      {seats.map((s) => (
        <mesh key={s.id} position={[s.x / 15, s.z / 15 + 0.15, s.y / 15]}>
          <sphereGeometry args={[0.08, 8, 8]} />
          <meshStandardMaterial
            color={s.color ?? statusColor[s.status ?? 'available'] ?? '#4c6fff'}
          />
        </mesh>
      ))}
    </>
  );
}
function Venue3DViewer({ selectedSeat, seats = [], mode = 'orbit', className, height = 420 }) {
  const normalized = (0, react_1.useMemo)(
    () =>
      seats.slice(0, 800).map((s) => ({
        ...s,
        x: s.x ?? 0,
        y: s.y ?? 0,
        z: s.z ?? 0,
      })),
    [seats]
  );
  return (
    <div
      className={className}
      style={{
        width: '100%',
        height,
        background: '#fafafa',
        borderRadius: 12,
        border: '1px solid #e5e5e5',
        overflow: 'hidden',
      }}
    >
      <fiber_1.Canvas>
        <ambientLight intensity={0.65} />
        <directionalLight position={[5, 10, 5]} intensity={1.1} />
        <ArenaMesh />
        <Stage />
        {normalized.length > 0 && <SeatDots seats={normalized} />}
        {mode === 'seat' && selectedSeat ? (
          <SeatViewCamera_1.SeatViewCamera target={selectedSeat} />
        ) : (
          <>
            <drei_1.PerspectiveCamera makeDefault position={[0, 8, 12]} />
            <drei_1.OrbitControls enablePan enableZoom enableRotate />
          </>
        )}
      </fiber_1.Canvas>
    </div>
  );
}
//# sourceMappingURL=Venue3DViewer.js.map
