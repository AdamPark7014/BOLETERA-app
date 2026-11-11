'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.createOrderSchema = void 0;
const zod_1 = require('zod');
exports.createOrderSchema = zod_1.z.object({
  eventId: zod_1.z.string().min(1),
  holdIds: zod_1.z.array(zod_1.z.string()).min(1),
  buyerName: zod_1.z.string().min(1),
  buyerEmail: zod_1.z.string().email(),
  buyerPhone: zod_1.z.string().optional(),
  promotionCode: zod_1.z.string().optional(),
  paymentMethod: zod_1.z
    .enum(['CARD', 'CASH', 'OXXO', 'SPEI', 'CLIP', 'BANK_TRANSFER'])
    .default('CARD'),
});
//# sourceMappingURL=orders.js.map
