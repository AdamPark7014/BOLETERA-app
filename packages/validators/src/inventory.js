'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.createHoldSchema = void 0;
const zod_1 = require('zod');
exports.createHoldSchema = zod_1.z.object({
  eventId: zod_1.z.string().min(1),
  seatIds: zod_1.z.array(zod_1.z.string()).optional(),
  offerId: zod_1.z.string().optional(),
  quantity: zod_1.z.number().int().min(1).max(20).default(1),
  sessionId: zod_1.z.string().optional(),
});
//# sourceMappingURL=inventory.js.map
