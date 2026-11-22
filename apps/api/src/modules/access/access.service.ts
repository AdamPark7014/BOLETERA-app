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
import {
  SCAN_REASON_ENTRY,
  SCAN_REASON_EXIT,
  SCAN_REASON_REENTRY,
  accessConfigFromTicket,
  assertGateAllows,
  buildTicketPayload,
  isEntryReason,
  lastSuccessReason,
  reentryCount,
  summarizeGateTraffic,
  ticketIsInside,
} from './access.flow';

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
    private audit: AuditService
  ) {}

  /**
   * Escaneo en puerta (entrada, salida o reingreso).
   *
   * F2-06: antes esto era leer-validar-escribir. Con varias puertas abiertas y
   * ~500 escaneos/minuto, dos escáneres leían `SOLD` antes de que ninguno
   * escribiera, ambos pasaban la validación y ambos devolvían `success: true`:
   * el mismo boleto entraba dos veces. La rotación del QR cada 15 s no lo impide
   * porque las dos puertas ven la misma firma vigente.
   *
   * La transición `SOLD → USED` es ahora un único `updateMany` condicionado al
   * estado: la base decide el ganador y el perdedor obtiene `count === 0`.
   *
   * Salida y reingreso se distinguen en `TicketScan.reason` (EXIT / REENTRY /
   * ENTRY) sin migración. La config vive en `event.metadata.access`.
   */
  async scanTicket(params: {
    ticketCode?: string;
    qrPayload?: string;
    zoneId?: string;
    scannedBy: string;
    channel: string;
    /** Hora real del escaneo. Solo la usa la conciliación offline. */
    scannedAt?: Date;
    /**
     * Función que controla esta puerta. Si viene, un boleto de otra función se
     * rechaza ANTES de marcarlo usado: sin esto, un boleto de otro evento
     * entraba («Éxito») y además quedaba quemado para su propia función.
     */
    eventId?: string;
    /** Organización y rol del escáner (del JWT) para acotar `eventId`. */
    scannerOrganizationId?: string | null;
    scannerRole?: string;
    /** ENTRY (omisión) o EXIT para registrar una salida. */
    mode?: 'ENTRY' | 'EXIT';
  }) {
    if (params.eventId) {
      await this.assertGateEvent(params.eventId, params.scannerOrganizationId, params.scannerRole);
    }
    const scannedAt = params.scannedAt ?? new Date();
    const mode = params.mode === 'EXIT' ? 'EXIT' : 'ENTRY';
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

      // La version de la clave se lee de la BASE, no del QR: si viniera en el
      // payload, quien regalo el boleto solo tendria que mandar la suya para
      // seguir entrando. Es el dato que invalida su copia.
      const version = await this.prisma.ticket.findUnique({
        where: { id: parsed.t },
        select: { keyEpoch: true },
      });

      const valid = verifyTicketSignature(
        parsed.t,
        parsed.e,
        parsed.s,
        requireTicketQrSecret(),
        version?.keyEpoch ?? 0
      );
      if (!valid) {
        // Se registra con el id que venía en el QR: un mismo id apareciendo con
        // firmas inválidas en varias puertas es la señal de un intento de clonado.
        await this.recordScan(
          parsed.t,
          context,
          false,
          'Invalid or expired QR signature',
          scannedAt
        );
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
      include: {
        event: { select: { title: true, metadata: true } },
        offer: { select: { name: true, zone: true } },
      },
    });

    if (!ticket) {
      await this.recordScan(ticketId ?? '', context, false, 'Ticket not found', scannedAt);
      throw new NotFoundException('Ticket not found');
    }

    if (params.eventId && ticket.eventId !== params.eventId) {
      await this.recordScan(ticket.id, context, false, 'Wrong event', scannedAt);
      throw new BadRequestException({
        statusCode: 400,
        code: 'WRONG_EVENT',
        message: `El boleto es de otra función: ${ticket.event.title}`,
        ticketCode: ticket.code,
        ticketEventTitle: ticket.event.title,
      });
    }

    const accessCfg = accessConfigFromTicket(ticket);
    const gateCheck = assertGateAllows(zoneId, ticket, accessCfg);
    if (gateCheck.ok === false) {
      await this.recordScan(ticket.id, context, false, 'Wrong gate', scannedAt);
      throw new BadRequestException({
        statusCode: 400,
        code: 'WRONG_GATE',
        message: `Este boleto entra por la puerta ${gateCheck.label}`,
        correctGateLabel: gateCheck.label,
        ticketCode: ticket.code,
      });
    }

    const payload = buildTicketPayload(ticket);

    if (mode === 'EXIT') {
      const inside = await ticketIsInside(this.prisma, ticket.id, ticket.status);
      if (!inside) {
        await this.recordScan(ticket.id, context, false, 'Not inside', scannedAt);
        throw new BadRequestException({
          statusCode: 400,
          code: 'NOT_INSIDE',
          message: 'Este boleto no está dentro del recinto',
          ticketCode: ticket.code,
        });
      }
      await this.recordScan(ticket.id, context, true, SCAN_REASON_EXIT, scannedAt);
      await this.audit.log({
        action: 'ticket.exit',
        entityType: 'Ticket',
        entityId: ticket.id,
        userId: params.scannedBy,
        metadata: { zoneId, channel: params.channel },
      });
      return { success: true, action: 'EXIT' as const, ticket: payload };
    }

    // Reingreso: ya USED, última acción fue salida, y el evento lo permite.
    if (ticket.status === TicketStatus.USED) {
      const last = await lastSuccessReason(this.prisma, ticket.id);
      if (last === SCAN_REASON_EXIT && accessCfg.reentryAllowed) {
        const used = await reentryCount(this.prisma, ticket.id);
        if (used < accessCfg.maxReentries) {
          await this.recordScan(ticket.id, context, true, SCAN_REASON_REENTRY, scannedAt);
          await this.audit.log({
            action: 'ticket.reentry',
            entityType: 'Ticket',
            entityId: ticket.id,
            userId: params.scannedBy,
            metadata: { zoneId, channel: params.channel, reentry: used + 1 },
          });
          return { success: true, action: 'REENTRY' as const, ticket: payload };
        }
      }
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

    await this.recordScan(ticket.id, context, true, SCAN_REASON_ENTRY, scannedAt);

    await this.audit.log({
      action: 'ticket.scan',
      entityType: 'Ticket',
      entityId: ticket.id,
      userId: params.scannedBy,
      metadata: { zoneId, channel: params.channel },
    });

    return {
      success: true,
      action: 'ENTRY' as const,
      ticket: payload,
    };
  }

  /**
   * Búsqueda manual por nombre, correo o folio para quien no trae el teléfono.
   */
  async searchTickets(
    eventId: string,
    q: string,
    scope: { organizationId?: string | null; role?: string }
  ) {
    await this.assertGateEvent(eventId, scope.organizationId, scope.role);
    const needle = q.trim();
    if (needle.length < 2) {
      throw new BadRequestException('Escribe al menos 2 caracteres para buscar');
    }
    const rows = await this.prisma.ticket.findMany({
      where: {
        eventId,
        status: { in: [TicketStatus.SOLD, TicketStatus.USED, TicketStatus.RESOLD] },
        OR: [
          { code: { equals: needle, mode: 'insensitive' } },
          { code: { contains: needle, mode: 'insensitive' } },
          { buyerName: { contains: needle, mode: 'insensitive' } },
          { buyerEmail: { contains: needle, mode: 'insensitive' } },
        ],
      },
      take: 20,
      orderBy: { buyerName: 'asc' },
      include: { offer: { select: { name: true, zone: true } } },
    });
    return {
      tickets: rows.map((t) => ({
        id: t.id,
        code: t.code,
        buyerName: t.buyerName,
        buyerEmail: t.buyerEmail,
        section: t.section,
        row: t.row,
        seatNumber: t.seatNumber,
        status: t.status,
        holderName: t.buyerName?.trim() || null,
        ticketType: t.offer?.name || t.offer?.zone || null,
      })),
    };
  }

  /**
   * Admisión (o salida) tras confirmar el nombre del titular. Queda en bitácora.
   */
  async confirmManualAdmit(params: {
    eventId: string;
    ticketId: string;
    confirmedName: string;
    scannedBy: string;
    zoneId?: string;
    channel: string;
    scannerOrganizationId?: string | null;
    scannerRole?: string;
    mode?: 'ENTRY' | 'EXIT';
  }) {
    await this.assertGateEvent(params.eventId, params.scannerOrganizationId, params.scannerRole);
    const ticket = await this.prisma.ticket.findFirst({
      where: { id: params.ticketId, eventId: params.eventId },
      select: { id: true, code: true, buyerName: true },
    });
    if (!ticket) throw new NotFoundException('Ticket not found');

    const expected = (ticket.buyerName ?? '').trim().toLowerCase();
    const got = params.confirmedName.trim().toLowerCase();
    if (!expected || expected !== got) {
      throw new BadRequestException({
        statusCode: 400,
        code: 'CONFIRMED_NAME_MISMATCH',
        message: 'El nombre no coincide con el titular del boleto',
      });
    }

    await this.audit.log({
      action: 'access.manual_lookup_admit',
      entityType: 'Ticket',
      entityId: ticket.id,
      userId: params.scannedBy,
      metadata: {
        confirmedName: params.confirmedName.trim(),
        mode: params.mode ?? 'ENTRY',
        zoneId: params.zoneId,
        channel: params.channel,
      },
    });

    return this.scanTicket({
      ticketCode: ticket.code,
      zoneId: params.zoneId,
      scannedBy: params.scannedBy,
      channel: params.channel,
      eventId: params.eventId,
      scannerOrganizationId: params.scannerOrganizationId,
      scannerRole: params.scannerRole,
      mode: params.mode === 'EXIT' ? 'EXIT' : 'ENTRY',
    });
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
    opts: { reason?: string; ipAddress?: string } = {}
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

    const limit = Math.min(
      Math.max(Number(opts.limit) || MANIFEST_PAGE_SIZE, 1),
      MANIFEST_MAX_PAGE_SIZE
    );

    // Se pide un elemento de más para saber si hay página siguiente sin contar.
    const rows = await this.prisma.ticket.findMany({
      where: { eventId, status: { in: MANIFEST_STATUSES } },
      select: { id: true, status: true },
      orderBy: { id: 'asc' },
      take: limit + 1,
      ...(opts.cursor ? { cursor: { id: opts.cursor }, skip: 1 } : {}),
    });

    const page = rows.slice(0, limit);
    const nextCursor = rows.length > limit ? (page[page.length - 1]?.id ?? null) : null;

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
    scans: { ticketId: string; scannedAt?: string | Date; zoneId?: string; mode?: string }[];
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
      const mode = scan.mode?.toUpperCase() === 'EXIT' ? 'EXIT' : 'ENTRY';

      const ticket = await this.prisma.ticket.findUnique({
        where: { id: ticketId },
        include: {
          event: { select: { title: true, metadata: true } },
          offer: { select: { name: true, zone: true } },
        },
      });
      if (!ticket) {
        await this.recordScan(ticketId, context, false, 'Ticket not found', scannedAt);
        rejected.push({ ticketId, reason: 'Ticket not found' });
        continue;
      }

      try {
        // Sin eventId: el lote offline ya se acotó al descargar el manifiesto;
        // assertGateEvent pediría organización y rompería la conciliación.
        await this.scanTicket({
          ticketCode: ticket.code,
          zoneId: scan.zoneId,
          scannedBy: params.scannedBy,
          channel: params.channel,
          scannedAt,
          mode,
        });
        accepted.push({ ticketId, scannedAt: scannedAt.toISOString() });
      } catch (err) {
        const code =
          err && typeof err === 'object' && 'getResponse' in err
            ? ((err as { getResponse: () => unknown }).getResponse() as { code?: string })?.code
            : undefined;
        if (code === 'TICKET_ALREADY_SCANNED') {
          const failure = await this.describeFailedClaim(ticketId);
          conflicts.push({
            ticketId,
            attemptedAt: scannedAt.toISOString(),
            attemptedZoneId: scan.zoneId,
            firstScanAt: failure.firstScanAt,
            firstScanZoneId: failure.firstScanZoneId,
            firstScanBy: failure.firstScanBy,
          });
        } else {
          const reason =
            err instanceof Error
              ? err.message
              : typeof err === 'object' && err && 'message' in err
                ? String((err as { message: unknown }).message)
                : 'Rejected';
          rejected.push({ ticketId, reason });
        }
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

  /**
   * Totales en vivo: entraron, faltan, aforo dentro (entradas − salidas),
   * por puerta y por minuto en los últimos 10 minutos.
   */
  async getLiveStats(
    eventId: string,
    scope: { organizationId?: string | null; role?: string },
    now = new Date()
  ) {
    await this.assertGateEvent(eventId, scope.organizationId, scope.role);
    const since = new Date(now.getTime() - 10 * 60_000);
    const [admitted, expected, allScans, recent] = await Promise.all([
      this.prisma.ticket.count({ where: { eventId, status: 'USED' } }),
      this.prisma.ticket.count({
        where: { eventId, status: { in: ['SOLD', 'USED', 'RESOLD'] } },
      }),
      this.prisma.ticketScan.findMany({
        where: { success: true, ticket: { eventId } },
        select: { zoneId: true, reason: true },
      }),
      this.prisma.ticketScan.findMany({
        where: {
          success: true,
          ticket: { eventId },
          scannedAt: { gte: since },
          OR: [{ reason: null }, { reason: SCAN_REASON_ENTRY }, { reason: SCAN_REASON_REENTRY }],
        },
        select: { scannedAt: true, reason: true },
      }),
    ]);
    const traffic = summarizeGateTraffic(
      allScans.map((s) => ({ zoneId: s.zoneId, reason: s.reason }))
    );
    const zoneIds = [...traffic.byZone.keys()].filter((id): id is string => Boolean(id));
    const zones = zoneIds.length
      ? await this.prisma.accessZone.findMany({
          where: { id: { in: zoneIds } },
          select: { id: true, name: true },
        })
      : [];
    const zoneName = new Map(zones.map((z) => [z.id, z.name]));
    const perMinute = Array.from({ length: 10 }, () => 0);
    for (const r of recent) {
      if (!isEntryReason(r.reason)) continue;
      const ago = Math.floor((now.getTime() - r.scannedAt.getTime()) / 60_000);
      if (ago >= 0 && ago < 10) perMinute[9 - ago] += 1;
    }
    return {
      eventId,
      admitted,
      expected,
      remaining: Math.max(0, expected - admitted),
      insideNow: traffic.insideNow,
      exited: traffic.exited,
      lastTenMinutes: recent.length,
      perMinute,
      byGate: [...traffic.byZone.entries()]
        .map(([zoneId, row]) => ({
          zoneId,
          name: zoneId ? (zoneName.get(zoneId) ?? 'Puerta') : 'Sin puerta asignada',
          admitted: row.entries,
          exited: row.exited,
          inside: row.inside,
        }))
        .sort((a, b) => b.inside - a.inside || b.admitted - a.admitted),
      at: now.toISOString(),
    };
  }

  private async assertGateEvent(
    eventId: string,
    organizationId: string | null | undefined,
    role: string | undefined
  ) {
    const event = await this.prisma.event.findUnique({
      where: { id: eventId },
      select: { organizationId: true },
    });
    if (!event) throw new NotFoundException('Función no encontrada');
    if (role === 'SUPER_ADMIN') return;
    if (!organizationId || event.organizationId !== organizationId) {
      throw new ForbiddenException('Esta función es de otra organización');
    }
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
    scannedAt?: Date
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
    const key = channel?.toUpperCase();
    switch (key) {
      case 'TAQUILLA':
      case 'POS':
        return SalesChannel.TAQUILLA;
      case 'API':
        return SalesChannel.API;
      case 'ADMIN':
        return SalesChannel.ADMIN;
      case 'PROMOTER':
        return SalesChannel.PROMOTER;
      case 'COURTESY':
        return SalesChannel.COURTESY;
      case 'CORPORATE':
        return SalesChannel.CORPORATE;
      case 'MOBILE':
        return SalesChannel.MOBILE;
      case 'PHONE':
        return SalesChannel.PHONE;
      case 'INVITATION':
        return SalesChannel.INVITATION;
      case 'AFFILIATE':
        return SalesChannel.AFFILIATE;
      case 'VIP':
        return SalesChannel.VIP;
      case 'RESALE':
        return SalesChannel.RESALE;
      default:
        return SalesChannel.WEB;
    }
  }
}
