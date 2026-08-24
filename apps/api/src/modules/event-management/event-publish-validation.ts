import type { ChannelConfigDto } from '../channel-management/channel.dto';
import { enabledChannelAllocationTotal } from '../channel-management/channel-validate';

export type PublishCheckStatus = 'ok' | 'warning' | 'blocker';

export type PublishCheckItem = {
  id: string;
  label: string;
  status: PublishCheckStatus;
  message: string;
  detail?: string;
};

export type EventPublishValidation = {
  eventId: string;
  /** True when no blocker checks remain. */
  ready: boolean;
  progress: {
    total: number;
    passed: number;
    warnings: number;
    blockers: number;
  };
  checks: PublishCheckItem[];
  validatedAt: string;
};

type BuildValidationInput = {
  eventId: string;
  venue: { id: string; name: string } | null;
  map: {
    sectionCount: number;
    seatCount: number;
    geometryErrors: number;
    geometryWarnings: number;
    layoutPublishStatus: string | null;
  } | null;
  pricing: {
    minPrice: number;
    offerCount: number;
    pricedOfferCount: number;
    unpricedOfferCount: number;
  };
  payment: {
    ready: boolean;
    demo: boolean;
    missing: string[];
    warnings: string[];
  };
  refund: {
    refundable: boolean;
    hasDocumentedTerms: boolean;
  };
  images: {
    hasImage: boolean;
    hasBanner: boolean;
  };
  channels: {
    configured: boolean;
    allocationTotal: number | null;
    enabledCount: number;
  };
  inventory: {
    published: boolean;
    ticketCount: number;
    layoutSeatCount: number;
    totalCapacity: number;
  };
};

function item(
  id: string,
  label: string,
  status: PublishCheckStatus,
  message: string,
  detail?: string,
): PublishCheckItem {
  return { id, label, status, message, detail };
}

function readChannelConfig(metadata: Record<string, unknown> | null): ChannelConfigDto | null {
  if (!metadata) return null;
  const raw =
    (metadata.channels as ChannelConfigDto | undefined) ??
    (metadata.channelAllocation as ChannelConfigDto | undefined);
  if (!raw || typeof raw !== 'object') return null;
  return raw;
}

/** Pure builder — all data comes from Prisma / services, no mocks. */
export function buildEventPublishValidation(input: BuildValidationInput): EventPublishValidation {
  const checks: PublishCheckItem[] = [];

  // --- Venue ---
  if (!input.venue) {
    checks.push(
      item('venue', 'Recinto', 'blocker', 'El evento no tiene recinto asignado.', 'Selecciona un venue en la configuración del evento.'),
    );
  } else {
    checks.push(
      item('venue', 'Recinto', 'ok', `Recinto: ${input.venue.name}.`),
    );
  }

  // --- Map ---
  if (!input.map || input.map.sectionCount === 0) {
    checks.push(
      item(
        'map',
        'Mapa de asientos',
        'blocker',
        'No hay mapa con secciones en el recinto.',
        'Guarda el layout en el editor de mapa antes de publicar.',
      ),
    );
  } else if (input.map.seatCount === 0) {
    checks.push(
      item(
        'map',
        'Mapa de asientos',
        'blocker',
        'El mapa no tiene asientos generados.',
        'Agrega filas o asientos en el editor de mapa.',
      ),
    );
  } else if (input.map.geometryErrors > 0) {
    checks.push(
      item(
        'map',
        'Mapa de asientos',
        'blocker',
        `${input.map.geometryErrors} error(es) de geometría en el mapa.`,
        'Corrígelos en el panel Validación del editor de mapa.',
      ),
    );
  } else if (input.map.geometryWarnings > 0) {
    checks.push(
      item(
        'map',
        'Mapa de asientos',
        'warning',
        `${input.map.seatCount.toLocaleString('es-MX')} asientos · ${input.map.geometryWarnings} aviso(s) de geometría.`,
        input.map.layoutPublishStatus !== 'PUBLISHED'
          ? 'El layout del venue aún no está publicado.'
          : undefined,
      ),
    );
  } else {
    checks.push(
      item(
        'map',
        'Mapa de asientos',
        'ok',
        `${input.map.sectionCount} sección(es) · ${input.map.seatCount.toLocaleString('es-MX')} asientos.`,
        input.map.layoutPublishStatus && input.map.layoutPublishStatus !== 'PUBLISHED'
          ? `Estado del layout: ${input.map.layoutPublishStatus}.`
          : undefined,
      ),
    );
  }

  // --- Offers / pricing ---
  if (input.pricing.minPrice <= 0 && input.pricing.pricedOfferCount === 0) {
    checks.push(
      item(
        'offers',
        'Ofertas y precios',
        'blocker',
        'No hay precio base ni ofertas con precio.',
        'Configura minPrice o precios por zona en Precios.',
      ),
    );
  } else if (input.pricing.unpricedOfferCount > 0) {
    checks.push(
      item(
        'offers',
        'Ofertas y precios',
        'blocker',
        `${input.pricing.unpricedOfferCount} oferta(s) sin precio válido.`,
        'Todas las ofertas activas deben tener basePrice > 0.',
      ),
    );
  } else if (input.pricing.offerCount === 0) {
    checks.push(
      item(
        'offers',
        'Ofertas y precios',
        'warning',
        `Precio base ${input.pricing.minPrice.toLocaleString('es-MX')} MXN — las ofertas se generan al publicar.`,
      ),
    );
  } else {
    checks.push(
      item(
        'offers',
        'Ofertas y precios',
        'ok',
        `${input.pricing.pricedOfferCount} oferta(s) con precio desde ${input.pricing.minPrice.toLocaleString('es-MX')} MXN.`,
      ),
    );
  }

  // --- Payment ---
  if (!input.payment.ready && !input.payment.demo) {
    checks.push(
      item(
        'payment',
        'Configuración de pagos',
        'blocker',
        'Banorte no está configurado para cobrar.',
        input.payment.missing.length
          ? `Faltan: ${input.payment.missing.join(', ')}.`
          : 'Revisa las variables BANORTE_* del servidor.',
      ),
    );
  } else if (!input.payment.ready || input.payment.demo) {
    checks.push(
      item(
        'payment',
        'Configuración de pagos',
        'warning',
        input.payment.demo
          ? 'Gateway en modo demo (sin BANORTE_MERCHANT_ID).'
          : 'Configuración de pagos incompleta para producción.',
        input.payment.missing.length
          ? `Faltan: ${input.payment.missing.join(', ')}.`
          : 'Solo apto para desarrollo; configura credenciales antes de venta real.',
      ),
    );
  } else {
    checks.push(
      item('payment', 'Configuración de pagos', 'ok', 'Banorte configurado para cobro en línea.'),
    );
  }

  // --- Refund policy ---
  if (!input.refund.hasDocumentedTerms) {
    checks.push(
      item(
        'refund',
        'Política de reembolso',
        'warning',
        input.refund.refundable
          ? 'Reembolsable, pero sin términos documentados en metadata.'
          : 'Sin términos de reembolso documentados.',
        'Agrega metadata.terms o metadata.refundPolicy para cumplimiento y correos.',
      ),
    );
  } else {
    checks.push(
      item(
        'refund',
        'Política de reembolso',
        'ok',
        input.refund.refundable ? 'Reembolsable con términos documentados.' : 'No reembolsable — política documentada.',
      ),
    );
  }

  // --- Images ---
  if (!input.images.hasImage && !input.images.hasBanner) {
    checks.push(
      item(
        'images',
        'Imágenes',
        'warning',
        'Sin imagen principal ni banner.',
        'Sube event.image o bannerImage para la vitrina.',
      ),
    );
  } else {
    checks.push(
      item(
        'images',
        'Imágenes',
        'ok',
        input.images.hasImage && input.images.hasBanner
          ? 'Imagen principal y banner presentes.'
          : input.images.hasImage
            ? 'Imagen principal presente.'
            : 'Banner presente.',
      ),
    );
  }

  // --- Channels ---
  if (!input.channels.configured) {
    checks.push(
      item(
        'channels',
        'Canales de venta',
        'blocker',
        'Canales no configurados.',
        'Asigna el 100% entre web, taquilla y API en la pestaña Canales.',
      ),
    );
  } else if (input.channels.allocationTotal !== 100) {
    checks.push(
      item(
        'channels',
        'Canales de venta',
        'blocker',
        `Asignación de canales: ${input.channels.allocationTotal ?? 0}% (debe ser 100%).`,
      ),
    );
  } else if (input.channels.enabledCount === 0) {
    checks.push(
      item(
        'channels',
        'Canales de venta',
        'blocker',
        'Ningún canal de venta está habilitado.',
      ),
    );
  } else {
    checks.push(
      item(
        'channels',
        'Canales de venta',
        'ok',
        `${input.channels.enabledCount} canal(es) activos · 100% asignado.`,
      ),
    );
  }

  // --- Inventory ---
  if (input.inventory.published) {
    if (input.inventory.ticketCount === 0) {
      checks.push(
        item(
          'inventory',
          'Inventario',
          'blocker',
          'El evento fue publicado pero no tiene boletos.',
          'Republica inventario desde el mapa del recinto.',
        ),
      );
    } else if (
      input.inventory.layoutSeatCount > 0 &&
      input.inventory.ticketCount < input.inventory.layoutSeatCount
    ) {
      checks.push(
        item(
          'inventory',
          'Inventario',
          'warning',
          `${input.inventory.ticketCount.toLocaleString('es-MX')} boletos · el mapa tiene ${input.inventory.layoutSeatCount.toLocaleString('es-MX')} asientos.`,
          'Puede haber butacas sin boleto; considera republicar.',
        ),
      );
    } else {
      checks.push(
        item(
          'inventory',
          'Inventario',
          'ok',
          `${input.inventory.ticketCount.toLocaleString('es-MX')} boletos publicados.`,
        ),
      );
    }
  } else if (input.inventory.layoutSeatCount > 0) {
    checks.push(
      item(
        'inventory',
        'Inventario',
        'ok',
        `Listo para generar ~${input.inventory.layoutSeatCount.toLocaleString('es-MX')} boletos al publicar.`,
        `Aforo declarado: ${input.inventory.totalCapacity.toLocaleString('es-MX')}.`,
      ),
    );
  } else {
    checks.push(
      item(
        'inventory',
        'Inventario',
        'blocker',
        'No hay asientos en el mapa para generar inventario.',
      ),
    );
  }

  const blockers = checks.filter((c) => c.status === 'blocker').length;
  const warnings = checks.filter((c) => c.status === 'warning').length;
  const passed = checks.filter((c) => c.status === 'ok').length;

  return {
    eventId: input.eventId,
    ready: blockers === 0,
    progress: {
      total: checks.length,
      passed,
      warnings,
      blockers,
    },
    checks,
    validatedAt: new Date().toISOString(),
  };
}

export function channelConfigFromMetadata(
  metadata: Record<string, unknown> | null,
): { configured: boolean; allocationTotal: number | null; enabledCount: number } {
  const config = readChannelConfig(metadata);
  if (!config) {
    return { configured: false, allocationTotal: null, enabledCount: 0 };
  }
  let enabledCount = 0;
  for (const key of Object.keys(config) as (keyof ChannelConfigDto)[]) {
    const slot = config[key];
    if (slot && slot.enabled !== false && (slot.allocation ?? 0) > 0) enabledCount += 1;
  }
  return {
    configured: true,
    allocationTotal: enabledChannelAllocationTotal(config),
    enabledCount,
  };
}

export function hasDocumentedRefundTerms(metadata: Record<string, unknown> | null): boolean {
  if (!metadata) return false;
  if (typeof metadata.terms === 'string' && metadata.terms.trim().length >= 20) return true;
  if (metadata.refundPolicy && typeof metadata.refundPolicy === 'object') return true;
  if (typeof metadata.cancellationPolicy === 'string' && metadata.cancellationPolicy.trim().length >= 20) {
    return true;
  }
  return false;
}
