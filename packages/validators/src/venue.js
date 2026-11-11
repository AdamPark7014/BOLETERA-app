'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.venueLayoutSchema = void 0;
const zod_1 = require('zod');
exports.venueLayoutSchema = zod_1.z.object({
  name: zod_1.z.string().min(1),
  mapData: zod_1.z.object({
    sections: zod_1.z.array(
      zod_1.z.object({
        id: zod_1.z.string(),
        name: zod_1.z.string(),
        slug: zod_1.z.string(),
        color: zod_1.z.string(),
        seats: zod_1.z.array(
          zod_1.z.object({
            id: zod_1.z.string(),
            label: zod_1.z.string(),
            x: zod_1.z.number(),
            y: zod_1.z.number(),
            row: zod_1.z.string().optional(),
            tier: zod_1.z.string().optional(),
          })
        ),
      })
    ),
  }),
});
//# sourceMappingURL=venue.js.map
