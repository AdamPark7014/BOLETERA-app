import { ForbiddenException, NotFoundException, UnauthorizedException } from '@nestjs/common';
import { MembershipBuyerController } from '../memberships/membership-buyer.controller';
import type { MembershipCheckoutService } from '../memberships/membership-checkout.service';
import { PaymentService } from '../payment/payment.service';
import type { BuyerSelfServiceService } from './buyer-self-service.service';
import { OrdersController } from './orders.controller';
import type { OrdersService } from './orders.service';

/**
 * Confirmación demo pedida por el comprador. La pasarela demo no manda IPN, así
 * que sin esta ruta ninguna compra web de la demo llegaba a COMPLETED (la de
 * administración exige rol). Reglas: demo y no producción, o 404; sin
 * credencial, 401; la credencial es la misma que para leer la orden.
 */
function makePayments(available: boolean) {
  return {
    isBuyerDemoConfirmAvailable: jest.fn(() => available),
    confirmBuyerDemoPurchase: jest.fn(async (_id: string, publicId: string) => ({
      publicId,
      status: 'COMPLETED',
    })),
  };
}

describe('POST /orders/:publicId/demo-confirm', () => {
  function setup(available: boolean) {
    const payments = makePayments(available);
    const orders = {
      authorizeBuyerAction: jest.fn(async (publicId: string, requester: { userId?: string }) => {
        if (requester.userId === 'otro')
          throw new ForbiddenException('No tienes acceso a esta orden');
        return { id: 'order-1', publicId };
      }),
    };
    const controller = new OrdersController(
      orders as unknown as OrdersService,
      {} as BuyerSelfServiceService,
      payments as unknown as PaymentService
    );
    return { controller, payments, orders };
  }

  it('demo + sesión del dueño → confirma por el camino del PaymentService', async () => {
    const { controller, payments, orders } = setup(true);
    await expect(controller.demoConfirm('ORD-1', { user: { sub: 'u1' } })).resolves.toEqual({
      publicId: 'ORD-1',
      status: 'COMPLETED',
    });
    expect(orders.authorizeBuyerAction).toHaveBeenCalledWith('ORD-1', {
      userId: 'u1',
      email: undefined,
      accessToken: undefined,
    });
    expect(payments.confirmBuyerDemoPurchase).toHaveBeenCalledWith('order-1', 'ORD-1');
  });

  it('demo + token de la orden (invitado) → confirma', async () => {
    const { controller, payments } = setup(true);
    await controller.demoConfirm('ORD-1', {}, 'tok');
    expect(payments.confirmBuyerDemoPurchase).toHaveBeenCalledTimes(1);
  });

  it('demo sin credencial → 401 y no confirma', async () => {
    const { controller, payments } = setup(true);
    await expect(controller.demoConfirm('ORD-1', {})).rejects.toBeInstanceOf(UnauthorizedException);
    await expect(controller.demoConfirm('ORD-1', {}, '   ')).rejects.toBeInstanceOf(
      UnauthorizedException
    );
    expect(payments.confirmBuyerDemoPurchase).not.toHaveBeenCalled();
  });

  it('demo con credencial ajena → 403 y no confirma', async () => {
    const { controller, payments } = setup(true);
    await expect(controller.demoConfirm('ORD-1', { user: { sub: 'otro' } })).rejects.toBeInstanceOf(
      ForbiddenException
    );
    expect(payments.confirmBuyerDemoPurchase).not.toHaveBeenCalled();
  });

  it('sin demo o en producción → 404 aunque haya credencial', async () => {
    const { controller, payments, orders } = setup(false);
    await expect(controller.demoConfirm('ORD-1', { user: { sub: 'u1' } })).rejects.toBeInstanceOf(
      NotFoundException
    );
    await expect(controller.demoConfirm('ORD-1', {})).rejects.toBeInstanceOf(NotFoundException);
    expect(orders.authorizeBuyerAction).not.toHaveBeenCalled();
    expect(payments.confirmBuyerDemoPurchase).not.toHaveBeenCalled();
  });
});

describe('POST /memberships/checkout/:publicId/demo-confirm', () => {
  function setup(available: boolean) {
    const payments = makePayments(available);
    const checkout = {
      status: jest.fn(async (userId: string, publicId: string) => {
        if (userId !== 'u1') throw new NotFoundException('Compra no encontrada');
        return { id: 'mem-1', publicId };
      }),
    };
    const controller = new MembershipBuyerController(
      checkout as unknown as MembershipCheckoutService,
      payments as unknown as PaymentService
    );
    return { controller, payments, checkout };
  }

  it('demo + sesión del dueño → confirma', async () => {
    const { controller, payments } = setup(true);
    await expect(controller.demoConfirm('MEM-1', { sub: 'u1' })).resolves.toEqual({
      publicId: 'MEM-1',
      status: 'COMPLETED',
    });
    expect(payments.confirmBuyerDemoPurchase).toHaveBeenCalledWith('mem-1', 'MEM-1');
  });

  it('demo sin sesión → 401', async () => {
    const { controller, payments } = setup(true);
    await expect(controller.demoConfirm('MEM-1', undefined)).rejects.toBeInstanceOf(
      UnauthorizedException
    );
    expect(payments.confirmBuyerDemoPurchase).not.toHaveBeenCalled();
  });

  it('demo con compra ajena → 404 y no confirma', async () => {
    const { controller, payments } = setup(true);
    await expect(controller.demoConfirm('MEM-1', { sub: 'otro' })).rejects.toBeInstanceOf(
      NotFoundException
    );
    expect(payments.confirmBuyerDemoPurchase).not.toHaveBeenCalled();
  });

  it('sin demo o en producción → 404', async () => {
    const { controller, checkout } = setup(false);
    await expect(controller.demoConfirm('MEM-1', { sub: 'u1' })).rejects.toBeInstanceOf(
      NotFoundException
    );
    expect(checkout.status).not.toHaveBeenCalled();
  });
});

describe('PaymentService.isBuyerDemoConfirmAvailable', () => {
  const env = { ...process.env };
  afterEach(() => {
    process.env = { ...env };
  });
  const available = () => PaymentService.prototype.isBuyerDemoConfirmAvailable.call({});

  it('demo (sin BANORTE_MERCHANT_ID) fuera de producción → disponible', () => {
    process.env.NODE_ENV = 'development';
    delete process.env.BANORTE_MERCHANT_ID;
    expect(available()).toBe(true);
  });

  it('producción → no disponible aunque la pasarela esté en demo', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.BANORTE_MERCHANT_ID;
    expect(available()).toBe(false);
  });

  it('pasarela real → no disponible', () => {
    process.env.NODE_ENV = 'development';
    process.env.BANORTE_MERCHANT_ID = 'merchant-real';
    expect(available()).toBe(false);
  });
});
