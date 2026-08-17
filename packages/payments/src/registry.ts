import type { PaymentProvider, PaymentProviderId, SalesChannelType } from './types';
import { BanorteProvider } from './providers/banorte.provider';
import { CashProvider } from './providers/cash.provider';

const providers = new Map<PaymentProviderId, PaymentProvider>();

export function registerProvider(provider: PaymentProvider): void {
  providers.set(provider.id, provider);
}

/**
 * Devuelve el proveedor y —cuando se indica el canal— comprueba que lo soporte.
 *
 * Cada proveedor declara `supportedChannels` (CashProvider: TAQUILLA/ADMIN),
 * pero nadie lo verificaba: `getProvider('cash')` funcionaba desde una petición
 * web anónima, y `CashProvider.capture()` devuelve éxito incondicional. Eso
 * convertía `POST /orders {"paymentMethod":"CASH"}` en emisión de boletos
 * gratis (F1-01). El canal es ahora parte del contrato del registry.
 */
export function getProvider(
  id: PaymentProviderId,
  channel?: SalesChannelType,
): PaymentProvider {
  const p = providers.get(id);
  if (!p) throw new Error(`Payment provider not registered: ${id}`);
  if (channel && !p.supportedChannels.includes(channel)) {
    throw new Error(
      `El proveedor "${id}" no opera en el canal ${channel} ` +
        `(permitidos: ${p.supportedChannels.join(', ')})`,
    );
  }
  return p;
}

/**
 * Métodos de pago admitidos por canal. Es la lista blanca que faltaba: el
 * método llegaba como string libre desde el cuerpo de la petición y decidía
 * el proveedor sin ninguna validación.
 */
export const CHANNEL_PAYMENT_METHODS: Record<SalesChannelType, readonly string[]> = {
  WEB: ['CARD', 'SPEI', 'OXXO'],
  TAQUILLA: ['CARD', 'CASH'],
  ADMIN: ['CASH'],
  API: ['CARD'],
} as const;

/** `true` si ese canal puede cobrar con ese método. */
export function isMethodAllowedForChannel(
  channel: SalesChannelType,
  method: string,
): boolean {
  return (CHANNEL_PAYMENT_METHODS[channel] ?? []).includes(method.toUpperCase());
}

/** Pasarela principal: Banorte directo a cuenta empresarial (sin Stripe). */
export function initDefaultProviders(): void {
  registerProvider(new BanorteProvider());
  registerProvider(new CashProvider());
}

export function listProviders(): PaymentProviderId[] {
  return Array.from(providers.keys());
}
