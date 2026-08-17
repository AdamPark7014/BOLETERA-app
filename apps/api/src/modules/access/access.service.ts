import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { SalesChannel, TicketStatus } from '@prisma/client';
import {
  buildQrPayload,
  signEventManifest,
  ticketManifestDigest,
  verifyTicketSignature,
} from '@boletera/crypto';
import { PrismaService } from '../prisma/prisma.service';
import { AuditService } from '../../common/audit.service';
import { requireTicketQrSecret } from '../auth/jwt-secret';

/** Identidad del solicitante. Siempre sale del JWT, nunca del cuerpo (F2-14). */
export type Requester = {
  sub: string;
  email?: string;
  role?: string;
};

/**
 * Roles de ventanilla que pueden reimprimir el QR de un cliente (F2-04).
 * Es un caso real —el comprador llega sin batería o sin el correo— pero cada uso
 * queda auditado con actor, boleto y motivo: excepción explícita, nunca silenciosa.
 */
const QR_REISSUE_ROLES = new Set(['TAQUILLA', 'ADMIN', 'SUPER_ADMIN', 'VENUE_MANAGER']);

/** Tamaño máximo del lote de conciliación offline (F2-15). */
const MAX_SYNC_BATCH = 500;

/** Página por defecto y máxima del manifiesto. 45k boletos ≈ 45 páginas de 1000. */
const MANIFEST_PAGE_SIZE = 1000;
const MANIFEST_MAX_PAGE_SIZE = 5000;

/** Estados que un boleto puede tener y aun así presentarse en puerta. */
const MANIFEST_STATUSES = [TicketStatus.SOLD, TicketStatus.USED];

/**
 * Los identificadores son cuid (25 caracteres). Se acota antes de escribirlos en
 * `TicketScan`, porque los intentos fallidos se registran con el id que venía en
 * el QR y ese id es entrada no confiable.
 */
const MAX_ID_LENGTH = 64;

type QrPayload = { t: string; e: string; s: string };

type ScanContext = {
  zoneId?: string;
  scannedBy: string;
  channel: string;
};

@Injectable()
export class AccessService {
  constructor(
    private prisma: PrismaService,
    private audit: AuditService,
  ) {}

  /**
   * Escaneo en puerta.
   *
   * F2-06: antes esto era leer-validar-escribir. Con varias puertas abiertas y
   * ~500 escaneos/minuto, dos escáneres leían `SOLD` antes de que ninguno
   * escribiera, ambos pasaban la validación y ambos devolvían `success: true`:
   * el mismo boleto entraba dos veces. La rotación del QR cada 15 s no lo impide
   * porque las dos puertas ven la misma firma vigente.
   *
   * La transición `SOLD → USED` es ahora un único `updateMany` condicionado al
   * estado: la base decide el ganador y el perdedor obtiene `count === 0`.
   */
  async scanTicket(params: {
    ticketCode?: string;
    qrPayload?: string;
    zoneId?: string;
    scannedBy: string;
    channel: string;
    /** Hora real del escaneo. Solo la usa la conciliación offline. */
    scannedAt?: Date;
  }) {
    const scannedAt = params.scannedAt ?? new Date();
    // Se valida antes de tocar el boleto: `TicketScan.zoneId` es clave foránea y
    // una zona inventada convertiría el registro del escaneo en un 500.
    const zoneId = await this.resolveZoneId(params.zoneId);
    const context: ScanContext = {
      zoneId,
      scannedBy: params.scannedBy,
      channel: params.channel,
    };

    let ticketId: string | undefined;
    if (params.qrPayload) {
      const parsed = this.parseQrPayload(params.qrPayload);
      const valid = verifyTicketSignature(
        parsed.t,
        parsed.e,
        parsed.s,
        requireTicketQrSecret(),
      );
      if (!valid) {
        // Se registra con el id que venía en el QR: un mismo id apareciendo con
        // firmas inválidas en varias puertas es la señal de un intento de clonado.
        await this.recordScan(parsed.t, context, false, 'Invalid or expired QR signature', scannedAt);
        throw new BadRequestException('Invalid or expired QR');
      }
      ticketId = parsed.t;
    }

    if (!ticketId && !params.ticketCode) {
      throw new BadRequestException('ticketCode or qrPayload is required');
    }

    // Se prefiere el id del QR ya verificado; `ticketCode` es la entrada manual
    // de ventanilla y no lleva firma.
    const ticket = await this.prisma.ticket.findFirst({
      where: ticketId ? { id: ticketId } : { code: params.ticketCode },
      include: { event: { select: { title: true } } },
    });

    if (!ticket) {
      await this.recordScan(ticketId ?? '', context, false, 'Ticket not found', scannedAt);
      throw new NotFoundException('Ticket not found');
    }

    const claimed = await this.claimTicket(ticket.id, scannedAt);

    if (!claimed) {
      const failure = await this.describeFailedClaim(ticket.id);
      await this.recordScan(ticket.id, context, false, failure.reason, scannedAt);

      if (failure.alreadyUsed) {
        // 409, no 400: para el operador de puerta "ya escaneado" es información
        // distinta de "no válido" — uno se resuelve llamando a supervisión, el
        // otro rechazando al portador.
        throw new ConflictException({
          statusCode: 409,
          code: 'TICKET_ALREADY_SCANNED',
          message: failure.message,
          ticketCode: ticket.code,
          firstScanAt: failure.firstScanAt,
          firstScanZoneId: failure.firstScanZoneId,
          firstScanBy: failure.firstScanBy,
        });
      }

      throw new BadRequestException(failure.message);
    }

    await this.recordScan(ticket.id, context, true, undefined, scannedAt);

    await this.audit.log({
      action: 'ticket.scan',
      entityType: 'Ticket',
      entityId: ticket.id,
      userId: params.scannedBy,
      metadata: { zoneId, channel: params.channel },
    });

    return {
      success: true,
      ticket: {
        code: ticket.code,
        section: ticket.section,
        row: ticket.row,
        seatNumber: ticket.seatNumber,
        eventTitle: ticket.event.title,
      },
    };
  }

  /**
   * QR rotativo de un boleto.
   *
   * F2-04: este endpoint solo pedía sesión iniciada y devolvía el payload firmado
   * —exactamente el que acepta `scanTicket`— de cualquier boleto. Como el primer
   * escaneo marca `USED`, bastaba pedir el QR ajeno y entrar antes que el
   * comprador para dejarle fuera. Ahora se exige propiedad, con una excepción de
   * ventanilla auditada.
   */
  async getQrForTicket(
    ticketId: string,
    requester: Requester,
    opts: { reason?: string; ipAddress?: string } = {},
  ) {
    if (!requester?.sub) throw new ForbiddenException('Authenticated user required');

    const ticket = await this.prisma.ticket.findUnique({
      where: { id: ticketId },
      include: {
        orderItem: {
          select: { order: { select: { userId: true, buyerEmail: true } } },
        },
      },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');

    const order = ticket.orderItem?.order;
    const requesterEmail = requester.email?.trim().toLowerCase();
    const isOwner =
      !!order &&
      (order.userId === requester.sub ||
        (!!requesterEmail && order.buyerEmail?.trim().toLowerCase() === requesterEmail));

    if (!isOwner) {
      if (!QR_REISSUE_ROLES.has(requester.role ?? '')) {
        // Mismo mensaje que un boleto inexistente daría pistas de enumeración;
        // aquí el boleto sí existe, así que se responde 403 sin más detalle.
        throw new ForbiddenException('You are not the holder of this ticket');
      }

      await this.audit.log({
        action: 'access.qr.reissued_by_staff',
        entityType: 'Ticket',
        entityId: ticket.id,
        userId: requester.sub,
        ipAddress: opts.ipAddress,
        metadata: {
          actorRole: requester.role,
          actorEmail: requester.email,
          reason: opts.reason ?? 'not provided',
          orderUserId: order?.userId ?? null,
        },
      });
    }

    return {
      payload: buildQrPayload(ticket.id, ticket.eventId, requireTicketQrSecret()),
      reissuedByStaff: !isOwner,
    };
  }

  /**
   * Manifiesto firmado del evento (F2-15, primer escalón).
   *
   * Sin esto, cada escaneo es un viaje a la base y una caída de la red del recinto
   * detiene la fila entera. Con el manifiesto descargado antes de abrir puertas, el
   * dispositivo puede decidir sin red si un id pertenece al evento y en qué estado
   * estaba, y encolar el escaneo para `syncOfflineScans`.
   *
   * Se devuelven solo `id`, estado abreviado y una huella de 12 hex: 45k boletos
   * caben en ~2 MB de JSON, que con gzip de transporte baja a unos cientos de KB.
   */
  async getEventManifest(eventId: string, opts: { cursor?: string; limit?: number } = {}) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { id: true, title: true },
    });
    if (!event) throw new NotFoundException('Event not found');

    const limit = Math.min(Math.max(Number(opts.limit) || MANIFEST_PAGE_SIZE, 1), MANIFEST_MAX_PAGE_SIZE);

    // Se pide un elemento de más para saber si hay página siguiente sin contar.
    const rows = await this.prisma.ticket.findMany({
      where: { eventId, status: { in: MANIFEST_STATUSES } },
      select: { id: true, status: true },
      orderBy: { id: 'asc' },
      take: limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });

    const page = rows.slice(0, limit);
    const nextCursor = rows.length > limit ? page[page.length - 1]?.id ?? null : null;

    const secret = requireTicketQrSecret();
    const issuedAt = new Date().toISOString();
    const entries = page.map((t) => ({
      id: t.id,
      st: t.status === TicketStatus.USED ? 'U' : 'S',
      h: ticketManifestDigest(t.id, eventId, t.status, secret),
    }));

    return {
      v: 1,
      eventId,
      issuedAt,
      count: entries.length,
      nextCursor,
      entries,
      signature: signEventManifest(eventId, issuedAt, entries, secret),
    };
  }

  /**
   * Conciliación de escaneos hechos sin red (F2-15, primer escalón).
   *
   * Aplica la misma transición atómica que la puerta online, conservando la hora
   * real del escaneo. Un boleto escaneado en dos puertas distintas mientras había
   * corte NO invalida el lote: se registran ambos intentos en `TicketScan` y el
   * segundo sale en `conflicts` para que operaciones lo revise. Fallar el lote
   * entero por un duplicado dejaría sin registrar cientos de entradas legítimas.
   */
  async syncOfflineScans(params: {
    scannedBy: string;
    channel: string;
    scans: { ticketId: string; scannedAt?: string | Date; zoneId?: string }[];
  }) {
    const scans = params.scans;
    if (!Array.isArray(scans) || scans.length === 0) {
      throw new BadRequestException('scans must be a non-empty array');
    }
    if (scans.length > MAX_SYNC_BATCH) {
      throw new BadRequestException(`Batch too large: at most ${MAX_SYNC_BATCH} scans per request`);
    }

    const knownZones = await this.loadKnownZones(scans.map((s) => s.zoneId));

    const accepted: { ticketId: string; scannedAt: string }[] = [];
    const conflicts: {
      ticketId: string;
      attemptedAt: string;
      attemptedZoneId?: string;
      firstScanAt: string | null;
      firstScanZoneId: string | null;
      firstScanBy: string | null;
    }[] = [];
    const rejected: { ticketId: string; reason: string }[] = [];

    // Secuencial a propósito: 500 escrituras en paralelo agotarían el pool de
    // conexiones justo cuando las puertas que sí tienen red están en su pico.
    for (const scan of scans) {
      const ticketId = typeof scan.ticketId === 'string' ? scan.ticketId.trim() : '';
      if (!ticketId || ticketId.length > MAX_ID_LENGTH) {
        rejected.push({ ticketId: '', reason: 'Missing or malformed ticketId' });
        continue;
      }

      if (scan.zoneId && !knownZones.has(scan.zoneId)) {
        rejected.push({ ticketId, reason: `Unknown zone: ${scan.zoneId}` });
        continue;
      }

      // Un reloj desajustado en el dispositivo no debe descartar una entrada real.
      const scannedAt = this.parseScanDate(scan.scannedAt) ?? new Date();
      const context: ScanContext = {
        zoneId: scan.zoneId,
        scannedBy: params.scannedBy,
        channel: params.channel,
      };

      const ticket = await this.prisma.ticket.findUnique({
        where: { id: ticketId },
        select: { id: true },
      });
      if (!ticket) {
        await this.recordScan(ticketId, context, false, 'Ticket not found', scannedAt);
        rejected.push({ ticketId, reason: 'Ticket not found' });
        continue;
      }

      const claimed = await this.claimTicket(ticketId, scannedAt);
      if (claimed) {
        await this.recordScan(ticketId, context, true, 'Offline sync', scannedAt);
        accepted.push({ ticketId, scannedAt: scannedAt.toISOString() });
        continue;
      }

      const failure = await this.describeFailedClaim(ticketId);
      await this.recordScan(ticketId, context, false, `Offline sync · ${failure.reason}`, scannedAt);

      if (failure.alreadyUsed) {
        conflicts.push({
          ticketId,
          attemptedAt: scannedAt.toISOString(),
          attemptedZoneId: scan.zoneId,
          firstScanAt: failure.firstScanAt,
          firstScanZoneId: failure.firstScanZoneId,
          firstScanBy: failure.firstScanBy,
        });
      } else {
        rejected.push({ ticketId, reason: failure.reason });
      }
    }

    // Un evento de auditoría por lote, no por escaneo: 500 filas por sincronización
    // ahogarían la bitácora justo cuando hay que leerla.
    await this.audit.log({
      action: 'access.scans.sync',
      entityType: 'TicketScan',
      userId: params.scannedBy,
      metadata: {
        channel: params.channel,
        received: scans.length,
        accepted: accepted.length,
        conflicts: conflicts.length,
        rejected: rejected.length,
        conflictTicketIds: conflicts.map((c) => c.ticketId),
      },
    });

    return {
      received: scans.length,
      accepted,
      conflicts,
      rejected,
    };
  }

  /**
   * Candado real de la entrada: la condición `status: SOLD` viaja dentro del
   * `UPDATE`, así que la base serializa a los competidores y solo una puerta
   * obtiene `count === 1`.
   */
  private async claimTicket(ticketId: string, scannedAt: Date): Promise<boolean> {
    const claimed = await this.prisma.ticket.updateMany({
      where: { id: ticketId, status: TicketStatus.SOLD },
      data: { status: TicketStatus.USED, usedAt: scannedAt, checkedInAt: scannedAt },
    });
    return claimed.count > 0;
  }

  /**
   * Por qué falló la reclamación. Solo se ejecuta en la rama de rechazo, así que
   * las dos consultas extra no pesan en el camino feliz.
   */
  private async describeFailedClaim(ticketId: string) {
    const [current, firstScan] = await Promise.all([
      this.prisma.ticket.findUnique({
        where: { id: ticketId },
        select: { status: true, usedAt: true, checkedInAt: true },
      }),
      this.prisma.ticketScan.findFirst({
        where: { ticketId, success: true },
        orderBy: { scannedAt: 'asc' },
        select: { scannedAt: true, zoneId: true, scannedBy: true },
      }),
    ]);

    const alreadyUsed = current?.status === TicketStatus.USED;
    const firstScanAt = firstScan?.scannedAt ?? current?.usedAt ?? current?.checkedInAt ?? null;

    if (alreadyUsed) {
      const at = firstScanAt ? firstScanAt.toISOString() : 'an earlier time';
      const gate = firstScan?.zoneId ? ` at gate ${firstScan.zoneId}` : '';
      return {
        alreadyUsed: true,
        reason: 'Already used',
        message: `Ticket already scanned${gate} on ${at}`,
        firstScanAt: firstScanAt ? firstScanAt.toISOString() : null,
        firstScanZoneId: firstScan?.zoneId ?? null,
        firstScanBy: firstScan?.scannedBy ?? null,
      };
    }

    const status = current?.status ?? 'UNKNOWN';
    return {
      alreadyUsed: false,
      reason: `Invalid status: ${status}`,
      message: 'Ticket not valid for entry',
      firstScanAt: firstScanAt ? firstScanAt.toISOString() : null,
      firstScanZoneId: firstScan?.zoneId ?? null,
      firstScanBy: firstScan?.scannedBy ?? null,
    };
  }

  /** El QR debe ser JSON compacto `{v,t,e,s}`; `v` es opcional para los QR v1. */
  private parseQrPayload(raw: string): QrPayload {
    let parsed: Partial<QrPayload>;
    try {
      parsed = JSON.parse(raw) as Partial<QrPayload>;
    } catch {
      throw new BadRequestException('Malformed QR payload');
    }
    if (
      typeof parsed?.t !== 'string' ||
      typeof parsed?.e !== 'string' ||
      typeof parsed?.s !== 'string' ||
      parsed.t.length > MAX_ID_LENGTH ||
      parsed.e.length > MAX_ID_LENGTH ||
      parsed.s.length > MAX_ID_LENGTH
    ) {
      throw new BadRequestException('Malformed QR payload');
    }
    return { t: parsed.t, e: parsed.e, s: parsed.s };
  }

  /** `zoneId` inexistente se rechaza en vez de guardarse: si no, rompe la FK (F2-14). */
  private async resolveZoneId(zoneId?: string): Promise<string | undefined> {
    if (!zoneId) return undefined;
    const zone = await this.prisma.accessZone.findUnique({
      where: { id: zoneId },
      select: { id: true },
    });
    if (!zone) throw new BadRequestException(`Unknown access zone: ${zoneId}`);
    return zone.id;
  }

  /** Una sola consulta para todas las zonas del lote, no una por escaneo. */
  private async loadKnownZones(zoneIds: (string | undefined)[]): Promise<Set<string>> {
    const ids = [...new Set(zoneIds.filter((z): z is string => !!z))];
    if (ids.length === 0) return new Set<string>();
    const zones = await this.prisma.accessZone.findMany({
      where: { id: { in: ids } },
      select: { id: true },
    });
    return new Set(zones.map((z) => z.id));
  }

  private parseScanDate(value?: string | Date): Date | undefined {
    if (!value) return undefined;
    const date = value instanceof Date ? value : new Date(value);
    return Number.isNaN(date.getTime()) ? undefined : date;
  }

  private async recordScan(
    ticketId: string,
    params: ScanContext,
    success: boolean,
    reason?: string,
    scannedAt?: Date,
  ) {
    if (!ticketId) return;
    await this.prisma.ticketScan.create({
      data: {
        ticketId,
        zoneId: params.zoneId,
        scannedBy: params.scannedBy,
        channel: this.toSalesChannel(params.channel),
        success,
        reason,
        ...(scannedAt ? { scannedAt } : {}),
      },
    });
  }

  private toSalesChannel(channel?: string): SalesChannel {
    switch (channel?.toUpperCase()) {
      case 'TAQUILLA':
        return SalesChannel.TAQUILLA;
      case 'API':
        return SalesChannel.API;
      case 'ADMIN':
        return SalesChannel.ADMIN;
      default:
        return SalesChannel.WEB;
    }
  }
}
