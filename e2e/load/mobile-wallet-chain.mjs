/**
 * CADENA COMPLETA: servidor → app → torniquete.
 *
 * Reproduce EXACTAMENTE lo que hace `RotatingTicketCode.kt` en el teléfono
 * (mismo HMAC, misma ventana, mismo formato de payload) y comprueba que el
 * escáner del API lo acepta.
 *
 * Si esto pasa, la app abre la puerta. Si falla, ningún asistente entra.
 */
import { createHmac } from 'node:crypto';

const API = process.env.API_URL ?? 'http://127.0.0.1:4000/api/v1';
const ORDEN = process.env.ORDEN ?? 'ORD-0001008';
const EMAIL = process.env.EMAIL ?? 'cliente.142@demo.boletera.mx';
const PASS = process.env.PASS ?? 'Admin123!';

const checks = [];
const check = (n, ok, d = '') => {
  checks.push({ n, ok });
  console.log(`  ${ok ? '✅' : '❌'} ${n}${d ? ` — ${d}` : ''}`);
};

/** Copia literal de la lógica del teléfono (mx.boletera.mobile.crypto). */
const ROTATION_SECONDS = 15;
const windowAt = (ms) => Math.floor(ms / (ROTATION_SECONDS * 1000));
const signOnPhone = (keyHex, ticketId, eventId, window) =>
  createHmac('sha256', Buffer.from(keyHex, 'hex'))
    .update(`v2:${ticketId}:${eventId}:${window}`)
    .digest('hex')
    .slice(0, 32);
const payloadOnPhone = (keyHex, ticketId, eventId, nowMs) =>
  JSON.stringify({
    v: 2,
    t: ticketId,
    e: eventId,
    s: 'v2.' + signOnPhone(keyHex, ticketId, eventId, windowAt(nowMs)),
  });

async function main() {
  console.log(`\nCadena servidor → app → torniquete · ${API}\n`);

  // 1. El comprador entra en la app
  const login = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: EMAIL, password: PASS }),
  });
  const token = (await login.json()).accessToken;
  check('el comprador inicia sesión', Boolean(token));

  // El escaneo lo hace PERSONAL, no el comprador: con el token del comprador la
  // ruta responde 403 antes de mirar la firma, y la prueba pasaria en vacio.
  const staffRes = await fetch(`${API}/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: 'admin@demo.boletera.com', password: 'Admin123!' }),
  });
  const staff = (await staffRes.json()).accessToken;
  check('el personal de puerta inicia sesión', Boolean(staff));

  // 2. La app descarga la cartera con las claves por boleto
  const wRes = await fetch(`${API}/orders/${ORDEN}/wallet`, {
    headers: { Authorization: `Bearer ${token}` },
  });
  const wallet = await wRes.json();
  check('la app descarga la cartera', wRes.ok, `HTTP ${wRes.status}`);

  const boleto = wallet.tickets?.find((t) => t.status === 'SOLD');
  check('la cartera trae un boleto utilizable', Boolean(boleto), boleto?.code ?? 'ninguno');
  if (!boleto) return resumen();

  check(
    'el boleto viene con su clave de firma',
    typeof boleto.signingKey === 'string' && boleto.signingKey.length === 64,
    `${boleto.signingKey?.length} caracteres hex`,
  );
  check(
    'la ventana de rotación coincide con la del teléfono',
    wallet.rotationSeconds === ROTATION_SECONDS,
    `${wallet.rotationSeconds} s`,
  );

  // 3. El TELÉFONO genera el código, sin pedirle nada al servidor
  const ahora = Date.now();
  const qr = payloadOnPhone(boleto.signingKey, boleto.id, wallet.event.id, ahora);
  console.log(`\n  código generado en el teléfono: ${qr.slice(0, 72)}…\n`);

  // 4. El torniquete lo valida
  const scan = await fetch(`${API}/access/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${staff}` },
    body: JSON.stringify({ qrPayload: qr }),
  });
  const veredicto = await scan.json().catch(() => null);
  const mensaje = String(veredicto?.message ?? JSON.stringify(veredicto)).slice(0, 90);

  // Lo que se prueba es la FIRMA. Que el escáner rechace por permisos de
  // personal o por zona es otra cosa; lo que NO puede decir es que el QR sea
  // inválido o esté caducado.
  const firmaRechazada = /Invalid or expired QR/i.test(mensaje);
  const noLlegoAValidar = /Forbidden resource|Unauthorized/i.test(mensaje);
  check(
    'el torniquete NO rechaza la firma del teléfono',
    !firmaRechazada && !noLlegoAValidar,
    noLlegoAValidar ? `${mensaje} — NO se validó la firma; la prueba no valdría` : mensaje,
  );

  // 5. Contraprueba: un código de la ventana ANTERIOR a la de gracia debe morir
  const viejo = payloadOnPhone(boleto.signingKey, boleto.id, wallet.event.id, ahora - 120_000);
  const scanViejo = await fetch(`${API}/access/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${staff}` },
    body: JSON.stringify({ qrPayload: viejo }),
  });
  const vv = await scanViejo.json().catch(() => null);
  check(
    'un código de hace 2 minutos SÍ se rechaza (la rotación sirve de algo)',
    /Invalid or expired QR/i.test(String(vv?.message ?? '')),
    String(vv?.message ?? '').slice(0, 60),
  );

  // 6. Contraprueba: una clave ajena no debe firmar este boleto
  const claveFalsa = 'f'.repeat(64);
  const falso = payloadOnPhone(claveFalsa, boleto.id, wallet.event.id, ahora);
  const scanFalso = await fetch(`${API}/access/scan`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${staff}` },
    body: JSON.stringify({ qrPayload: falso }),
  });
  const vf = await scanFalso.json().catch(() => null);
  check(
    'una clave inventada NO abre el boleto',
    /Invalid or expired QR/i.test(String(vf?.message ?? '')),
    String(vf?.message ?? '').slice(0, 60),
  );

  resumen();
}

function resumen() {
  const fallos = checks.filter((c) => !c.ok);
  console.log(`\n${checks.length - fallos.length}/${checks.length} comprobaciones\n`);
  if (fallos.length) process.exitCode = 1;
}

main().catch((e) => {
  console.error('\n❌', e.message);
  process.exitCode = 1;
});
