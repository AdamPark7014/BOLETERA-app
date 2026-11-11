'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.SEAT_STATUS_COLORS = void 0;
exports.seatCircle = seatCircle;
/** SVG path helpers for 2D seat rendering */
function seatCircle(x, y, r = 6) {
  return `M ${x - r} ${y} a ${r} ${r} 0 1 0 ${r * 2} 0 a ${r} ${r} 0 1 0 ${-r * 2} 0`;
}
exports.SEAT_STATUS_COLORS = {
  AVAILABLE: '#fafafa',
  HELD: '#d4d4d4',
  SOLD: '#737373',
  SELECTED: '#171717',
};
//# sourceMappingURL=seatmap-canvas.js.map
