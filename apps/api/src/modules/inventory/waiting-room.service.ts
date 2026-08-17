import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHmac, randomBytes, timingSafeEqual } from 'node:crypto';
import { RedisService } from '../../common/redis.service';
import { PrismaService } from '../prisma/prisma.service';
import { requireJwtSecret } from '../auth/jwt-secret';

/**
 * Sala de espera virtual para el minuto 1 de un onsale.
 *
 * No existía: 30.000 personas entraban a la vez contra la base y el resultado
 * era el que documentan las quejas de las plataformas grandes — la gente espera
 * una hora, la expulsan, y cuando vuelve los lugares ya no están.
 *
 * TRES DECISIONES QUE DEFINEN EL COMPORTAMIENTO:
 *
 * 1. LLEGAR TEMPRANO NO DA VENTAJA. Quien entra antes de la apertura va a una
 *    pre-fila cuyo orden se decide con un sorteo al abrir, no por orden de
 *    llegada. Si premiáramos la llegada, el ganador siempre sería un bot con
 *    mejor conexión, y la fila dejaría de ser justa justo donde importa. Quien
 *    llega DESPUÉS de abrir sí entra en FIFO, detrás de toda la pre-fila.
 *
 * 2. EL SORTEO ES IMPREDECIBLE PERO REPRODUCIBLE. La posición sale de
 *    HMAC(sal secreta del evento, identificador del miembro). Nadie puede
 *    calcular su posición por adelantado porque la sal no se publica, pero
 *    ante una queja se puede recalcular y demostrar que el sorteo fue limpio.
 *
 * 3. EL SONDEO NO TOCA LA BASE. La posición es un `ZRANK` en Redis y el pase es
 *    un token firmado que se verifica sin leer nada. Decenas de miles de
 *    personas preguntando "¿ya me toca?" cada pocos segundos no pueden costar
 *    una consulta cada una.
 *
 * El ritmo de admisión se calcula sobre el reloj, no con un proceso de fondo:
 * `admitidos = lotes_transcurridos × tamaño_de_lote`. Sin cron que se caiga,
 * sin estado que se desincronice entre réplicas.
 */

/** Configuración por evento, guardada en `Event.metadata.waitingRoom`. */
export interface WaitingRoomConfig {
  enabled: boolean;
  /** ISO 8601. Antes de esta hora, todo el mundo va a la pre-fila. */
  opensAt: string;
  /** Personas admitidas por lote. */
  batchSize: number;
  /** Segundos entre lotes. */
  batchIntervalSeconds: number;
}

const DEFAULTS = { batchSize: 200, batchIntervalSeconds: 10 };

/** La fila vive un día: cubre el onsale completo sin acumular basura. */
const QUEUE_TTL_SECONDS = 24 * 60 * 60;

/**
 * Las posiciones de pre-fila ocupan [0, 2^32) y las de FIFO empiezan en 2^32.
 * Así toda la pre-fila precede siempre a quien llega tarde, sin comparar horas.
 */
const FIFO_SCORE_BASE = 2 ** 32;

export interface QueueStatus {
  eventId: string;
  /** Posición 1-indexada; `null` si aún no hay fila. */
  position: number | null;
  ahead: number;
  total: number;
  admitted: boolean;
  /** Segundos estimados hasta el turno. `0` si ya le toca. */
  estimatedWaitSeconds: number;
  opensAt: string;
  /** Pase de admisión. Sólo viene cuando `admitted` es true. */
  pass?: string;
}

@Injectable()
export class WaitingRoomService {
  private readonly logger = new Logger(WaitingRoomService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // --- claves ---------------------------------------------------------------
  private queueKey(eventId: string) {
    return `waitroom:${eventId}:queue`;
  }
  private seqKey(eventId: string) {
    return `waitroom:${eventId}:seq`;
  }
  private saltKey(eventId: string) {
    return `waitroom:${eventId}:salt`;
  }

  /** Configuración del evento, o `null` si la sala no está activa. */
  async configFor(eventId: string): Promise<WaitingRoomConfig | null> {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { metadata: true },
    });
    if (!event) throw new NotFoundException('Event not found');

    const raw = (event.metadata as Record<string, unknown> | null)?.waitingRoom as
      | Partial<WaitingRoomConfig>
      | undefined;
    if (!raw?.enabled || !raw.opensAt) return null;

    return {
      enabled: true,
      opensAt: raw.opensAt,
      batchSize: Number(raw.batchSize) > 0 ? Number(raw.batchSize) : DEFAULTS.batchSize,
      batchIntervalSeconds:
        Number(raw.batchIntervalSeconds) > 0
          ? Number(raw.batchIntervalSeconds)
          : DEFAULTS.batchIntervalSeconds,
    };
  }

  /**
   * Sal del sorteo. Se crea una vez por evento y NO se publica: es lo que hace
   * que nadie pueda calcular su posición antes de la apertura.
   */
  private async salt(eventId: string): Promise<string> {
    const existing = await this.redis.get(this.saltKey(eventId));
    if (existing) return existing;
    const fresh = randomBytes(16).toString('hex');
    // El primero que llega la fija; si otra réplica ganó la carrera, se relee.
    const won = await this.redis.setHold(this.saltKey(eventId), fresh, QUEUE_TTL_SECONDS);
    return won ? fresh : ((await this.redis.get(this.saltKey(eventId))) ?? fresh);
  }

  /** Posición de sorteo dentro de la pre-fila: determinista e impredecible. */
  private async lotteryScore(eventId: string, memberId: string): Promise<number> {
    const salt = await this.salt(eventId);
    const digest = createHmac('sha256', salt).update(memberId).digest();
    // 32 bits: espacio suficiente para que las colisiones sean irrelevantes.
    return digest.readUInt32BE(0);
  }

  /** Entra a la fila. Volver a llamar NO reordena ni penaliza (`ZADD NX`). */
  async join(eventId: string, memberId: string): Promise<QueueStatus> {
    const config = await this.configFor(eventId);
    if (!config) throw new BadRequestException('Este evento no tiene sala de espera activa');
    if (!this.redis.isReady) {
      // Sin Redis no hay fila que valga: dejar pasar a todos sería peor que
      // decirlo, porque la promesa de orden justo quedaría rota en silencio.
      throw new BadRequestException('La sala de espera no está disponible en este momento');
    }

    const isOpen = Date.now() >= new Date(config.opensAt).getTime();
    const score = isOpen
      ? FIFO_SCORE_BASE + (await this.redis.incrementWithTtl(this.seqKey(eventId), 1, QUEUE_TTL_SECONDS) ?? 0)
      : await this.lotteryScore(eventId, memberId);

    await this.redis.zAdd(this.queueKey(eventId), score, memberId, QUEUE_TTL_SECONDS);
    return this.status(eventId, memberId);
  }

  /** Estado actual: posición, espera estimada y pase si ya le toca. */
  async status(eventId: string, memberId: string): Promise<QueueStatus> {
    const config = await this.configFor(eventId);
    if (!config) throw new BadRequestException('Este evento no tiene sala de espera activa');

    const [rank, total] = await Promise.all([
      this.redis.zRank(this.queueKey(eventId), memberId),
      this.redis.zCard(this.queueKey(eventId)),
    ]);

    if (rank === null) {
      return {
        eventId,
        position: null,
        ahead: 0,
        total,
        admitted: false,
        estimatedWaitSeconds: 0,
        opensAt: config.opensAt,
      };
    }

    const admittedSoFar = this.admittedCount(config);
    const admitted = rank < admittedSoFar;
    const ahead = Math.max(0, rank - admittedSoFar);

    return {
      eventId,
      position: rank + 1,
      ahead,
      total,
      admitted,
      estimatedWaitSeconds: admitted
        ? 0
        : Math.ceil(ahead / config.batchSize) * config.batchIntervalSeconds,
      opensAt: config.opensAt,
      pass: admitted ? this.signPass(eventId, memberId) : undefined,
    };
  }

  /** Sale de la fila (cerró la pestaña, terminó su compra). */
  async leave(eventId: string, memberId: string): Promise<void> {
    await this.redis.zRem(this.queueKey(eventId), memberId);
  }

  /**
   * Cuántos han sido admitidos hasta ahora, derivado del reloj.
   *
   * Sin proceso de fondo a propósito: un cron que se cae deja la fila
   * congelada con miles de personas mirando una pantalla que no avanza, y ése
   * es exactamente el fallo del que más se queja la gente.
   */
  private admittedCount(config: WaitingRoomConfig): number {
    const elapsedMs = Date.now() - new Date(config.opensAt).getTime();
    if (elapsedMs < 0) return 0;
    const batches = Math.floor(elapsedMs / (config.batchIntervalSeconds * 1000)) + 1;
    return batches * config.batchSize;
  }

  // --- pase de admisión -----------------------------------------------------

  /**
   * Pase firmado. Prueba "esta persona ya pasó la fila de este evento" sin
   * ninguna lectura: es lo que permite proteger la compra sin volver a pagar
   * el costo de la fila en cada petición.
   */
  private signPass(eventId: string, memberId: string): string {
    const payload = `${eventId}:${memberId}`;
    const mac = createHmac('sha256', requireJwtSecret())
      .update(`waitroom:${payload}`)
      .digest('hex')
      .slice(0, 32);
    return `${Buffer.from(payload).toString('base64url')}.${mac}`;
  }

  /** Verifica el pase en tiempo constante. */
  verifyPass(pass: string | undefined, eventId: string): boolean {
    if (!pass) return false;
    const [encoded, mac] = pass.split('.');
    if (!encoded || !mac) return false;

    let payload: string;
    try {
      payload = Buffer.from(encoded, 'base64url').toString('utf8');
    } catch {
      return false;
    }
    if (!payload.startsWith(`${eventId}:`)) return false;

    const expected = createHmac('sha256', requireJwtSecret())
      .update(`waitroom:${payload}`)
      .digest('hex')
      .slice(0, 32);
    const a = Buffer.from(expected, 'utf8');
    const b = Buffer.from(mac, 'utf8');
    if (a.length !== b.length) return false;
    return timingSafeEqual(a, b);
  }

  /**
   * ¿Debe esta petición pasar por la fila?
   *
   * Devuelve `false` cuando la sala no está activa, de modo que los eventos sin
   * onsale masivo no pagan ningún costo.
   */
  async isGated(eventId: string): Promise<boolean> {
    const config = await this.configFor(eventId).catch(() => null);
    return config !== null;
  }
}
