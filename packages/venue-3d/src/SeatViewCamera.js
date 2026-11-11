'use strict';
'use client';
Object.defineProperty(exports, '__esModule', { value: true });
exports.SeatViewCamera = SeatViewCamera;
const fiber_1 = require('@react-three/fiber');
const react_1 = require('react');
function SeatViewCamera({ target }) {
  const { camera } = (0, fiber_1.useThree)();
  (0, react_1.useEffect)(() => {
    camera.position.set(target.x, target.y + 1.2, target.z + 2);
    camera.lookAt(target.x, target.y + 0.5, target.z - 4);
  }, [camera, target]);
  return null;
}
//# sourceMappingURL=SeatViewCamera.js.map
