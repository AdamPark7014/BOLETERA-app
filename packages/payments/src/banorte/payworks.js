'use strict';
Object.defineProperty(exports, '__esModule', { value: true });
exports.buildPayworksRedirectUrl = buildPayworksRedirectUrl;
exports.verifyBanorteWebhookSignature = verifyBanorteWebhookSignature;
exports.queryBanorteTransactionStatus = queryBanorteTransactionStatus;
exports.buildSpeiReference = buildSpeiReference;
const crypto_1 = require('crypto');
/** Parámetros típicos Payworks / 3-D Secure Banorte (ajusta con el manual de tu afiliación). */
function buildPayworksRedirectUrl(cfg, params) {
  const amount = params.amount.toFixed(2);
  const reference = params.publicId.replace(/[^A-Za-z0-9]/g, '').slice(0, 20);
  const query = new URLSearchParams({
    ID_AFILIACION: cfg.affiliation,
    ID_TERMINAL: cfg.terminal,
    USUARIO: cfg.user,
    REFERENCIA: reference,
    IMPORTE: amount,
    MONEDA: params.currency === 'USD' ? '840' : '484',
    CORREO: params.buyerEmail,
    NOMBRE: params.buyerName.slice(0, 60),
    URL_RESPUESTA: `${cfg.returnUrl.replace(/\/$/, '')}/orders/${params.publicId}/pago?result=ok`,
    URL_CANCELACION: `${cfg.cancelUrl.replace(/\/$/, '')}/orders/${params.publicId}/pago?result=cancel`,
    CMD_TRANS: 'VENTA',
    METODO_PAGO: 'TC',
  });
  if (cfg.password) {
    const sig = signPayworksPayload(query.toString(), cfg.password);
    query.set('FIRMA', sig);
  }
  const base = cfg.payworksUrl.includes('?') ? cfg.payworksUrl : `${cfg.payworksUrl}?`;
  return `${base}${query.toString()}`;
}
function signPayworksPayload(payload, secret) {
  return (0, crypto_1.createHmac)('sha256', secret).update(payload).digest('hex');
}
function verifyBanorteWebhookSignature(body, signature, secret) {
  if (!secret) return true;
  if (!signature) return false;
  const expected = (0, crypto_1.createHmac)('sha256', secret).update(body).digest('hex');
  return expected === signature || expected === signature.toLowerCase();
}
/** Referencia SPEI única ligada a la orden (abono a cuenta Banorte). */
/** Consulta estado de transacción (ajusta URL según manual Payworks de tu afiliación). */
async function queryBanorteTransactionStatus(cfg, reference) {
  if (cfg.isDemo || !cfg.user || !cfg.password) {
    return { status: 'pending' };
  }
  const queryUrl =
    process.env.BANORTE_QUERY_URL ?? 'https://eps.banorte.com/secure3d/consultaTransaccion.htm';
  try {
    const params = new URLSearchParams({
      ID_AFILIACION: cfg.affiliation,
      USUARIO: cfg.user,
      REFERENCIA: reference.replace(/[^A-Za-z0-9]/g, '').slice(0, 20),
    });
    if (cfg.password) {
      params.set('FIRMA', signPayworksPayload(params.toString(), cfg.password));
    }
    const res = await fetch(`${queryUrl}?${params.toString()}`, { method: 'GET' });
    const text = await res.text();
    const lower = text.toLowerCase();
    if (
      lower.includes('aprobada') ||
      lower.includes('approved') ||
      lower.includes('"00"') ||
      lower.includes('exitoso')
    ) {
      return { status: 'completed' };
    }
    if (lower.includes('rechaz') || lower.includes('declined') || lower.includes('failed')) {
      return { status: 'failed' };
    }
    return { status: 'pending' };
  } catch {
    return { status: 'pending' };
  }
}
function buildSpeiReference(publicId, accountClabe) {
  const reference = publicId
    .replace(/[^A-Z0-9]/gi, '')
    .slice(-12)
    .toUpperCase();
  return {
    clabe: accountClabe,
    concept: `BOLETERA ${reference}`,
    reference,
  };
}
//# sourceMappingURL=payworks.js.map
