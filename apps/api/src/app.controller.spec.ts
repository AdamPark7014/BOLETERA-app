import { Test, TestingModule } from '@nestjs/testing';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { PrismaService } from './modules/prisma/prisma.service';
import { RedisService } from './common/redis.service';

describe('AppController', () => {
  let appController: AppController;

  beforeEach(async () => {
    const app: TestingModule = await Test.createTestingModule({
      controllers: [AppController],
      providers: [
        AppService,
        // El health check no debe exigir Postgres ni Redis reales para correr
        // en CI: se inyectan dobles con la superficie mínima que consume.
        {
          provide: PrismaService,
          useValue: { $queryRaw: jest.fn().mockResolvedValue([{ ok: 1 }]) },
        },
        { provide: RedisService, useValue: { isReady: true } },
      ],
    }).compile();

    appController = app.get<AppController>(AppController);
  });

  describe('health', () => {
    it('returns health status', async () => {
      const result = await appController.getHealth();
      expect(result.status).toBe('ok');
      expect(result.service).toBe('boletera-api');
      expect(result.database).toBe('up');
    });
  });

  describe('prometheus', () => {
    it('exposes up/db/redis gauges as text', async () => {
      const body = await appController.prometheus();
      expect(body).toContain('boletera_up 1');
      expect(body).toContain('boletera_db_ready 1');
      expect(body).toContain('boletera_redis_ready 1');
    });
  });
});
