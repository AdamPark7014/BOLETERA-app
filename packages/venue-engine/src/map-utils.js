'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.findSeatById = findSeatById;
exports.seatToViewCoords = seatToViewCoords;
exports.buildAvailabilityMap = buildAvailabilityMap;
function findSeatById(map, seatId) {
  for (const section of map.sections) {
    const seat = section.seats.find((s) => s.id === seatId);
    if (seat) return seat;
  }
  return undefined;
}
function seatToViewCoords(seat) {
  if (seat.coord3d) return seat.coord3d;
  return { x: seat.x / 100, y: 0.5, z: seat.y / 100 };
}
function buildAvailabilityMap(seats) {
  return Object.fromEntries(seats.map((s) => [s.id, s.status]));
}
//# sourceMappingURL=map-utils.js.map
