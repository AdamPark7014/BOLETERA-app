import { ExecutionContext } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from '../auth/roles.guard';
import { PricingController } from './pricing.controller';

/**
 * Decisión de Adam (13-11-2026): solo ADMIN y SUPER_ADMIN aplican, aprueban o
 * rechazan cambios de precio. PROMOTER y VENUE_MANAGER siguen consultando.
 * RolesGuard devuelve false y Nest responde 403.
 */
const WRITE_HANDLERS = [
  'applyRecommendations',
  'updateDynamicPrices',
  'approveRecommendation',
  'rejectRecommendation',
] as const;

const READ_HANDLERS = [
  'recommendations',
  'previewRecommendations',
  'pendingRecommendations',
  'getPriceHistory',
  'estimateRevenue',
] as const;

function contextFor(handlerName: string, role: string): ExecutionContext {
  const handler = (PricingController.prototype as unknown as Record<string, () => unknown>)[
    handlerName
  ];
  return {
    getHandler: () => handler,
    getClass: () => PricingController,
    switchToHttp: () => ({ getRequest: () => ({ user: { role } }) }),
  } as unknown as ExecutionContext;
}

describe('PricingController · roles de escritura de precios', () => {
  const guard = new RolesGuard(new Reflector());

  it.each(WRITE_HANDLERS)('%s: PROMOTER y VENUE_MANAGER reciben 403', (handler) => {
    expect(
      typeof (PricingController.prototype as unknown as Record<string, unknown>)[handler]
    ).toBe('function');
    expect(guard.canActivate(contextFor(handler, 'PROMOTER'))).toBe(false);
    expect(guard.canActivate(contextFor(handler, 'VENUE_MANAGER'))).toBe(false);
  });

  it.each(WRITE_HANDLERS)('%s: ADMIN y SUPER_ADMIN pasan', (handler) => {
    expect(guard.canActivate(contextFor(handler, 'ADMIN'))).toBe(true);
    expect(guard.canActivate(contextFor(handler, 'SUPER_ADMIN'))).toBe(true);
  });

  it.each(READ_HANDLERS)('%s: PROMOTER y VENUE_MANAGER siguen consultando', (handler) => {
    expect(guard.canActivate(contextFor(handler, 'PROMOTER'))).toBe(true);
    expect(guard.canActivate(contextFor(handler, 'VENUE_MANAGER'))).toBe(true);
  });
});
