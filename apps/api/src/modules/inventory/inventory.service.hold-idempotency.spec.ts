import { ConflictException } from '@nestjs/common';
import { Test, TestingModule } from '@nestjs/testing';
import { HoldStatus } from '@prisma/client';
import { RedisService } from '../../common/redis.service';
import { ChannelQuotaService } from '../channel-management/channel-quota.service';
import { SaleWindowService } from '../event-management/sale-window.service';
import { PrismaService } from '../prisma/prisma.service';
import { WaitlistService } from '../waitlist/waitlist.service';
import { InventoryService } from './inventory.service';

type HoldRow = {
  id: string;
  eventId: string;
  status: HoldStatus;
  expiresAt: Date;
};

type HoldResult = { holds: HoldRow[]; expiresAt: Date };

type HoldDto = {
  eventId: string;
  seatIds?: string[];
  offerId?: string;
  quantity?: number;
};

/**
 * Idempotencia de holds: misma Idempotency-Key → mismo hold; otra clave → otro.
 * Se stubbea createHoldCore para no arrastrar Postgres/Redis reales; el camino
 * de replay/persistencia (Redis + findMany) sí se ejercita de verdad.
 */
describe('InventoryService hold idempotency', () => {
  let service: InventoryService;
  let redisStore: Map<string, unknown>;
  let holdRows: Map<string, HoldRow>;
  let createHoldCore: jest.SpyInstance;
  let coreCalls: number;

  /** Acceso a métodos privados del servicio (solo en tests). */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const priv = () => service as any;

  beforeEach(async () => {
    redisStore = new Map();
    holdRows = new Map();
    coreCalls = 0;

    const module: TestingModule = await Test.createTestingModule({
      providers: [
        InventoryService,
        {
          provide: PrismaService,
          useValue: {
            seatHold: {
              findMany: jest.fn(
                async ({
                  where,
                }: {
                  where: {
                    id: { in: string[] };
                    eventId: string;
                    status: HoldStatus;
                    expiresAt: { gt: Date };
                  };
                }) => {
                  const now = where.expiresAt.gt;
                  return where.id.in
                    .map((id) => holdRows.get(id))
                    .filter(
                      (h): h is HoldRow =>
                        !!h &&
                        h.eventId === where.eventId &&
                        h.status === where.status &&
                        h.expiresAt > now,
                    );
                },
              ),
            },
          },
        },
        {
          provide: RedisService,
          useValue: {
            getJson: jest.fn(async (key: string) => redisStore.get(key) ?? null),
            setJson: jest.fn(async (key: string, value: unknown) => {
              redisStore.set(key, value);
              return true;
            }),
            increment: jest.fn(),
            decrement: jest.fn(),
          },
        },
        { provide: ChannelQuotaService, useValue: { assertAvailable: jest.fn() } },
        { provide: WaitlistService, useValue: {} },
        {
          provide: SaleWindowService,
          useValue: {
            assertSaleWindowOpenAndReserve: jest.fn(),
            releasePhaseQuota: jest.fn(),
          },
        },
      ],
    }).compile();

    service = module.get(InventoryService);

    createHoldCore = jest
      .spyOn(priv(), 'createHoldCore')
      .mockImplementation(async (dto: HoldDto, idempotencyKey?: string): Promise<HoldResult> => {
        coreCalls += 1;
        const hold: HoldRow = {
          id: `hold-${coreCalls}-${idempotencyKey ?? 'none'}`,
          eventId: dto.eventId,
          status: HoldStatus.ACTIVE,
          expiresAt: new Date(Date.now() + 900_000),
        };
        holdRows.set(hold.id, hold);
        const result: HoldResult = { holds: [hold], expiresAt: hold.expiresAt };
        if (idempotencyKey) {
          await priv().persistIdempotentHold(dto, idempotencyKey, result, 900);
        }
        return result;
      });
  });

  afterEach(() => {
    createHoldCore.mockRestore();
  });

  it('same Idempotency-Key returns the same hold without creating again', async () => {
    const dto = {
      eventId: 'evt-1',
      offerId: 'off-1',
      quantity: 2,
      sessionId: 'sess-1',
      skipSessionLimit: true,
      idempotencyKey: 'key-same',
    };

    const first = await service.createHold(dto);
    const second = await service.createHold(dto);

    expect(first.holds.map((h) => h.id)).toEqual(second.holds.map((h) => h.id));
    expect(coreCalls).toBe(1);
    expect(redisStore.has('hold:idemp:evt-1:key-same')).toBe(true);
  });

  it('different Idempotency-Keys create different holds', async () => {
    const base = {
      eventId: 'evt-1',
      offerId: 'off-1',
      quantity: 1,
      sessionId: 'sess-1',
      skipSessionLimit: true,
    };

    const a = await service.createHold({ ...base, idempotencyKey: 'key-a' });
    const b = await service.createHold({ ...base, idempotencyKey: 'key-b' });

    expect(a.holds[0].id).not.toBe(b.holds[0].id);
    expect(coreCalls).toBe(2);
  });

  it('rejects Idempotency-Key reuse with a different hold body', async () => {
    await service.createHold({
      eventId: 'evt-1',
      offerId: 'off-1',
      quantity: 1,
      sessionId: 'sess-1',
      skipSessionLimit: true,
      idempotencyKey: 'key-clash',
    });

    await expect(
      service.createHold({
        eventId: 'evt-1',
        offerId: 'off-1',
        quantity: 2,
        sessionId: 'sess-1',
        skipSessionLimit: true,
        idempotencyKey: 'key-clash',
      }),
    ).rejects.toBeInstanceOf(ConflictException);

    expect(coreCalls).toBe(1);
  });

  it('collapses a retry that arrives while the first create is still in flight', async () => {
    let releaseCore!: () => void;
    const coreGate = new Promise<void>((r) => {
      releaseCore = r;
    });
    let sawFirstCore!: () => void;
    const firstCoreEntered = new Promise<void>((r) => {
      sawFirstCore = r;
    });

    createHoldCore.mockImplementation(async (dto: HoldDto, idempotencyKey?: string): Promise<HoldResult> => {
      coreCalls += 1;
      const n = coreCalls;
      if (n === 1) sawFirstCore();
      await coreGate;
      const hold: HoldRow = {
        id: `hold-concurrent-${n}`,
        eventId: dto.eventId,
        status: HoldStatus.ACTIVE,
        expiresAt: new Date(Date.now() + 900_000),
      };
      holdRows.set(hold.id, hold);
      const result: HoldResult = { holds: [hold], expiresAt: hold.expiresAt };
      if (idempotencyKey) {
        await priv().persistIdempotentHold(dto, idempotencyKey, result, 900);
      }
      return result;
    });

    const dto = {
      eventId: 'evt-1',
      offerId: 'off-1',
      quantity: 1,
      sessionId: 'sess-1',
      skipSessionLimit: true,
      idempotencyKey: 'key-inflight',
    };

    const p1 = service.createHold(dto);
    await firstCoreEntered; // createHold ya registró el promise en inflight
    const p2 = service.createHold(dto);
    releaseCore();
    const [r1, r2] = await Promise.all([p1, p2]);

    expect(r1.holds[0].id).toBe(r2.holds[0].id);
    expect(coreCalls).toBe(1);
  });
});
