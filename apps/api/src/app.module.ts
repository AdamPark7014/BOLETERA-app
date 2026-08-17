import { Logger, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ConfigModule } from '@nestjs/config';
import { BullModule } from '@nestjs/bull';
import {
  ThrottlerGuard,
  ThrottlerModule,
  ThrottlerModuleOptions,
  ThrottlerStorage,
} from '@nestjs/throttler';
import {
  PrismaModule,
  CommonModule,
  TenantModule,
  AuthModule, 
  DiscoveryModule, 
  InventoryModule, 
  PricingModule, 
  OrdersModule, 
  PaymentModule, 
  ResaleModule, 
  FraudModule, 
  AnalyticsModule, 
  AdminModule,
  NotificationModule,
  AccessModule,
  SeatMapping3DModule,
  EventManagementModule,
  ChannelManagementModule,
  TaquillaPosModule,
  LayoutManagementModule,
  SearchModule,
  ReportingModule,
  CampaignExecutionModule,
  VenueLayoutModule,
  OrganizationModule,
  WaitlistModule,
  TicketTransferModule,
  PartnersModule,
  BillingModule,
  SeasonModule,
} from './modules';
import { AppController } from './app.controller';
import { AppService } from './app.service';

const throttlerLogger = new Logger('ThrottlerStorage');

/** Entero positivo desde el entorno, con default si falta o es basura. */
function envInt(name: string, fallback: number): number {
  const parsed = Number.parseInt(process.env[name] ?? '', 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
}

/** Evita inundar el log cuando Redis falla en cada petición del onsale. */
function makeThrottledWarn(intervalMs = 30_000) {
  let lastAt = 0;
  return (message: string) => {
    const now = Date.now();
    if (now - lastAt < intervalMs) return false;
    lastAt = now;
    throttlerLogger.warn(message);
    return true;
  };
}

/**
 * Almacén de rate limiting que sobrevive a una caída de Redis.
 *
 * Sin este envoltorio, cualquier error de Redis se propaga desde ThrottlerGuard
 * y convierte TODAS las peticiones en 500. En un onsale eso es peor que perder
 * temporalmente el límite: se abre (fail-open) y se deja constancia ruidosa.
 */
class ResilientThrottlerStorage implements ThrottlerStorage {
  private degraded = false;
  private readonly warnDegraded = makeThrottledWarn();

  constructor(private readonly delegate: ThrottlerStorage) {}

  async increment(
    key: string,
    ttl: number,
    limit: number,
    blockDuration: number,
    throttlerName: string,
  ) {
    try {
      const record = await this.delegate.increment(key, ttl, limit, blockDuration, throttlerName);
      if (this.degraded) {
        this.degraded = false;
        throttlerLogger.log('Redis recuperado: el rate limiting vuelve a ser global entre réplicas.');
      }
      return record;
    } catch (error) {
      this.degraded = true;
      this.warnDegraded(
        `Redis no responde al contar peticiones (${(error as Error).message}). ` +
          'El rate limiting queda ABIERTO mientras dure el fallo.',
      );
      return {
        totalHits: 1,
        timeToExpire: Math.ceil(ttl / 1000),
        isBlocked: false,
        timeToBlockExpire: 0,
      };
    }
  }
}

/**
 * Almacenamiento compartido del rate limiting (F1-19 / F2-21).
 *
 * El almacén por defecto de @nestjs/throttler vive en la memoria del proceso:
 * con N réplicas el límite efectivo se multiplica por N y se reinicia en cada
 * despliegue. Eso vacía de contenido el límite de login (@Throttle en
 * auth.controller), que es la única defensa contra fuerza bruta.
 *
 * Si Redis no está disponible al arrancar se degrada a memoria, pero NUNCA en
 * silencio: se deja un warning explícito en el log.
 */
async function createThrottlerStorage(): Promise<ThrottlerStorage | undefined> {
  const url = process.env.REDIS_URL;
  if (!url) {
    throttlerLogger.warn(
      'REDIS_URL no está definido — rate limiting DEGRADADO a memoria del proceso. ' +
        'Con varias réplicas el límite real es N veces el configurado.',
    );
    return undefined;
  }

  try {
    // `require` diferido a propósito: si el paquete no está instalado o Redis no
    // responde, el API arranca igualmente en modo degradado en vez de entrar en
    // crash-loop justo antes de un onsale.
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const ioredis = require('ioredis');
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { ThrottlerStorageRedisService } = require('@nest-lab/throttler-storage-redis');
    const RedisClient = ioredis.Redis ?? ioredis.default ?? ioredis;

    const client = new RedisClient(url, {
      lazyConnect: true,
      connectTimeout: envInt('THROTTLE_REDIS_CONNECT_TIMEOUT_MS', 5_000),
      // Falla rápido en vez de dejar la petición colgada esperando a Redis.
      maxRetriesPerRequest: 2,
      retryStrategy: (attempt: number) => Math.min(attempt * 200, 3_000),
    });

    // Sin listener de 'error', un fallo de ioredis tumba el proceso entero.
    const warnClient = makeThrottledWarn();
    client.on('error', (error: Error) => {
      warnClient(`Redis (rate limiting): ${error.message}`);
    });

    await client.connect();
    await client.ping();

    throttlerLogger.log('Rate limiting sobre Redis: límite global y compartido entre réplicas.');
    return new ResilientThrottlerStorage(new ThrottlerStorageRedisService(client));
  } catch (error) {
    throttlerLogger.warn(
      `Redis no disponible para el rate limiting (${(error as Error).message}) — ` +
        'DEGRADANDO a memoria del proceso. El límite deja de ser global entre réplicas ' +
        'y el límite de login pierde eficacia como defensa de fuerza bruta.',
    );
    return undefined;
  }
}

async function createThrottlerOptions(): Promise<ThrottlerModuleOptions> {
  const storage = await createThrottlerStorage();

  return {
    throttlers: [
      {
        // Ráfaga: amortigua el pico del minuto 1 (bots y refrescos compulsivos)
        // sin castigar la navegación normal.
        name: 'burst',
        ttl: envInt('THROTTLE_BURST_TTL_MS', 1_000),
        limit: envInt('THROTTLE_BURST_LIMIT', 10),
      },
      {
        // El nombre 'default' es obligatorio: los @Throttle({ default: … }) de
        // login y del PIN de taquilla sobrescriben precisamente este nivel.
        name: 'default',
        ttl: envInt('THROTTLE_TTL_MS', 60_000),
        limit: envInt('THROTTLE_LIMIT', 120),
      },
    ],
    // Las sondas de salud nunca se limitan: un 429 al balanceador saca la
    // réplica de rotación en mitad del onsale.
    skipIf: (context) => {
      const request = context.switchToHttp().getRequest();
      const path: string = request?.originalUrl ?? request?.url ?? '';
      return path.startsWith('/api/v1/health') || path.startsWith('/api/v1/ready');
    },
    ...(storage ? { storage } : {}),
  };
}

@Module({
  imports: [
    // Config
    ConfigModule.forRoot({
      isGlobal: true,
      envFilePath: [
        '.env.local',
        '.env',
        '../../.env',
      ],
    }),
    // forRootAsync porque el almacén de Redis se resuelve en el arranque y
    // puede degradar a memoria. Dos niveles: sostenido (120/min, generoso para
    // no molestar a la navegación normal) y de ráfaga (10/s). Las rutas
    // sensibles a fuerza bruta (login, PIN de taquilla) siguen fijando su
    // propio @Throttle({ default: … }) más estricto.
    ThrottlerModule.forRootAsync({
      useFactory: createThrottlerOptions,
    }),

  CommonModule,
    TenantModule,
    PrismaModule,
    BullModule.forRoot({
      redis: process.env.REDIS_URL || 'redis://localhost:6379',
    }),
    
    // Core Modules
    AuthModule,
    DiscoveryModule,
    InventoryModule,
    PricingModule,
    OrdersModule,
    PaymentModule,
    ResaleModule,
    FraudModule,
    AnalyticsModule,
    AdminModule,
    NotificationModule,
    AccessModule,
    SeatMapping3DModule,
    EventManagementModule,
    ChannelManagementModule,
    TaquillaPosModule,
    LayoutManagementModule,
    SearchModule,
    ReportingModule,
    CampaignExecutionModule,
    VenueLayoutModule,
    OrganizationModule,
    WaitlistModule,
    TicketTransferModule,
    PartnersModule,
    BillingModule,
    SeasonModule,
  ],
  controllers: [AppController],
  providers: [AppService, { provide: APP_GUARD, useClass: ThrottlerGuard }],
  exports: [AppService],
})
export class AppModule {}


