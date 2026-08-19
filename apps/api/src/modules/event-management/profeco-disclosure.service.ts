import { BadRequestException, Injectable, Logger, NotFoundException } from '@nestjs/common';
import { createHash } from 'crypto';
import { priceBreakdown } from '../../common/pricing-rates';
import { RedisService } from '../../common/redis.service';
import { PrismaService } from '../prisma/prisma.service';

/**
 * Divulgación previa a la venta — lineamientos de PROFECO.
 *
 * PROFECO publicó en el DOF el 19 de febrero de 2026 lineamientos vinculantes
 * para la venta de boletos de espectáculos masivos. Los que este servicio
 * implementa son tres:
 *
 *  1. Publicar, **al menos 24 horas antes de la primera venta**, el plano del
 *     recinto con sus secciones, el número de asientos por sección, los
 *     términos, y el **precio total** por sección.
 *  2. Garantizar **disponibilidad real** en todas las secciones durante cada
 *     fase de venta.
 *  3. Mostrar el precio total desde el inicio, sin incrementos al final.
 *
 * Aplican a eventos de más de 20.000 asistentes. Por debajo de ese aforo NO
 * aplican, y bloquear una venta pequeña por no cumplirlos sería un error: la
 * ley no lo pide y el promotor perdería ventas por nada.
 *
 * ── Por qué se guarda el contenido y no una fecha ──
 *
 * Un campo `divulgadoEn` prueba *cuándo*, no *qué*. Ante una revisión de
 * PROFECO hay que poder enseñar el precio y el aforo por sección que estaban
 * publicados en aquel momento, no los de hoy. Por eso cada publicación es una
 * fila nueva e inmutable con su hash: el historial es la prueba.
 */

/** Aforo a partir del cual aplican los lineamientos del DOF (19-feb-2026). */
const CAPACITY_THRESHOLD = envInt('PROFECO_CAPACITY_THRESHOLD', 20_000);

/** Antelación mínima exigida entre la divulgación y la primera venta. */
const LEAD_HOURS = envInt('PROFECO_DISCLOSURE_LEAD_HOURS', 24);

const LEAD_MS = LEAD_HOURS * 60 * 60 * 1000;

/**
 * Vida de la caché de hechos. Corta a propósito: si un promotor corrige un
 * incumplimiento, el sistema debe enterarse en segundos, no en minutos.
 */
const FACTS_TTL_SECONDS = envInt('PROFECO_FACTS_TTL_SECONDS', 30);

const factsKey = (eventId: string) => `profeco:disclosed:${eventId}`;

/** Lo mínimo del evento para decidir si aplican los lineamientos y desde cuándo. */
export type EventFacts = { salesStartAt: Date | null; totalCapacity: number };

function envInt(name: string, fallback: number): number {
  const parsed = Number(process.env[name]);
  return Number.isInteger(parsed) && parsed >= 0 ? parsed : fallback;
}

/** Una sección tal y como debe divulgarse. */
export type DisclosedSection = {
  /** Nombre de cara al público; es el que aparece en el plano. */
  zone: string;
  /** Asientos puestos a la venta en esta sección. */
  seats: number;
  /** Precio base, antes de cargos. Se muestra solo como desglose. */
  basePrice: number;
  serviceFee: number;
  taxes: number;
  /**
   * Lo que el comprador paga de verdad. Es el número que exige el lineamiento
   * y el que debe ir más prominente que cualquier precio parcial.
   */
  totalPrice: number;
  currency: string;
};

export type DisclosurePayload = {
  eventId: string;
  title: string;
  startsAt: string;
  timezone: string;
  venue: { id: string; name: string; address: string | null };
  /**
   * Plano del recinto con sus secciones. Sin él la divulgación está incompleta:
   * el lineamiento pide «plano del recinto con secciones identificadas», no una
   * lista de nombres. Se referencia la instantánea publicada (`EventSeatMap`),
   * no el trazado vivo del recinto, para que lo divulgado no cambie por debajo
   * si alguien edita el mapa después.
   */
  seatMap: { layoutId: string; publishedAt: string; sections: string[] } | null;
  /**
   * Aforo del evento, que es lo que el lineamiento mide («más de 20.000
   * asistentes»). Se toma el MAYOR entre el aforo declarado y los asientos
   * realmente puestos a la venta: si se ofertan más boletos que el aforo
   * declarado, manda lo ofertado — quedarse con la cifra menor sería eludir
   * unos lineamientos que sí aplican.
   */
  capacity: number;
  sections: DisclosedSection[];
  /** Fases de venta anunciadas, con su ventana. */
  phases: { name: string; startsAt: string; endsAt: string; requiresCode: boolean }[];
  terms: string;
  /**
   * Lo que falta para una divulgación impecable, pero NO impide publicar.
   *
   * El plano de butacas es el caso claro: el lineamiento pide «plano del
   * recinto con secciones identificadas», y un festival de admisión general no
   * tiene mapa de asientos aunque sea masivo. Bloquear ahí impediría vender a
   * quien sí puede hacerlo legalmente. Se publica la carencia en vez de
   * esconderla: queda a la vista del comprador y del inspector, que es la
   * presión que de verdad la corrige.
   */
  warnings: string[];
  /** Se deja explícito para que el lector sepa si le amparaban o no. */
  regime: {
    source: 'PROFECO · DOF 19-feb-2026';
    appliesAboveCapacity: number;
    applies: boolean;
    leadHours: number;
  };
};

export type DisclosureRecord = {
  id: string;
  publishedAt: Date;
  contentHash: string;
  capacity: number;
  payload: DisclosurePayload;
};

export type ComplianceVerdict = {
  /** `false` solo cuando aplican los lineamientos y no se cumplen. */
  compliant: boolean;
  /** `false` si el evento no llega al umbral de aforo. */
  applies: boolean;
  reason:
    | 'OK'
    | 'BELOW_THRESHOLD'
    | 'NOT_PUBLISHED'
    | 'PUBLISHED_TOO_LATE'
    | 'NO_SALE_START';
  message: string;
  publishedAt: Date | null;
  /** Instante a partir del cual la venta puede abrir legalmente. */
  earliestSaleAt: Date | null;
};

@Injectable()
export class ProfecoDisclosureService {
  private readonly logger = new Logger(ProfecoDisclosureService.name);

  constructor(
    private readonly prisma: PrismaService,
    private readonly redis: RedisService,
  ) {}

  // ---------------------------------------------------------------------------
  // Construcción
  // ---------------------------------------------------------------------------

  /**
   * Arma la divulgación con los datos vivos del evento.
   *
   * No persiste nada: sirve tanto para previsualizar en el backoffice antes de
   * publicar como para construir la instantánea que sí se guarda.
   */
  async buildSnapshot(eventId: string): Promise<DisclosurePayload> {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      include: {
        venue: true,
        offers: { orderBy: { basePrice: 'asc' } },
        salePhases: { orderBy: { startsAt: 'asc' } },
        seatMap: { include: { layout: { include: { sections: { select: { name: true } } } } } },
      },
    });
    if (!event) throw new NotFoundException(`Evento ${eventId} no encontrado`);

    // Una sección puede tener varias ofertas (early bird, general...). Para el
    // público la sección es una sola, así que se agregan: los asientos suman y
    // el precio divulgado es el MÁS ALTO de la sección. Divulgar el más bajo
    // sería precisamente el reclamo publicitario engañoso que se persigue.
    const byZone = new Map<string, { seats: number; base: number; currency: string }>();
    for (const offer of event.offers) {
      const zone = offer.zone?.trim() || offer.name?.trim() || 'General';
      const base = Number(offer.basePrice);
      const current = byZone.get(zone);
      if (current) {
        current.seats += offer.totalQuantity;
        current.base = Math.max(current.base, base);
      } else {
        byZone.set(zone, { seats: offer.totalQuantity, base, currency: offer.currency });
      }
    }

    const sections: DisclosedSection[] = [...byZone.entries()]
      .map(([zone, agg]) => {
        const breakdown = priceBreakdown(agg.base);
        return {
          zone,
          seats: agg.seats,
          basePrice: breakdown.base,
          serviceFee: breakdown.fees,
          taxes: breakdown.taxes,
          totalPrice: breakdown.total,
          currency: agg.currency,
        };
      })
      .sort((a, b) => a.totalPrice - b.totalPrice);

    const offeredSeats = sections.reduce((sum, s) => sum + s.seats, 0);
    const capacity = Math.max(offeredSeats, event.totalCapacity);

    return {
      eventId: event.id,
      title: event.title,
      startsAt: event.startsAt.toISOString(),
      timezone: event.timezone,
      venue: {
        id: event.venue.id,
        name: event.venue.name,
        address: this.venueAddress(event.venue),
      },
      seatMap: event.seatMap
        ? {
            layoutId: event.seatMap.layoutId,
            publishedAt: event.seatMap.publishedAt.toISOString(),
            sections: event.seatMap.layout.sections.map((s) => s.name),
          }
        : null,
      capacity,
      sections,
      phases: event.salePhases.map((phase) => ({
        name: phase.name,
        startsAt: phase.startsAt.toISOString(),
        endsAt: phase.endsAt.toISOString(),
        requiresCode: Boolean(phase.code),
      })),
      terms: this.terms(event.title),
      warnings: this.warnings({ seatMap: event.seatMap, applies: capacity > CAPACITY_THRESHOLD }),
      regime: {
        source: 'PROFECO · DOF 19-feb-2026',
        appliesAboveCapacity: CAPACITY_THRESHOLD,
        applies: capacity > CAPACITY_THRESHOLD,
        leadHours: LEAD_HOURS,
      },
    };
  }

  // ---------------------------------------------------------------------------
  // Publicación
  // ---------------------------------------------------------------------------

  /**
   * Publica la divulgación y la deja asentada.
   *
   * Rechaza publicar una divulgación incompleta: publicar algo que no cumple y
   * quedarse tranquilo es peor que no publicar, porque deja constancia fechada
   * de que se sabía y aun así se abrió la venta.
   */
  async publish(eventId: string, publishedBy?: string): Promise<DisclosureRecord> {
    const payload = await this.buildSnapshot(eventId);

    const faltantes: string[] = [];
    if (!payload.sections.length) faltantes.push('no hay secciones con inventario');
    if (payload.sections.some((s) => s.seats <= 0))
      faltantes.push('alguna sección declara cero asientos');
    if (payload.sections.some((s) => s.totalPrice <= 0))
      faltantes.push('alguna sección no tiene precio');

    if (faltantes.length) {
      throw new BadRequestException(
        `No se puede divulgar todavía: ${faltantes.join('; ')}.`,
      );
    }

    const contentHash = hashPayload(payload);

    const row = await this.prisma.eventDisclosure.create({
      data: {
        eventId,
        payload: payload as unknown as object,
        contentHash,
        capacity: payload.capacity,
        publishedBy: publishedBy ?? null,
      },
    });

    // Sin esto, publicar no surtiría efecto hasta que expirara la caché y el
    // promotor vería «no cumple» justo después de haber cumplido.
    await this.redis.del(factsKey(eventId));

    this.logger.log(
      `Divulgación publicada para ${eventId}: ${payload.sections.length} secciones, ` +
        `aforo ${payload.capacity}, ${payload.regime.applies ? 'SUJETA' : 'no sujeta'} a los lineamientos`,
    );

    return {
      id: row.id,
      publishedAt: row.publishedAt,
      contentHash: row.contentHash,
      capacity: row.capacity,
      payload,
    };
  }

  /**
   * Aforo y fecha de venta. Solo se consulta cuando quien llama no los aporta.
   *
   * El camino de venta YA los tiene cargados (`resolveWindow` los selecciona),
   * así que pasárselos evita repetir la consulta en el punto más caliente del
   * sistema. Y al no cachearlos, cambiar la fecha de venta surte efecto al
   * instante: no hay que acordarse de invalidar nada en los muchos sitios que
   * actualizan un evento — y olvidarse en uno solo sería un fallo silencioso.
   */
  private async eventFacts(eventId: string): Promise<EventFacts> {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { salesStartAt: true, totalCapacity: true },
    });
    if (!event) throw new NotFoundException(`Evento ${eventId} no encontrado`);
    return event;
  }

  /**
   * Instante de la última divulgación, cacheado.
   *
   * Este sí se cachea porque solo cambia al publicar, y `publish` invalida.
   * Medido: la consulta cuesta ~2 ms y se ejecutaba en CADA intento de reserva;
   * a 1.000 reservas por segundo son 2 segundos de base por segundo dedicados a
   * releer una fecha que casi nunca cambia.
   */
  private async lastPublishedAt(eventId: string): Promise<Date | null> {
    const key = factsKey(eventId);
    const cached = await this.redis.getJson<{ at: string | null }>(key);
    if (cached) return cached.at ? new Date(cached.at) : null;

    const row = await this.prisma.eventDisclosure.findFirst({
      where: { eventId },
      orderBy: { publishedAt: 'desc' },
      select: { publishedAt: true },
    });
    await this.redis.setJson(key, { at: row?.publishedAt.toISOString() ?? null }, FACTS_TTL_SECONDS);
    return row?.publishedAt ?? null;
  }

  /** Última divulgación publicada. Lectura pública. */
  async getLatest(eventId: string): Promise<DisclosureRecord | null> {
    const row = await this.prisma.eventDisclosure.findFirst({
      where: { eventId },
      orderBy: { publishedAt: 'desc' },
    });
    if (!row) return null;
    return {
      id: row.id,
      publishedAt: row.publishedAt,
      contentHash: row.contentHash,
      capacity: row.capacity,
      payload: row.payload as unknown as DisclosurePayload,
    };
  }

  // ---------------------------------------------------------------------------
  // Cumplimiento
  // ---------------------------------------------------------------------------

  /**
   * ¿Puede abrir la venta de este evento?
   *
   * Devuelve un veredicto en vez de lanzar: quien llama decide si bloquea (la
   * venta) o solo avisa (el backoffice, que debe poder enseñar el problema
   * antes de que sea tarde).
   */
  async check(
    eventId: string,
    now: Date = new Date(),
    known?: EventFacts,
  ): Promise<ComplianceVerdict> {
    const event = known ?? (await this.eventFacts(eventId));
    const capacity = event.totalCapacity;

    if (capacity <= CAPACITY_THRESHOLD) {
      return {
        compliant: true,
        applies: false,
        reason: 'BELOW_THRESHOLD',
        message:
          `Aforo ${capacity}: por debajo de ${CAPACITY_THRESHOLD}, no le aplican los ` +
          'lineamientos de PROFECO del 19-feb-2026.',
        publishedAt: null,
        earliestSaleAt: null,
      };
    }

    const publishedAt = await this.lastPublishedAt(eventId);
    const latest = publishedAt ? { publishedAt } : null;
    if (!latest) {
      return {
        compliant: false,
        applies: true,
        reason: 'NOT_PUBLISHED',
        message:
          `Aforo ${capacity}: hay que divulgar plano, asientos y precio total por sección ` +
          `al menos ${LEAD_HOURS} h antes de la primera venta (PROFECO, DOF 19-feb-2026).`,
        publishedAt: null,
        earliestSaleAt: null,
      };
    }

    const earliestSaleAt = new Date(latest.publishedAt.getTime() + LEAD_MS);

    // El incumplimiento se mide contra el inicio de venta ANUNCIADO, no contra
    // el reloj: la infracción es abrir antes de tiempo, y eso se sabe desde que
    // se programa la venta, no cuando ya ocurrió.
    const saleStart = event.salesStartAt;
    if (!saleStart) {
      return {
        compliant: now >= earliestSaleAt,
        applies: true,
        reason: now >= earliestSaleAt ? 'OK' : 'NO_SALE_START',
        message:
          now >= earliestSaleAt
            ? `Divulgado el ${fmt(latest.publishedAt)}; las ${LEAD_HOURS} h ya transcurrieron.`
            : `El evento no tiene inicio de venta programado y aún no pasan las ${LEAD_HOURS} h ` +
              `desde la divulgación. La venta no puede abrir antes de ${fmt(earliestSaleAt)}.`,
        publishedAt: latest.publishedAt,
        earliestSaleAt,
      };
    }

    if (saleStart.getTime() < earliestSaleAt.getTime()) {
      return {
        compliant: false,
        applies: true,
        reason: 'PUBLISHED_TOO_LATE',
        message:
          `La venta abre el ${fmt(saleStart)} pero la divulgación es del ${fmt(latest.publishedAt)}: ` +
          `no llegan las ${LEAD_HOURS} h. No puede abrir antes de ${fmt(earliestSaleAt)}.`,
        publishedAt: latest.publishedAt,
        earliestSaleAt,
      };
    }

    return {
      compliant: true,
      applies: true,
      reason: 'OK',
      message: `Divulgado el ${fmt(latest.publishedAt)}, ${LEAD_HOURS} h antes de la venta.`,
      publishedAt: latest.publishedAt,
      earliestSaleAt,
    };
  }

  // ---------------------------------------------------------------------------
  // Disponibilidad real por sección
  // ---------------------------------------------------------------------------

  /**
   * Disponibilidad viva por sección.
   *
   * El lineamiento exige «garantizar disponibilidad real en todas las secciones
   * durante cada fase». Sin un punto donde consultarlo, ni el comprador puede
   * comprobarlo ni el promotor puede demostrarlo.
   *
   * Se lee de `Offer`, que es donde vive el contador que la venta decrementa,
   * de modo que lo publicado y lo vendible no pueden divergir.
   */
  async availability(eventId: string): Promise<{
    eventId: string;
    observedAt: string;
    sections: {
      zone: string;
      total: number;
      available: number;
      held: number;
      sold: number;
      totalPrice: number;
      currency: string;
      soldOut: boolean;
    }[];
    totals: { total: number; available: number; sold: number };
  }> {
    const offers = await this.prisma.offer.findMany({
      where: { eventId },
      select: {
        zone: true,
        name: true,
        basePrice: true,
        currency: true,
        totalQuantity: true,
        remainingQuantity: true,
        holdQuantity: true,
        soldQuantity: true,
      },
    });
    if (!offers.length) throw new NotFoundException(`Evento ${eventId} sin inventario`);

    const byZone = new Map<
      string,
      { total: number; available: number; held: number; sold: number; base: number; currency: string }
    >();
    for (const offer of offers) {
      const zone = offer.zone?.trim() || offer.name?.trim() || 'General';
      const acc = byZone.get(zone) ?? {
        total: 0,
        available: 0,
        held: 0,
        sold: 0,
        base: 0,
        currency: offer.currency,
      };
      acc.total += offer.totalQuantity;
      acc.available += offer.remainingQuantity;
      acc.held += offer.holdQuantity;
      acc.sold += offer.soldQuantity;
      acc.base = Math.max(acc.base, Number(offer.basePrice));
      byZone.set(zone, acc);
    }

    const sections = [...byZone.entries()]
      .map(([zone, a]) => ({
        zone,
        total: a.total,
        available: a.available,
        held: a.held,
        sold: a.sold,
        totalPrice: priceBreakdown(a.base).total,
        currency: a.currency,
        soldOut: a.available <= 0,
      }))
      .sort((a, b) => a.totalPrice - b.totalPrice);

    return {
      eventId,
      observedAt: new Date().toISOString(),
      sections,
      totals: {
        total: sections.reduce((s, x) => s + x.total, 0),
        available: sections.reduce((s, x) => s + x.available, 0),
        sold: sections.reduce((s, x) => s + x.sold, 0),
      },
    };
  }

  // ---------------------------------------------------------------------------

  private warnings(input: { seatMap: unknown; applies: boolean }): string[] {
    const out: string[] = [];
    if (input.applies && !input.seatMap) {
      out.push(
        'No hay plano de butacas publicado. Para eventos con asiento numerado el ' +
          'lineamiento pide un plano del recinto con las secciones identificadas.',
      );
    }
    return out;
  }

  private venueAddress(venue: { address?: string | null; city?: string | null }): string | null {
    const parts = [venue.address, venue.city].filter(Boolean);
    return parts.length ? parts.join(', ') : null;
  }

  private terms(title: string): string {
    return (
      `Boletos para «${title}». El precio mostrado por sección es el TOTAL a pagar e incluye ` +
      'cargo por servicio e IVA; no se añaden cargos en el checkout. En caso de cancelación se ' +
      'reembolsa el monto total pagado, cargos incluidos, más una bonificación no menor al 20% ' +
      'cuando la causa sea imputable al promotor (LFPC art. 92 Bis). La disponibilidad por ' +
      'sección puede consultarse en tiempo real durante toda la venta.'
    );
  }
}

/**
 * Hash del contenido divulgado.
 *
 * Las claves se ordenan antes de serializar: sin eso, dos publicaciones con los
 * mismos datos pero distinto orden de propiedades darían hashes distintos y el
 * hash no probaría nada.
 */
export function hashPayload(payload: unknown): string {
  return createHash('sha256').update(canonicalize(payload)).digest('hex');
}

function canonicalize(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonicalize).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalize(v)}`).join(',')}}`;
}

function fmt(date: Date): string {
  return date.toISOString().replace('T', ' ').slice(0, 16) + ' UTC';
}
