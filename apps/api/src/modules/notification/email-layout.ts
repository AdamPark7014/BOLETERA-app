/**
 * Maquetación de los correos transaccionales.
 *
 * Los clientes de correo reales (Outlook de escritorio con el motor de Word,
 * Gmail saneando el CSS, apps móviles) no entienden flexbox, grid, ni hojas de
 * estilo externas o `<style>` fiables. Por eso aquí no hay `<div>` de
 * maquetación: solo tablas anidadas con estilos en línea y un ancho fijo de
 * 600 px, que es lo que cabe sin recortes en el panel de lectura de Outlook.
 *
 * Cada correo se describe como un `EmailDocument` (bloques semánticos) y de esa
 * misma descripción se generan las DOS versiones, HTML y texto plano. Cuando se
 * escriben por separado, una de las dos acaba desactualizada; aquí no puede
 * pasar. La versión de texto no es decorativa: los filtros antispam penalizan
 * los correos que solo traen HTML y hay lectores (accesibilidad, relojes,
 * clientes corporativos) que solo muestran esa parte.
 */

/** Ancho canónico del cuerpo. Más de 600 px se recorta en Outlook. */
const BODY_WIDTH = 600;

const COLOR = {
  page: '#f4f4f5',
  card: '#ffffff',
  border: '#e4e4e7',
  ink: '#18181b',
  muted: '#52525b',
  faint: '#71717a',
  accent: '#6d28d9',
  accentInk: '#ffffff',
} as const;

/** Paleta de los avisos destacados. El texto siempre es legible en blanco y negro. */
const TONE = {
  info: { bg: '#eef2ff', border: '#c7d2fe', ink: '#3730a3' },
  success: { bg: '#ecfdf5', border: '#a7f3d0', ink: '#065f46' },
  warning: { bg: '#fffbeb', border: '#fde68a', ink: '#92400e' },
  danger: { bg: '#fef2f2', border: '#fecaca', ink: '#991b1b' },
} as const;

export type EmailTone = keyof typeof TONE;

/** Fila etiqueta/valor de una ficha de datos. */
export type EmailDetailRow = { label: string; value: string };

export type EmailBlock =
  | { kind: 'paragraph'; text: string; muted?: boolean }
  | { kind: 'details'; title?: string; rows: EmailDetailRow[] }
  | { kind: 'cta'; url: string; label: string; helper?: string }
  | { kind: 'list'; title?: string; items: string[]; ordered?: boolean }
  | { kind: 'callout'; tone: EmailTone; title?: string; text: string }
  | { kind: 'code'; label?: string; value: string; helper?: string }
  | { kind: 'divider' };

export type EmailDocument = {
  subject: string;
  /** Primera línea que enseña la bandeja junto al asunto. */
  preheader: string;
  heading: string;
  blocks: EmailBlock[];
  /** Pie con el aviso legal/transaccional propio de este correo. */
  footerNote?: string;
};

export type RenderedEmail = { subject: string; html: string; text: string };

/** Escapa todo lo que venga de la base de datos: nombres, títulos, notas. */
export function escapeHtml(value: unknown): string {
  return String(value ?? '')
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Escapa una URL para meterla en `href`.
 *
 * Se rechaza cualquier esquema que no sea http/https: una URL construida a
 * partir de configuración o de datos ajenos no debe poder convertirse en
 * `javascript:` dentro del correo.
 */
export function safeUrl(url: string): string {
  const trimmed = String(url ?? '').trim();
  if (!/^https?:\/\//i.test(trimmed)) return '#';
  return escapeHtml(trimmed);
}

/** Importe en formato mexicano. Los `Decimal` de Prisma entran como string. */
export function formatMoney(amount: unknown, currency = 'MXN'): string {
  const value = Number(amount ?? 0);
  const safeCurrency = /^[A-Z]{3}$/.test(String(currency)) ? String(currency) : 'MXN';
  try {
    return new Intl.NumberFormat('es-MX', {
      style: 'currency',
      currency: safeCurrency,
      minimumFractionDigits: 2,
    }).format(Number.isFinite(value) ? value : 0);
  } catch {
    return `${safeCurrency} ${(Number.isFinite(value) ? value : 0).toFixed(2)}`;
  }
}

/**
 * Fecha y hora en la zona horaria del recinto, con el nombre de la zona.
 *
 * El asistente necesita la hora local del evento, no la del servidor ni la de
 * su teléfono: una función que llega tarde por una diferencia horaria es una
 * queja garantizada. Por eso la zona se imprime siempre.
 */
export function formatEventDateTime(date: Date | string | null | undefined, timezone?: string | null): string {
  if (!date) return 'Por confirmar';
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return 'Por confirmar';
  const tz = timezone || 'America/Mexico_City';
  try {
    const formatted = new Intl.DateTimeFormat('es-MX', {
      timeZone: tz,
      weekday: 'long',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    }).format(value);
    // "sábado, 3 de mayo de 2025, 08:00 p.m. GMT-6" → mayúscula inicial.
    return formatted.charAt(0).toUpperCase() + formatted.slice(1);
  } catch {
    // Zona horaria inválida en la BD: mejor una fecha en UTC que un 500.
    return `${value.toISOString().replace('T', ' ').slice(0, 16)} UTC`;
  }
}

/** Fecha corta (sin hora) para vencimientos y plazos administrativos. */
export function formatDate(date: Date | string | null | undefined, timezone?: string | null): string {
  if (!date) return 'Sin fecha';
  const value = date instanceof Date ? date : new Date(date);
  if (Number.isNaN(value.getTime())) return 'Sin fecha';
  try {
    return new Intl.DateTimeFormat('es-MX', {
      timeZone: timezone || 'America/Mexico_City',
      day: 'numeric',
      month: 'long',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }).format(value);
  } catch {
    return value.toISOString().slice(0, 16).replace('T', ' ');
  }
}

// ==================== BLOQUES → HTML ====================

function renderParagraph(block: Extract<EmailBlock, { kind: 'paragraph' }>): string {
  const color = block.muted ? COLOR.muted : COLOR.ink;
  const size = block.muted ? '13px' : '15px';
  return `<p style="margin:0 0 16px;color:${color};font-size:${size};line-height:1.6">${escapeHtml(block.text)}</p>`;
}

function renderDetails(block: Extract<EmailBlock, { kind: 'details' }>): string {
  const title = block.title
    ? `<p style="margin:0 0 8px;color:${COLOR.faint};font-size:12px;letter-spacing:.08em;text-transform:uppercase">${escapeHtml(block.title)}</p>`
    : '';
  const rows = block.rows
    .map(
      (row, index) => `<tr>
<td style="padding:8px 12px;border-top:${index === 0 ? '0' : `1px solid ${COLOR.border}`};color:${COLOR.muted};font-size:13px;width:38%;vertical-align:top">${escapeHtml(row.label)}</td>
<td style="padding:8px 12px;border-top:${index === 0 ? '0' : `1px solid ${COLOR.border}`};color:${COLOR.ink};font-size:14px;font-weight:600;vertical-align:top">${escapeHtml(row.value)}</td>
</tr>`,
    )
    .join('');
  return `${title}<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;border:1px solid ${COLOR.border};border-radius:8px;border-collapse:separate;margin:0 0 20px">${rows}</table>`;
}

function renderCta(block: Extract<EmailBlock, { kind: 'cta' }>): string {
  const href = safeUrl(block.url);
  const helper = block.helper
    ? `<p style="margin:12px 0 0;color:${COLOR.muted};font-size:12px;line-height:1.5">${escapeHtml(block.helper)}</p>`
    : '';
  /*
   * El botón es una tabla con `bgcolor`: Outlook ignora `background` en un <a>
   * con padding y dejaría un enlace suelto sin fondo. Debajo se repite la URL en
   * texto porque hay clientes (y reenvíos a WhatsApp) que descartan el enlace.
   */
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="margin:0 0 20px">
<tr><td bgcolor="${COLOR.accent}" style="border-radius:8px">
<a href="${href}" style="display:inline-block;padding:14px 28px;font-family:Arial,Helvetica,sans-serif;font-size:16px;font-weight:700;color:${COLOR.accentInk};text-decoration:none;border-radius:8px">${escapeHtml(block.label)}</a>
</td></tr></table>
<p style="margin:0 0 20px;color:${COLOR.faint};font-size:12px;line-height:1.5;word-break:break-all">Si el botón no funciona, copia esta dirección en tu navegador:<br/><a href="${href}" style="color:${COLOR.accent}">${href}</a></p>${helper}`;
}

function renderList(block: Extract<EmailBlock, { kind: 'list' }>): string {
  const title = block.title
    ? `<p style="margin:0 0 8px;color:${COLOR.ink};font-size:15px;font-weight:700">${escapeHtml(block.title)}</p>`
    : '';
  const tag = block.ordered ? 'ol' : 'ul';
  const items = block.items
    .map((item) => `<li style="margin:0 0 6px;color:${COLOR.ink};font-size:14px;line-height:1.5">${escapeHtml(item)}</li>`)
    .join('');
  return `${title}<${tag} style="margin:0 0 20px;padding-left:20px">${items}</${tag}>`;
}

function renderCallout(block: Extract<EmailBlock, { kind: 'callout' }>): string {
  const tone = TONE[block.tone] ?? TONE.info;
  const title = block.title
    ? `<p style="margin:0 0 4px;color:${tone.ink};font-size:14px;font-weight:700">${escapeHtml(block.title)}</p>`
    : '';
  return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;margin:0 0 20px">
<tr><td bgcolor="${tone.bg}" style="padding:14px 16px;border:1px solid ${tone.border};border-radius:8px">
${title}<p style="margin:0;color:${tone.ink};font-size:14px;line-height:1.5">${escapeHtml(block.text)}</p>
</td></tr></table>`;
}

function renderCode(block: Extract<EmailBlock, { kind: 'code' }>): string {
  const label = block.label
    ? `<p style="margin:0 0 6px;color:${COLOR.faint};font-size:12px;letter-spacing:.08em;text-transform:uppercase">${escapeHtml(block.label)}</p>`
    : '';
  const helper = block.helper
    ? `<p style="margin:8px 0 0;color:${COLOR.muted};font-size:12px;line-height:1.5">${escapeHtml(block.helper)}</p>`
    : '';
  return `${label}<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;margin:0 0 20px">
<tr><td bgcolor="#fafafa" style="padding:14px 16px;border:1px dashed ${COLOR.border};border-radius:8px;text-align:center">
<span style="font-family:'Courier New',Courier,monospace;font-size:20px;font-weight:700;letter-spacing:.12em;color:${COLOR.ink}">${escapeHtml(block.value)}</span>
</td></tr></table>${helper}`;
}

function renderBlockHtml(block: EmailBlock): string {
  switch (block.kind) {
    case 'paragraph':
      return renderParagraph(block);
    case 'details':
      return renderDetails(block);
    case 'cta':
      return renderCta(block);
    case 'list':
      return renderList(block);
    case 'callout':
      return renderCallout(block);
    case 'code':
      return renderCode(block);
    case 'divider':
      return `<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;margin:0 0 20px"><tr><td style="border-top:1px solid ${COLOR.border};font-size:0;line-height:0">&nbsp;</td></tr></table>`;
    default:
      return '';
  }
}

// ==================== BLOQUES → TEXTO PLANO ====================

function renderBlockText(block: EmailBlock): string[] {
  switch (block.kind) {
    case 'paragraph':
      return [block.text, ''];
    case 'details': {
      const lines = block.title ? [block.title.toUpperCase()] : [];
      for (const row of block.rows) lines.push(`  ${row.label}: ${row.value}`);
      lines.push('');
      return lines;
    }
    case 'cta':
      return [`${block.label}: ${block.url}`, ...(block.helper ? [block.helper] : []), ''];
    case 'list': {
      const lines = block.title ? [block.title] : [];
      block.items.forEach((item, i) => lines.push(`  ${block.ordered ? `${i + 1}.` : '-'} ${item}`));
      lines.push('');
      return lines;
    }
    case 'callout':
      return [`** ${block.title ? `${block.title}: ` : ''}${block.text}`, ''];
    case 'code':
      return [`${block.label ?? 'Código'}: ${block.value}`, ...(block.helper ? [block.helper] : []), ''];
    case 'divider':
      return ['------------------------------------------------------------', ''];
    default:
      return [];
  }
}

// ==================== DOCUMENTO COMPLETO ====================

/**
 * Convierte el documento en el par HTML/texto que espera `MailService`.
 *
 * El `preheader` va en un span oculto al principio del cuerpo: es el texto que
 * la bandeja enseña junto al asunto. Sin él, Gmail muestra el primer contenido
 * que encuentre (normalmente "BOLETERA") y todos los correos se ven iguales.
 */
export function renderEmailDocument(doc: EmailDocument): RenderedEmail {
  const body = doc.blocks.map(renderBlockHtml).join('\n');
  const footer = doc.footerNote
    ? `<p style="margin:0 0 8px;color:${COLOR.faint};font-size:12px;line-height:1.5">${escapeHtml(doc.footerNote)}</p>`
    : '';

  const html = `<!DOCTYPE html>
<html lang="es" xmlns="http://www.w3.org/1999/xhtml">
<head>
<meta charset="utf-8"/>
<meta name="viewport" content="width=device-width,initial-scale=1"/>
<meta name="x-apple-disable-message-reformatting"/>
<title>${escapeHtml(doc.subject)}</title>
</head>
<body style="margin:0;padding:0;background-color:${COLOR.page};-webkit-text-size-adjust:100%">
<span style="display:none!important;visibility:hidden;opacity:0;color:transparent;height:0;width:0;overflow:hidden;mso-hide:all">${escapeHtml(doc.preheader)}</span>
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="100%" style="width:100%;background-color:${COLOR.page}">
<tr><td align="center" style="padding:24px 12px">
<table role="presentation" cellpadding="0" cellspacing="0" border="0" width="${BODY_WIDTH}" style="width:100%;max-width:${BODY_WIDTH}px;background-color:${COLOR.card};border:1px solid ${COLOR.border};border-radius:12px">
<tr><td style="padding:24px 28px 8px;font-family:Arial,Helvetica,sans-serif">
<p style="margin:0 0 20px;font-size:18px;font-weight:800;letter-spacing:.14em;color:${COLOR.ink}">BOLETERA</p>
<h1 style="margin:0 0 16px;font-size:22px;line-height:1.3;color:${COLOR.ink}">${escapeHtml(doc.heading)}</h1>
${body}
</td></tr>
<tr><td style="padding:8px 28px 24px;font-family:Arial,Helvetica,sans-serif;border-top:1px solid ${COLOR.border}">
${footer}
<p style="margin:8px 0 0;color:${COLOR.faint};font-size:12px;line-height:1.5">Este es un correo transaccional relacionado con tu compra; no es publicidad y no puede darse de baja.</p>
</td></tr>
</table>
</td></tr>
</table>
</body>
</html>`;

  const textLines = [
    'BOLETERA',
    '',
    doc.heading,
    '',
    ...doc.blocks.flatMap(renderBlockText),
    '------------------------------------------------------------',
    ...(doc.footerNote ? [doc.footerNote] : []),
    'Correo transaccional relacionado con tu compra.',
  ];
  // Se colapsan los saltos triples que dejan los bloques al concatenarse.
  const text = textLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();

  return { subject: doc.subject, html, text };
}
