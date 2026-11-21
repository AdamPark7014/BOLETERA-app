/**
 * Proveedor de timbrado CFDI. Nunca presentes como real un folio inventado:
 * sandbox marca «SIN VALIDEZ FISCAL»; facturama habla con el API real en modo
 * pruebas cuando hay credenciales.
 */

export type StampInvoiceInput = {
  serie: string;
  folio: number;
  rfcEmisor: string;
  nombreEmisor: string;
  rfcReceptor: string;
  nombreReceptor: string;
  usoCfdi: string;
  subtotal: number;
  iva: number;
  total: number;
  currency: string;
  orderPublicId?: string;
};

export type StampInvoiceResult = {
  uuid: string;
  xml: string;
  provider: 'sandbox' | 'facturama';
  /** true = no es un CFDI válido ante el SAT */
  withoutFiscalValidity: boolean;
  raw?: unknown;
};

export interface InvoicingProvider {
  readonly id: 'sandbox' | 'facturama';
  stamp(input: StampInvoiceInput): Promise<StampInvoiceResult>;
}

export class SandboxInvoicingProvider implements InvoicingProvider {
  readonly id = 'sandbox' as const;

  async stamp(input: StampInvoiceInput): Promise<StampInvoiceResult> {
    const { randomUUID } = await import('crypto');
    const uuid = randomUUID();
    const xml = `<?xml version="1.0" encoding="UTF-8"?>
<!-- SIN VALIDEZ FISCAL — sandbox Black Ticket -->
<cfdi:Comprobante Version="4.0" Serie="${input.serie}" Folio="${input.folio}" SubTotal="${input.subtotal.toFixed(2)}" Total="${input.total.toFixed(2)}" Moneda="${input.currency}"
  xmlns:cfdi="http://www.sat.gob.mx/cfd/4">
  <cfdi:Emisor Rfc="${input.rfcEmisor}" Nombre="${escapeXml(input.nombreEmisor)}"/>
  <cfdi:Receptor Rfc="${input.rfcReceptor}" Nombre="${escapeXml(input.nombreReceptor)}" UsoCFDI="${input.usoCfdi}"/>
  <cfdi:Impuestos TotalImpuestosTrasladados="${input.iva.toFixed(2)}"/>
  <cfdi:Complemento>
    <tfd:TimbreFiscalDigital UUID="${uuid}" FechaTimbrado="${new Date().toISOString()}" xmlns:tfd="http://www.sat.gob.mx/TimbreFiscalDigital"/>
  </cfdi:Complemento>
</cfdi:Comprobante>`;
    return {
      uuid,
      xml,
      provider: 'sandbox',
      withoutFiscalValidity: true,
      raw: { notice: 'SIN VALIDEZ FISCAL' },
    };
  }
}

/**
 * Facturama API (sandbox). Credenciales:
 * FACTURAMA_USER, FACTURAMA_PASSWORD, opcional FACTURAMA_API_URL
 * (default https://apisandbox.facturama.mx).
 * Si faltan credenciales, el factory cae a sandbox.
 */
export class FacturamaInvoicingProvider implements InvoicingProvider {
  readonly id = 'facturama' as const;

  constructor(
    private user: string,
    private password: string,
    private baseUrl = process.env.FACTURAMA_API_URL ?? 'https://apisandbox.facturama.mx'
  ) {}

  async stamp(input: StampInvoiceInput): Promise<StampInvoiceResult> {
    const auth = Buffer.from(`${this.user}:${this.password}`).toString('base64');
    const body = {
      Serie: input.serie,
      Currency: input.currency,
      CfdiType: 'I',
      PaymentForm: '04',
      PaymentMethod: 'PUE',
      ExpeditionPlace: '00000',
      Receiver: {
        Rfc: input.rfcReceptor,
        Name: input.nombreReceptor,
        CfdiUse: input.usoCfdi,
      },
      Items: [
        {
          ProductCode: '01010101',
          Description: input.orderPublicId ? `Boletos ${input.orderPublicId}` : 'Boletos de evento',
          UnitCode: 'E48',
          Quantity: 1,
          UnitPrice: input.subtotal,
          Subtotal: input.subtotal,
          Taxes: [
            {
              Name: 'IVA',
              Rate: input.subtotal > 0 ? input.iva / input.subtotal : 0.16,
              Total: input.iva,
              Base: input.subtotal,
              IsRetention: false,
            },
          ],
          Total: input.total,
        },
      ],
    };
    const res = await fetch(`${this.baseUrl.replace(/\/$/, '')}/api/3/cfdis`, {
      method: 'POST',
      headers: {
        Authorization: `Basic ${auth}`,
        'Content-Type': 'application/json',
        Accept: 'application/json',
      },
      body: JSON.stringify(body),
    });
    const text = await res.text();
    let json: Record<string, unknown> = {};
    try {
      json = JSON.parse(text) as Record<string, unknown>;
    } catch {
      throw new Error(`Facturama respondió sin JSON (${res.status})`);
    }
    if (!res.ok) {
      throw new Error(
        typeof json.Message === 'string' ? json.Message : `Facturama HTTP ${res.status}`
      );
    }
    const complement = json.Complement as { TaxStamp?: { Uuid?: string } } | undefined;
    const uuid = String(complement?.TaxStamp?.Uuid ?? json.Id ?? '');
    if (!uuid) throw new Error('Facturama no devolvió UUID de timbre');
    return {
      uuid,
      xml: typeof json.Content === 'string' ? json.Content : text.slice(0, 2000),
      provider: 'facturama',
      // Sandbox de Facturama tampoco vale ante el SAT.
      withoutFiscalValidity: true,
      raw: json,
    };
  }
}

export function createInvoicingProvider(): InvoicingProvider {
  const user = process.env.FACTURAMA_USER?.trim();
  const password = process.env.FACTURAMA_PASSWORD?.trim();
  const prefer = (process.env.INVOICING_PROVIDER ?? '').toLowerCase();
  if (prefer === 'facturama' || (user && password && prefer !== 'sandbox')) {
    if (user && password) return new FacturamaInvoicingProvider(user, password);
  }
  return new SandboxInvoicingProvider();
}

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}
