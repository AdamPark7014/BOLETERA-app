import { ForbiddenException, Injectable, Logger } from '@nestjs/common';
import { HoldStatus } from '@prisma/client';
import { randomUUID } from 'crypto';
import { RedisService } from '../../common/redis.service';
import { PrismaService } from '../prisma/prisma.service';

/** Lo que el contador necesita saber de una fase para acotar su cupo. */
export type PhaseQuotaTarget = {
  id: string;
  eventId: string;
  name: string;
  startsAt: Date;
  endsAt: Date;
  allocationPercent: number | null;
};

/**
 * Recibo de un cupo apartado. Quien lo obtiene DEBE devolverlo con
 * `SaleWindowService.releasePhaseQuota` si la reserva no llega a cuajar.
 * `null` significa "no había nada que apartar" (fase sin cupo, aforo sin
 * definir, o Redis caído y resuelto contra la base).
 */
export type PhaseQuotaHandle = {
  phaseId: string;
  quantity: number;
};

export type PhaseQuotaUsage = {
  phaseId: string;
  allocationPercent: number;
  capacity: number;
  /** Butacas que la fase puede llegar a tomar. */
  limit: number;
  consumed: number;
  remaining: number;
  /** `false` = el dato se derivó de la base porque no había contador vivo. */
  fromCounter: boolean;
};

/** El contador vive hasta un rato después del cierre: los holds abiertos justo
 *  antes de cerrar siguen pudiendo convertirse y su cupo debe seguir contando. */
const COUNTER_TTL_MARGIN_SECONDS = 3_600;
const COUNTER_TTL_MIN_SECONDS = 300;
/** Tope duro: una fase mal configurada no debe dejar basura eterna en Redis. */
const COUNTER_TTL_MAX_SECONDS = 45 * 24 * 3_600;

/**
 * Cada cuánto se contrasta el contador contra la base. Es también el TTL del
 * candado que lo limita: no se libera nunca, así que sólo un nodo por ventana
 * hace la pasada, sin cron ni estado compartido en memoria.
 */
const RECONCILE_INTERVAL_SECONDS = Number(process.env.SALE_PHASE_QUOTA_SYNC_SECONDS ?? 20);

const counterKey = (phaseId: string) => `salephase:quota:${phaseId}`;
const reconcileKey = (phaseId: string) => `salephase:quota:sync:${phaseId}`;

/**
 * Hace cumplir `SalePhase.allocationPercent`: el cupo de aforo que el promotor
 * aparta para una fase ("30% para la preventa").
 *
 * ---------------------------------------------------------------------------
 * DÓNDE VIVE EL CONTADOR Y POR QUÉ
 * ---------------------------------------------------------------------------
 * El contador vive en REDIS y la base de datos es su verdad de referencia.
 *
 * El problema no es contar: es que comprobar y apartar ocurran como UNA sola
 * operación. Un `count()` en Postgres seguido de un `if` en Node es un
 * leer-modificar-escribir — exactamente el patrón por el que `ChannelQuotaService`
 * pierde actualizaciones — y con 45.000 butacas en juego dos compradores leen
 * el mismo "quedan 3" y ambos pasan.
 *
 * Con acceso al esquema esto sería una columna `SalePhase.soldCount` y un
 * `UPDATE ... SET soldCount = soldCount + n WHERE soldCount + n <= limite`:
 * atómico, exacto y duradero. No se puede tocar el esquema en esta ola, y las
 * alternativas que quedan en Postgres son malas para el camino caliente:
 * `SERIALIZABLE` o un advisory lock serializan el punto más disputado del
 * onsale, y contar en cada intento son 30.000 agregados por minuto sobre una
 * tabla que además está recibiendo escrituras.
 *
 * `INCRBY` es una operación atómica del lado del servidor: dos compras
 * simultáneas obtienen valores DISTINTOS y sólo una puede ser la que cruza el
 * límite. El coste de elegir Redis es que el contador es volátil, y se paga en
 * tres sitios:
 *
 *  1. SIEMBRA: si la clave no existe se calcula el consumo real desde la base y
 *     se fija con `SET NX` (ver `ensureSeeded`). Un reinicio de Redis a mitad de
 *     preventa NO devuelve el contador a cero.
 *  2. RECONCILIACIÓN: cada `RECONCILE_INTERVAL_SECONDS` se contrasta contra la
 *     base y se corrige la DERIVA de forma RELATIVA (`INCRBY`/`DECRBY` de la
 *     diferencia, nunca un `SET`), para no pisar las reservas en vuelo.
 *  3. DEGRADACIÓN: si Redis no responde se resuelve contra la base — exacto pero
 *     sin atomicidad. Es preferible pasarse en unas pocas butacas durante una
 *     caída de Redis a tumbar la venta entera.
 *
 * La reconciliación es además la razón por la que NO hace falta un evento de
 * "cupo devuelto" en cada camino de salida: un hold que expira, uno que se
 * libera o una orden que se cancela cambian filas en la base, y la siguiente
 * pasada los ve. Ningún llamador puede olvidarse de devolver el cupo porque
 * nadie tiene que acordarse.
 */
@Injectable()
export class SalePhaseQuotaService {
  private readonly logger = new Logger(SalePhaseQuotaService.name);

  /**
   * Colapsa la estampida de siembra DENTRO del proceso: al arrancar una fase,
   * las N peticiones que encuentran la clave vacía comparten un único agregado
   * en vez de lanzar N. Entre nodos la siembra es idempotente por el `SET NX`.
   */
  private readonly seeding = new Map<string, Promise<void>>();

  constructor(
    private prisma: PrismaService,
    private redis: RedisService,
  ) {}

  /**
   * Aparta `quantity` butacas del cupo de la fase, o lanza 403 si ya no cabe.
   *
   * @param capacity aforo del evento; llega desde `checkSaleWindow`, que ya
   *   había leído el evento, para no añadir una consulta al camino caliente.
   * @returns el recibo a devolver si la reserva no cuaja, o `null` si no había
   *   cupo que apartar.
   */
  async reserve(
    target: PhaseQuotaTarget,
    capacity: number,
    quantity: number,
  ): Promise<PhaseQuotaHandle | null> {
    const limit = this.limitFor(target, capacity);
    if (limit === null) return null;

    const at = new Date();
    const ttl = this.counterTtl(target, at);
    const key = counterKey(target.id);

    // Redis caído: se va DIRECTO al conteo contra la base. Intentar el camino de
    // Redis primero costaría dos agregados por intento (el de la siembra y el de
    // la degradación) justo cuando el sistema ya va tocado.
    if (!this.redis.isReady) return this.reserveFromDatabase(target, limit, quantity, at);

    // Sin await: corregir la deriva no debe alargar el intento de compra.
    void this.reconcile(target, ttl).catch(() => undefined);

    await this.ensureSeeded(target, ttl);

    const total = await this.redis.incrementWithTtl(key, quantity, ttl);
    if (total === null) return this.reserveFromDatabase(target, limit, quantity, at);

    if (total > limit) {
      // Devolver lo que acabamos de tomar: el incremento ya ocurrió y sin esto
      // un rechazo consumiría cupo que nadie llegó a usar.
      await this.redis.decrement(key, quantity);
      this.rejectExhausted(target, limit, Math.max(total - quantity, 0));
    }

    return { phaseId: target.id, quantity };
  }

  /**
   * Camino degradado, sin Redis.
   *
   * Contar y decidir por separado NO sirve: bajo carga real las peticiones
   * llegan a la vez, todas leen «consumido = 0» y todas pasan. Medido, un tope
   * del 30% dejaba entrar el 100% — no «unas pocas butacas» como suponía la
   * versión anterior de este comentario, sino el cupo entero.
   *
   * Se serializa con un lock consultivo de Postgres acotado a la fase: solo se
   * ponen en fila las compras de ESA fase, y solo mientras Redis esté caído.
   *
   * LÍMITE CONOCIDO, MEDIDO: el lock serializa la COMPROBACIÓN, pero el hold se
   * escribe después y fuera de esta transacción, así que el conteo no ve los
   * que están en vuelo. Con 100 compradores simultáneos sobre un tope de 30
   * entraron 81 (antes del lock entraban los 100). Sigue siendo un tope
   * aproximado, no exacto.
   *
   * Cerrarlo del todo exige que la comprobación de cupo y la escritura del hold
   * compartan transacción, lo que cruza la frontera entre este servicio y el de
   * inventario. Mientras tanto: con Redis en pie el tope es atómico y exacto;
   * sin Redis es aproximado y se avisa en el log.
   */
  private async reserveFromDatabase(
    target: PhaseQuotaTarget,
    limit: number,
    quantity: number,
    at: Date,
  ): Promise<null> {
    await this.prisma.$transaction(async (tx) => {
      // El lock vive lo que la transacción; no puede quedarse colgado.
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`sale-phase:${target.id}`}))`;

      const consumed = await this.countFromDatabase(target, at, tx);
      if (consumed + quantity > limit) this.rejectExhausted(target, limit, consumed);
    });
    // Sin recibo: el consumo se deriva de la base, no hay contador que devolver.
    return null;
  }

  /** Devuelve un cupo apartado que no llegó a convertirse en hold. */
  async release(handle: PhaseQuotaHandle | null): Promise<void> {
    if (!handle || handle.quantity <= 0) return;
    await this.redis.decrement(counterKey(handle.phaseId), handle.quantity);
  }

  /**
   * Consumo actual de una fase, para pintarlo en el backoffice.
   * Prefiere el contador (una lectura O(1)) y cae a la base si no hay ninguno.
   */
  async getUsage(target: PhaseQuotaTarget, capacity: number): Promise<PhaseQuotaUsage | null> {
    const limit = this.limitFor(target, capacity);
    if (limit === null) return null;

    const raw = await this.redis.get(counterKey(target.id));
    const counted = raw === null ? null : Number(raw);
    const fromCounter = counted !== null && Number.isFinite(counted);
    const consumed = fromCounter ? counted : await this.countFromDatabase(target, new Date());

    return {
      phaseId: target.id,
      allocationPercent: target.allocationPercent ?? 0,
      capacity,
      limit,
      consumed,
      remaining: Math.max(0, limit - consumed),
      fromCounter,
    };
  }

  /**
   * Butacas que la fase puede tomar, o `null` si no hay cupo que hacer cumplir.
   *
   * Un aforo sin definir NO se traduce en "cupo cero": bloquear toda la venta
   * porque falta un dato de configuración es peor que no aplicar el cupo.
   */
  private limitFor(target: PhaseQuotaTarget, capacity: number): number | null {
    const percent = target.allocationPercent;
    if (percent == null || percent <= 0 || percent >= 100) return null;
    if (!Number.isFinite(capacity) || capacity <= 0) return null;
    return Math.floor((capacity * percent) / 100);
  }

  private rejectExhausted(target: PhaseQuotaTarget, limit: number, consumed: number): never {
    throw new ForbiddenException({
      message:
        `El cupo de la fase «${target.name}» se agotó ` +
        `(${target.allocationPercent}% del aforo, ${limit} boletos).`,
      reason: 'PHASE_ALLOCATION_EXHAUSTED',
      phaseId: target.id,
      limit,
      remaining: Math.max(0, limit - consumed),
    });
  }

  /**
   * Deja la clave del contador existiendo y con el consumo real de la base.
   *
   * El `SET NX` es lo que hace segura la siembra concurrente: quien llegue
   * segundo ve que ya hay valor y no lo pisa. Si alguien incrementó entre la
   * lectura y el `SET NX`, la siembra se descarta y el contador arranca por
   * debajo — la reconciliación lo corrige en la siguiente pasada.
   */
  private async ensureSeeded(target: PhaseQuotaTarget, ttl: number): Promise<void> {
    const key = counterKey(target.id);
    if ((await this.redis.get(key)) !== null) return;

    const inFlight = this.seeding.get(key);
    if (inFlight) return inFlight;

    const task = this.seedCounter(target, ttl).finally(() => this.seeding.delete(key));
    this.seeding.set(key, task);
    return task;
  }

  private async seedCounter(target: PhaseQuotaTarget, ttl: number): Promise<void> {
    try {
      const consumed = await this.countFromDatabase(target, new Date());
      // `acquireLock` es un `SET key value NX EX`: aquí no se usa como candado
      // sino como "escribe el valor base sólo si nadie lo ha escrito ya".
      await this.redis.acquireLock(counterKey(target.id), String(consumed), ttl);
    } catch (error) {
      // Sembrar mal no debe tumbar la compra: sin siembra el contador arranca en
      // cero y la reconciliación lo sube al valor real en la siguiente pasada.
      this.logger.warn(
        `No se pudo sembrar el cupo de la fase ${target.id}: ${(error as Error).message}`,
      );
    }
  }

  /**
   * Contrasta el contador contra la base y corrige la DERIVA.
   *
   * Aquí es donde vuelve el cupo de un hold que expiró o de una orden que se
   * canceló: esos cambios ya están en la base, así que la diferencia aparece
   * sola sin que nadie tenga que avisar.
   *
   * La corrección es RELATIVA (`INCRBY`/`DECRBY` de la diferencia) y nunca un
   * `SET`: entre la lectura del contador y el agregado siguen entrando reservas,
   * y un `SET` las borraría. Se lee el contador ANTES de sellar el instante del
   * agregado a propósito: así una reserva que caiga en medio se cuenta de más
   * (se vende de menos, que es el lado seguro) y la siguiente pasada la cuadra.
   */
  private async reconcile(target: PhaseQuotaTarget, ttl: number): Promise<void> {
    // El candado NO se libera: su TTL es el intervalo. Un solo nodo por ventana.
    const acquired = await this.redis.acquireLock(
      reconcileKey(target.id),
      randomUUID(),
      RECONCILE_INTERVAL_SECONDS,
    );
    if (acquired !== 'ACQUIRED') return;

    const key = counterKey(target.id);
    const raw = await this.redis.get(key);
    if (raw === null) return; // aún sin sembrar: no hay nada que corregir
    const counted = Number(raw);
    if (!Number.isFinite(counted)) return;

    const actual = await this.countFromDatabase(target, new Date());
    const drift = counted - actual;
    if (drift === 0) return;

    if (drift > 0) {
      await this.redis.decrement(key, drift);
    } else {
      await this.redis.incrementWithTtl(key, -drift, ttl);
    }
    this.logger.log(
      `Cupo de la fase ${target.id} reconciliado: contador ${counted} → base ${actual}.`,
    );
  }

  /**
   * Consumo real de la fase según la base.
   *
   * Se cuenta sobre `SeatHold` y no sobre `Ticket` porque el cupo se aparta al
   * CREAR el hold — que es donde muerde la promesa: si no, 45.000 personas
   * pueden retener el 100% del aforo en preventa antes de pagar un peso.
   *
   * Cuenta lo que sigue ocupando aforo por cuenta de esta fase:
   *   - holds ACTIVE no vencidos (compras en curso),
   *   - holds CONVERTED (ya son boletos vendidos).
   * Un hold RELEASED, EXPIRED o vencido por reloj deja de contar solo.
   *
   * LIMITACIÓN: la fase se atribuye por la ventana de fechas del hold. Con fases
   * SOLAPADAS (que el modelo permite y resuelve por `priority`) un hold creado
   * en el solape se le imputa a las dos. La solución es `SeatHold.salePhaseId`;
   * ver la entrega.
   */
  private async countFromDatabase(
    target: PhaseQuotaTarget,
    at: Date,
    /** Cliente de la transacción cuando la cuenta va dentro del lock consultivo. */
    tx?: Pick<PrismaService, 'seatHold'>,
  ): Promise<number> {
    const windowEnd = target.endsAt < at ? target.endsAt : at;
    if (windowEnd <= target.startsAt) return 0;

    const aggregate = await (tx ?? this.prisma).seatHold.aggregate({
      where: {
        eventId: target.eventId,
        createdAt: { gte: target.startsAt, lte: windowEnd },
        OR: [
          { status: HoldStatus.CONVERTED },
          { status: HoldStatus.ACTIVE, expiresAt: { gt: at } },
        ],
      },
      _sum: { quantity: true },
    });
    return aggregate._sum.quantity ?? 0;
  }

  private counterTtl(target: PhaseQuotaTarget, at: Date): number {
    const remaining = Math.ceil((target.endsAt.getTime() - at.getTime()) / 1000);
    const ttl = remaining + COUNTER_TTL_MARGIN_SECONDS;
    return Math.min(Math.max(ttl, COUNTER_TTL_MIN_SECONDS), COUNTER_TTL_MAX_SECONDS);
  }
}
